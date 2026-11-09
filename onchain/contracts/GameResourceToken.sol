// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title GameResourceToken — an in-game resource (Stone, Coal, Iron Ingot, Circuit...) as an ERC-20
 * @notice Lets players take resources out of the game and trade them on the DEX.
 *  - Mintable only by the {ResourceBridge} fixed at construction (immutable), which mints on server-signed
 *    withdrawal vouchers. Nobody else can mint, and there is no admin.
 *  - Burnable by holders; the bridge's `deposit` burns resources that move back into the game (with the
 *    player's allowance — the bridge cannot burn anyone's tokens without approval).
 *  - EIP-2612 permit for gasless approvals.
 */
contract GameResourceToken is ERC20, ERC20Burnable, ERC20Permit {
    /// @notice The only address that can mint.
    address public immutable bridge;

    error ZeroBridge();
    error OnlyBridge(address caller);

    constructor(string memory name_, string memory symbol_, address bridge_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        if (bridge_ == address(0)) revert ZeroBridge();
        bridge = bridge_;
    }

    /// @notice Mints `amount` to `to`. Only the bridge.
    function mint(address to, uint256 amount) external {
        if (msg.sender != bridge) revert OnlyBridge(msg.sender);
        _mint(to, amount);
    }
}
