// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY. A burnable ERC-20 that can run an arbitrary call (e.g. a re-entrant call into a DEX pair)
///         from inside `transfer`/`transferFrom` or `burn`. Fires once per arming.
contract HookToken is ERC20 {
    enum Hook {
        NONE,
        ON_TRANSFER,
        ON_BURN
    }

    Hook public hook;
    address public hookTarget;
    bytes public callData;
    /// @dev true: bubble the hook call's revert; false: record it and carry on.
    bool public bubble;

    bool public hookCalled;
    bool public hookSucceeded;
    bytes public hookReturnData;

    constructor() ERC20("Hook Token", "HOOK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        if (hook == Hook.ON_BURN) _fire();
    }

    function arm(Hook hook_, address target_, bytes calldata data, bool bubble_) external {
        hook = hook_;
        hookTarget = target_;
        callData = data;
        bubble = bubble_;
        hookCalled = false;
        hookSucceeded = false;
        delete hookReturnData;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hook == Hook.ON_TRANSFER && from != address(0) && to != address(0)) _fire();
    }

    function _fire() private {
        hook = Hook.NONE; // once
        hookCalled = true;
        (bool ok, bytes memory ret) = hookTarget.call(callData);
        hookSucceeded = ok;
        hookReturnData = ret;
        if (!ok && bubble) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
