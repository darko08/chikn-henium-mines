// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Flash-swap callback. `HeniumDexPair.swap` calls it on `to` when `data` is non-empty, after sending the
///         requested outputs and before checking that enough input (plus fees) came back.
interface IHeniumDexCallee {
    function heniumDexCall(address sender, uint256 amount0Out, uint256 amount1Out, bytes calldata data) external;
}
