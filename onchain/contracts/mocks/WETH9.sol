// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title WETH9 — wrapped ether for local tests and testnets without a canonical WETH
 * @notice An original MIT implementation with the same external behaviour as the canonical WETH9 deployed on
 *         Ethereum (and as WAVAX, and the WETH predeploy of OP-stack chains):
 *          - deposit / withdraw 1:1 against native ETH, Deposit / Withdrawal events, 18 decimals;
 *          - an infinite allowance is not decreased by transferFrom (as OpenZeppelin's ERC20 does);
 *          - a payable catch-all fallback that deposits: calling a function WETH9 does not have (for example
 *            `burn(uint256)`) succeeds and does nothing. The DEX pair must detect this when it burns fees.
 */
contract WETH9 is ERC20 {
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    error ETHTransferFailed();

    constructor() ERC20("Wrapped Ether", "WETH") {}

    receive() external payable {
        deposit();
    }

    fallback() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) external {
        _burn(msg.sender, wad);
        emit Withdrawal(msg.sender, wad);
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = msg.sender.call{value: wad}("");
        if (!ok) revert ETHTransferFailed();
    }
}
