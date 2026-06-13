// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IGenLayerBridgeReceiver
/// @notice Callback the bridge receiver invokes to deliver a GenLayer→EVM message to its target.
interface IGenLayerBridgeReceiver {
    function processBridgeMessage(
        uint32 _sourceChainId,
        address _sourceContract,
        bytes calldata _message
    ) external;
}
