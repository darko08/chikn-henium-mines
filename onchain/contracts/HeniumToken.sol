// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title HENIUM — the scarce in-game currency of Chikn Henium Mines
 * @notice ERC-20 "Henium" / "HENIUM", 18 decimals, hard cap of 21,000,000 HENIUM.
 *
 * Supply only changes in two ways:
 *  - `mint`, callable only by MINTER_ROLE. In production the only minter is {HeniumEmission}, which releases
 *    HENIUM on a bitcoin-like schedule.
 *  - `burn` / `burnFrom` by holders (the DEX burns part of every swap fee, the game vault burns HENIUM spent
 *    on in-game sinks).
 *
 * There is deliberately no pause, no blacklist, no fee-on-transfer and no other admin power over balances.
 * The only privileged action is granting / revoking MINTER_ROLE. Once MINTER_ROLE has been granted to the
 * emission contract, the admin should renounce DEFAULT_ADMIN_ROLE so that the minter set is frozen forever
 * (see README, "Trust model").
 *
 * Note on the cap: OpenZeppelin's ERC20Capped bounds `totalSupply()`, which goes down when HENIUM is burned.
 * The emission contract additionally counts everything it has ever issued and never re-issues burned
 * HENIUM, so burns are permanent — as with bitcoin, lost or burned coins are not replaced.
 */
contract HeniumToken is ERC20, ERC20Capped, ERC20Burnable, ERC20Permit, AccessControl {
    /// @notice Role allowed to mint new HENIUM (within the cap).
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Hard cap: 21,000,000 HENIUM (18 decimals).
    uint256 public constant MAX_SUPPLY = 21_000_000e18;

    error ZeroAdmin();

    /// @param admin Receives DEFAULT_ADMIN_ROLE (should be a multisig / timelock, and renounced after setup).
    constructor(address admin) ERC20("Henium", "HENIUM") ERC20Capped(MAX_SUPPLY) ERC20Permit("Henium") {
        if (admin == address(0)) revert ZeroAdmin();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Mints `amount` HENIUM to `to`. Reverts with `ERC20ExceededCap` above 21M total supply.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @dev Both ERC20 and ERC20Capped define `_update`; the capped version enforces the cap on mints.
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
