// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VoucherBase} from "./base/VoucherBase.sol";
import {HeniumToken} from "./HeniumToken.sol";

/**
 * @title HeniumGameVault — gateway between on-chain HENIUM and in-game HENIUM balances
 * @notice HENIUM that already exists moves into and out of the game through this escrow:
 *  - {deposit}: a player moves HENIUM into the game. The vault pulls it into escrow and emits {Deposited};
 *    the game server listens and credits `playerId` in game.
 *  - {release}: the server debits the player in game and signs a {Release} voucher; the vault pays it out of
 *    escrow. The vault can never pay out more than it holds, and it has no way to mint: releasing never
 *    creates HENIUM.
 *  - {burnSunk}: HENIUM that players spent on in-game sinks (digging, building upgrades, speed-ups, hires...)
 *    is burned from escrow by BURNER_ROLE, so that the on-chain supply reflects in-game burns.
 *
 * Newly earned HENIUM does not come from here: it is minted by {HeniumEmission} straight to the player.
 * Escrow = `henium.balanceOf(vault)`; HENIUM sent here without {deposit} simply joins the escrow.
 */
contract HeniumGameVault is VoucherBase {
    using SafeERC20 for IERC20;

    /// @notice A signed voucher that pays `amount` escrowed HENIUM to `account`.
    struct Release {
        address account;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 public constant RELEASE_TYPEHASH =
        keccak256("Release(address account,uint256 amount,uint256 nonce,uint256 deadline)");

    /// @notice Role allowed to burn escrowed HENIUM that was spent on in-game sinks.
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    HeniumToken public immutable henium;

    /// @notice Max HENIUM released per UTC day, all accounts together; 0 = no limit.
    uint256 public dailyReleaseCap;
    uint64 private _releaseDay;
    uint192 private _releasedToday;

    uint256 public totalDeposited;
    uint256 public totalReleased;
    uint256 public totalSunkBurned;

    event Deposited(address indexed from, bytes32 indexed playerId, uint256 amount);
    event Released(address indexed account, uint256 indexed nonce, uint256 amount, address signer);
    event SunkBurned(bytes32 indexed reason, uint256 amount, address indexed operator);
    event DailyReleaseCapSet(uint256 previousCap, uint256 newCap);

    error ZeroPlayerId();
    error InsufficientEscrow(uint256 requested, uint256 available);
    error DailyReleaseCapExceeded(uint256 requested, uint256 remaining);

    constructor(HeniumToken henium_, address admin) VoucherBase("HeniumGameVault", "1", admin) {
        if (address(henium_) == address(0)) revert ZeroAddress();
        henium = henium_;
    }

    // ------------------------------------------------------------------------------------------------------
    // Player entry points
    // ------------------------------------------------------------------------------------------------------

    /// @notice Moves `amount` HENIUM from the caller into the game, credited to `playerId`. Needs an allowance.
    function deposit(uint256 amount, bytes32 playerId) external whenNotPaused {
        _deposit(amount, playerId);
    }

    /**
     * @notice {deposit} with an EIP-2612 permit instead of a separate approve transaction.
     * @dev The permit is tried, not required: if someone front-ran it (same signature, already used) the
     *      allowance is in place and the deposit still succeeds; otherwise `transferFrom` reverts.
     */
    function depositWithPermit(
        uint256 amount,
        bytes32 playerId,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused {
        try henium.permit(msg.sender, address(this), amount, permitDeadline, v, r, s) {} catch {}
        _deposit(amount, playerId);
    }

    /**
     * @notice Pays out a server-signed release voucher from escrow. Anyone may submit it; HENIUM goes to
     *         `r.account`. Reverts if the escrow holds less than `r.amount`.
     */
    function release(Release calldata r, bytes calldata signature) external whenNotPaused {
        if (r.account == address(0)) revert ZeroAddress();
        if (r.amount == 0) revert ZeroAmount();
        address signer = _useVoucher(r.account, r.nonce, r.deadline, _releaseStructHash(r), signature);

        uint256 escrow = henium.balanceOf(address(this));
        if (r.amount > escrow) revert InsufficientEscrow(r.amount, escrow);
        _consumeReleaseCap(r.amount);

        totalReleased += r.amount;
        emit Released(r.account, r.nonce, r.amount, signer);
        IERC20(address(henium)).safeTransfer(r.account, r.amount);
    }

    // ------------------------------------------------------------------------------------------------------
    // Operator
    // ------------------------------------------------------------------------------------------------------

    /**
     * @notice Burns `amount` escrowed HENIUM that players spent on in-game sinks.
     * @param reason Free-form tag for accounting, e.g. keccak256("dig"), or a batch id of the server's ledger.
     */
    function burnSunk(uint256 amount, bytes32 reason) external onlyRole(BURNER_ROLE) whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        uint256 escrow = henium.balanceOf(address(this));
        if (amount > escrow) revert InsufficientEscrow(amount, escrow);
        totalSunkBurned += amount;
        emit SunkBurned(reason, amount, msg.sender);
        henium.burn(amount);
    }

    /// @notice Sets the global daily release cap (0 disables it). A rate limit against a compromised signer.
    function setDailyReleaseCap(uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit DailyReleaseCapSet(dailyReleaseCap, newCap);
        dailyReleaseCap = newCap;
    }

    // ------------------------------------------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------------------------------------------

    /// @notice HENIUM currently held in escrow.
    function escrowBalance() external view returns (uint256) {
        return henium.balanceOf(address(this));
    }

    /// @notice HENIUM released so far today (UTC).
    function releasedToday() public view returns (uint256) {
        return _releaseDay == _utcDay() ? _releasedToday : 0;
    }

    /// @notice What can still be released today under the daily cap (max uint if disabled).
    function releaseRemainingToday() external view returns (uint256) {
        uint256 cap = dailyReleaseCap;
        if (cap == 0) return type(uint256).max;
        uint256 used = releasedToday();
        return used >= cap ? 0 : cap - used;
    }

    /// @notice EIP-712 digest the server signs for `r`.
    function hashRelease(Release calldata r) external view returns (bytes32) {
        return _hashTypedDataV4(_releaseStructHash(r));
    }

    // ------------------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------------------

    function _deposit(uint256 amount, bytes32 playerId) private {
        if (amount == 0) revert ZeroAmount();
        if (playerId == bytes32(0)) revert ZeroPlayerId();
        totalDeposited += amount;
        emit Deposited(msg.sender, playerId, amount);
        // HENIUM has no transfer fee, so the escrow grows by exactly `amount`.
        IERC20(address(henium)).safeTransferFrom(msg.sender, address(this), amount);
    }

    function _consumeReleaseCap(uint256 amount) private {
        uint256 cap = dailyReleaseCap;
        // Tracked always (one slot), so enabling the cap mid-day already counts today's releases.
        uint256 day = _utcDay();
        uint256 used = _releaseDay == day ? _releasedToday : 0;
        if (cap != 0 && used + amount > cap) revert DailyReleaseCapExceeded(amount, used >= cap ? 0 : cap - used);
        // Bounded by the 21M cap, far below 2^192.
        _releaseDay = uint64(day);
        _releasedToday = uint192(used + amount);
    }

    function _releaseStructHash(Release calldata r) private pure returns (bytes32) {
        return keccak256(abi.encode(RELEASE_TYPEHASH, r.account, r.amount, r.nonce, r.deadline));
    }
}
