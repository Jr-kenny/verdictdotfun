// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CreditVault
/// @notice Custody of ETH/USDC backing GenLayer credits. Deposits are attributed
///         to a GenLayer profile id (bytes32). Redeems are gated to the bridge.
contract CreditVault is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    address public constant ETH = address(0);

    address public bridge;
    uint256 public depositNonce;
    mapping(address => bool) public tokenAllowed;
    mapping(uint256 => bool) public processedRedeem;

    event CreditPurchased(
        address indexed user,
        address indexed token,
        bytes32 indexed profile,
        uint256 amount,
        uint256 nonce
    );
    event CreditRedeemed(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 redeemId
    );
    event BridgeUpdated(address indexed previousBridge, address indexed newBridge);
    event TokenAllowedUpdated(address indexed token, bool allowed);

    error ZeroAmount();
    error ZeroProfile();
    error ZeroAddress();
    error TokenNotAllowed();
    error NotBridge();
    error RedeemAlreadyProcessed();
    error EthTransferFailed();
    error InsufficientVaultBalance();

    modifier onlyBridge() {
        if (msg.sender != bridge) revert NotBridge();
        _;
    }

    constructor(address initialOwner, address initialBridge) Ownable(initialOwner) {
        if (initialBridge == address(0)) revert ZeroAddress();
        bridge = initialBridge;
        emit BridgeUpdated(address(0), initialBridge);
    }

    function depositEth(bytes32 profile) external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        if (profile == bytes32(0)) revert ZeroProfile();
        uint256 nonce = ++depositNonce;
        emit CreditPurchased(msg.sender, ETH, profile, msg.value, nonce);
    }

    function depositToken(address token, uint256 amount, bytes32 profile)
        external
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (profile == bytes32(0)) revert ZeroProfile();
        if (!tokenAllowed[token]) revert TokenNotAllowed();
        uint256 nonce = ++depositNonce;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit CreditPurchased(msg.sender, token, profile, amount, nonce);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        tokenAllowed[token] = allowed;
        emit TokenAllowedUpdated(token, allowed);
    }

    function setBridge(address newBridge) external onlyOwner {
        if (newBridge == address(0)) revert ZeroAddress();
        emit BridgeUpdated(bridge, newBridge);
        bridge = newBridge;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
