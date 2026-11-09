// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The optional `burn` of OpenZeppelin's ERC20Burnable. The DEX pair tries it on every swap input.
interface IERC20Burnable {
    function burn(uint256 value) external;
}
