// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title StoneMarket
/// @notice A minimal, non-custodial ETH marketplace for Verdict Stones (VerdictStoneHub, ERC721).
///
/// Approval-based: a seller keeps the stone in their own wallet and approves this market (per-token
/// `approve` or `setApprovalForAll`). Listing only records a price; on `buy` the market pulls the
/// stone from the seller straight to the buyer and forwards the proceeds, taking an optional fee.
/// Because the stone never sits in the market, a normal wallet transfer simply invalidates the
/// listing (the ownership check in `buy` fails) rather than stranding an asset.
///
/// The hub emits `StoneOwnerChanged` on transfer, which the bridge relay turns into a GenLayer rebind
/// of the stone's driving profile — so a market sale flows through the same living-stone machinery as
/// any other transfer, with no extra wiring here.
contract StoneMarket is Ownable, ReentrancyGuard {
    IERC721 public immutable stone;

    struct Listing {
        address seller;
        uint96 price; // wei; uint96 covers ~7.9e28 wei, far beyond any testnet price
    }

    /// @notice tokenId => active listing (price 0 / seller 0 means not listed).
    mapping(uint256 => Listing) public listings;

    /// @notice Marketplace fee in basis points (e.g. 250 = 2.5%), taken from the sale price.
    uint16 public feeBps;
    /// @notice Recipient of the fee.
    address public treasury;

    uint16 public constant MAX_FEE_BPS = 1000; // 10% ceiling

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event PriceUpdated(uint256 indexed tokenId, uint256 price);
    event Cancelled(uint256 indexed tokenId, address indexed seller);
    event Sale(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee);
    event FeeUpdated(uint16 feeBps, address treasury);

    error NotOwner();
    error NotApproved();
    error ZeroPrice();
    error NotListed();
    error NotSeller();
    error StaleListing();
    error WrongValue();
    error FeeTooHigh();
    error TransferFailed();

    constructor(address stoneHub, address initialOwner, address initialTreasury, uint16 initialFeeBps)
        Ownable(initialOwner)
    {
        if (initialFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        stone = IERC721(stoneHub);
        treasury = initialTreasury == address(0) ? initialOwner : initialTreasury;
        feeBps = initialFeeBps;
    }

    // ---- admin ----

    function setFee(uint16 newFeeBps, address newTreasury) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        treasury = newTreasury == address(0) ? owner() : newTreasury;
        emit FeeUpdated(feeBps, treasury);
    }

    // ---- seller actions ----

    function list(uint256 tokenId, uint256 price) external {
        if (price == 0) revert ZeroPrice();
        if (stone.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (!_marketApproved(tokenId, msg.sender)) revert NotApproved();
        listings[tokenId] = Listing({seller: msg.sender, price: uint96(price)});
        emit Listed(tokenId, msg.sender, price);
    }

    function updatePrice(uint256 tokenId, uint256 price) external {
        if (price == 0) revert ZeroPrice();
        Listing storage l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();
        l.price = uint96(price);
        emit PriceUpdated(tokenId, price);
    }

    function cancel(uint256 tokenId) external {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();
        delete listings[tokenId];
        emit Cancelled(tokenId, msg.sender);
    }

    // ---- buyer action ----

    function buy(uint256 tokenId) external payable nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.value != l.price) revert WrongValue();
        // The seller must still own the stone and still have the market approved; otherwise the
        // listing is stale (they moved or revoked it) and cannot be honoured.
        if (stone.ownerOf(tokenId) != l.seller) revert StaleListing();
        if (!_marketApproved(tokenId, l.seller)) revert StaleListing();

        uint256 fee = (uint256(l.price) * feeBps) / 10_000;
        uint256 toSeller = uint256(l.price) - fee;

        delete listings[tokenId]; // effects before interactions

        stone.safeTransferFrom(l.seller, msg.sender, tokenId);
        _pay(l.seller, toSeller);
        if (fee > 0) _pay(treasury, fee);

        emit Sale(tokenId, l.seller, msg.sender, l.price, fee);
    }

    // ---- views ----

    function getListing(uint256 tokenId) external view returns (address seller, uint256 price, bool active) {
        Listing memory l = listings[tokenId];
        return (l.seller, l.price, l.seller != address(0));
    }

    /// @notice Whether a listing is currently honourable (seller owns it and the market is approved).
    function isListingLive(uint256 tokenId) external view returns (bool) {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) return false;
        return stone.ownerOf(tokenId) == l.seller && _marketApproved(tokenId, l.seller);
    }

    // ---- internal ----

    function _marketApproved(uint256 tokenId, address holder) internal view returns (bool) {
        return stone.getApproved(tokenId) == address(this) || stone.isApprovedForAll(holder, address(this));
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
