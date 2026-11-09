// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20 — TEST AND TESTNET ONLY
 * @notice Stand-in for the existing Chikn tokens (EGG, FEED) in tests and on testnets. ANYONE CAN MINT.
 *         Never deploy it to a mainnet, and never give a production token the EGG / FEED name: the real EGG and
 *         FEED are existing Chikn tokens (Avalanche C-Chain) whose use needs their owners' permission.
 *         Deliberately not burnable, so the DEX sends its fee burn to 0x…dEaD for it.
 */
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Faucet: mints `amount` to `to`. Test only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
