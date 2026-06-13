// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Authoritative hub registry for the living Verdict Stone (Phase 1b: single chain, no roaming).
/// The bridge relay (operator) mints stones on authorization from GenLayer and ratchets their level;
/// standard ERC-721 transfers drive trading and emit StoneOwnerChanged for the relay to feed back to
/// GenLayer's on_owner_changed. Level is a high-water mark, raiseLevel applies max so it is idempotent
/// and order-independent.
contract VerdictStoneHub is ERC721Enumerable, Ownable {
    struct Stone {
        uint256 level;     // high-water mark, only ever rises
        bytes32 profile;   // bound GenLayer profile
        uint64 location;   // chain id currently holding the stone (hub for now)
    }

    address public operator; // the bridge relay
    uint64 public hubChainId;
    mapping(uint256 => Stone) private _stones;

    event OperatorUpdated(address indexed operator);
    event StoneMinted(uint256 indexed tokenId, bytes32 indexed profile, address indexed to, uint256 level);
    event StoneLeveled(uint256 indexed tokenId, uint256 level);
    event StoneOwnerChanged(uint256 indexed tokenId, address indexed newOwner);

    error NotOperator();
    error StoneExists();
    error UnknownStone();
    error ZeroProfile();
    error ZeroRecipient();

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor(string memory name_, string memory symbol_, address operator_, uint64 hubChainId_)
        ERC721(name_, symbol_)
        Ownable(msg.sender)
    {
        operator = operator_ == address(0) ? msg.sender : operator_;
        hubChainId = hubChainId_;
    }

    function setOperator(address newOperator) external onlyOwner {
        operator = newOperator;
        emit OperatorUpdated(newOperator);
    }

    function applyMint(uint256 tokenId, bytes32 profile, address to, uint256 level) external onlyOperator {
        if (to == address(0)) revert ZeroRecipient();
        if (profile == bytes32(0)) revert ZeroProfile();
        if (_ownerOf(tokenId) != address(0)) revert StoneExists();
        _stones[tokenId] = Stone({level: level, profile: profile, location: hubChainId});
        _safeMint(to, tokenId);
        emit StoneMinted(tokenId, profile, to, level);
    }

    function raiseLevel(uint256 tokenId, uint256 level) external onlyOperator {
        if (_ownerOf(tokenId) == address(0)) revert UnknownStone();
        if (level > _stones[tokenId].level) {
            _stones[tokenId].level = level;
            emit StoneLeveled(tokenId, level);
        }
    }

    function getStone(uint256 tokenId) external view returns (Stone memory) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownStone();
        return _stones[tokenId];
    }

    function levelOf(uint256 tokenId) external view returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownStone();
        return _stones[tokenId].level;
    }

    /// @notice Highest level among the holder's stones. Perks read this; holding many never stacks.
    function effectiveLevelOf(address holder) external view returns (uint256 maxLevel) {
        uint256 n = balanceOf(holder);
        for (uint256 i = 0; i < n; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(holder, i);
            uint256 lvl = _stones[tokenId].level;
            if (lvl > maxLevel) {
                maxLevel = lvl;
            }
        }
    }

    // Required overrides for ERC721Enumerable (OZ 5.x). The _update hook also signals owner changes
    // (transfers, not mints/burns) so the relay can rebind the driving profile on GenLayer.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address)
    {
        address from = _ownerOf(tokenId);
        address result = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            emit StoneOwnerChanged(tokenId, to);
        }
        return result;
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721Enumerable) {
        super._increaseBalance(account, value);
    }
}
