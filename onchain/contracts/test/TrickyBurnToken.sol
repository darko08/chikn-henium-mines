// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY. An ERC-20 whose `burn` misbehaves in configurable ways, to show that the DEX pair never
///         trusts a burn and always re-reads balances.
contract TrickyBurnToken is ERC20 {
    enum Mode {
        HONEST, // burns exactly the amount
        NOOP, // returns success but burns nothing
        PARTIAL, // burns half of the amount
        OVERBURN, // burns the caller's whole balance
        REVERT_ALL // burn reverts AND transfers to 0x…dEaD revert
    }

    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    Mode public mode;

    error BurnDisabled();
    error DeadTransferDisabled();

    constructor() ERC20("Tricky Burn", "TRICK") {}

    function setMode(Mode m) external {
        mode = m;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        Mode m = mode;
        if (m == Mode.HONEST) _burn(msg.sender, amount);
        else if (m == Mode.PARTIAL) _burn(msg.sender, amount / 2);
        else if (m == Mode.OVERBURN) _burn(msg.sender, balanceOf(msg.sender));
        else if (m == Mode.REVERT_ALL) revert BurnDisabled();
        // NOOP: nothing
    }

    function _update(address from, address to, uint256 value) internal override {
        if (mode == Mode.REVERT_ALL && to == DEAD) revert DeadTransferDisabled();
        super._update(from, to, value);
    }
}
