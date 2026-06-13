// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGenLayerBridgeReceiver} from "./interfaces/IGenLayerBridgeReceiver.sol";

/// @dev LayerZero V2 Origin, declared locally to avoid pulling the LZ dependency into this package.
struct Origin {
    uint32 srcEid;
    bytes32 sender;
    uint64 nonce;
}

/// @title VerdictStoneBridgeReceiver
/// @notice Hub-side bridge receiver for GenLayer→EVM (VerdictStone) messages.
///
/// Implements GenLayer's canonical *dispatch-on-receive* pattern: the receiver validates the
/// source and immediately dispatches to the target's `processBridgeMessage` via a contract call —
/// it does NOT store messages for later polling (which the boilerplate's storing receiver did,
/// leaving the GL→hub act hop unimplemented). Ported as-is from the live Tokenpost VerdictReceiver
/// (it is target-agnostic): here the target is VerdictStoneHub.
///
/// Two delivery paths, both within GenLayer's documented model:
///  - `lzReceive`     — the LayerZero transport path (gated to the endpoint + trusted forwarder).
///  - `deliverDirect` — an authorized relayer submits directly. GenLayer's bridge is
///                      transport-agnostic and authorized-relayer gated, so this is on-pattern and
///                      reliable while the LayerZero testnet committer stalls on the hub lane.
///
/// Envelope format (matches the GenLayer BridgeSender → forwarder wire format):
///   abi.encode(uint32 srcChainId, address srcSender, address target, bytes message)
contract VerdictStoneBridgeReceiver is Ownable, ReentrancyGuard {
    /// @notice LayerZero endpoint allowed to call `lzReceive`. May be address(0) if only the
    ///         direct path is used on this deployment.
    address public immutable endpoint;

    /// @notice srcEid => trusted remote forwarder (bytes32-encoded address), for the LZ path.
    mapping(uint32 => bytes32) public trustedForwarders;

    /// @notice Relayers permitted to call `deliverDirect`.
    mapping(address => bool) public authorizedRelayers;

    /// @notice Dedup for the direct path, keyed by an opaque delivery id (e.g. the GL outbox hash).
    mapping(bytes32 => bool) public delivered;

    event TrustedForwarderSet(uint32 indexed srcEid, bytes32 forwarder);
    event AuthorizedRelayerSet(address indexed relayer, bool authorized);
    event Dispatched(
        uint32 srcChainId, address indexed srcSender, address indexed target, bytes32 deliveryId, bool viaLz
    );

    error OnlyEndpoint();
    error UntrustedForwarder();
    error NotAuthorizedRelayer();
    error AlreadyDelivered();
    error ZeroTarget();

    constructor(address _endpoint, address _owner) Ownable(_owner) {
        endpoint = _endpoint;
    }

    // ---- admin ----

    function setTrustedForwarder(uint32 _srcEid, bytes32 _forwarder) external onlyOwner {
        trustedForwarders[_srcEid] = _forwarder;
        emit TrustedForwarderSet(_srcEid, _forwarder);
    }

    function setAuthorizedRelayer(address _relayer, bool _ok) external onlyOwner {
        authorizedRelayers[_relayer] = _ok;
        emit AuthorizedRelayerSet(_relayer, _ok);
    }

    // ---- LayerZero transport path ----

    function lzReceive(
        Origin calldata _origin,
        bytes32, /*_guid*/
        bytes calldata _message,
        address, /*_executor*/
        bytes calldata /*_extraData*/
    ) external payable nonReentrant {
        if (msg.sender != endpoint) revert OnlyEndpoint();
        if (trustedForwarders[_origin.srcEid] != _origin.sender) revert UntrustedForwarder();
        _dispatch(_message, bytes32(0), true);
    }

    /// @dev LZ endpoint hooks (kept minimal — this OApp only receives).
    function allowInitializePath(Origin calldata _origin) external view returns (bool) {
        return trustedForwarders[_origin.srcEid] == _origin.sender;
    }

    function nextNonce(uint32, bytes32) external pure returns (uint64) {
        return 0;
    }

    // ---- authorized-relayer direct path ----

    /// @param _deliveryId unique id for replay protection (e.g. the GenLayer outbox message hash).
    /// @param _data abi.encode(uint32 srcChainId, address srcSender, address target, bytes message).
    function deliverDirect(bytes32 _deliveryId, bytes calldata _data) external nonReentrant {
        if (!authorizedRelayers[msg.sender]) revert NotAuthorizedRelayer();
        if (delivered[_deliveryId]) revert AlreadyDelivered();
        delivered[_deliveryId] = true;
        _dispatch(_data, _deliveryId, false);
    }

    function isDelivered(bytes32 _deliveryId) external view returns (bool) {
        return delivered[_deliveryId];
    }

    // ---- internal ----

    function _dispatch(bytes calldata _data, bytes32 _deliveryId, bool _viaLz) internal {
        (uint32 srcChainId, address srcSender, address target, bytes memory message) =
            abi.decode(_data, (uint32, address, address, bytes));
        if (target == address(0)) revert ZeroTarget();
        IGenLayerBridgeReceiver(target).processBridgeMessage(srcChainId, srcSender, message);
        emit Dispatched(srcChainId, srcSender, target, _deliveryId, _viaLz);
    }
}
