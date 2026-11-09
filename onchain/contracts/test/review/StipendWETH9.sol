// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice TEST ONLY (security review). WETH9 that pays ETH out the way the canonical WETH9 / WAVAX do:
 *         `payable(msg.sender).transfer(wad)`, i.e. with only the 2,300-gas stipend. The repository's WETH9 mock
 *         uses a full-gas `call`, so the test suite never checked that the router's `receive()` fits the stipend.
 */
contract StipendWETH9 is ERC20 {
    constructor() ERC20("Stipend Wrapped Ether", "sWETH") {}

    receive() external payable {
        deposit();
    }

    fallback() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) external {
        _burn(msg.sender, wad);
        payable(msg.sender).transfer(wad);
    }
}
