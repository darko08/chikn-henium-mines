// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VoucherBase} from "./base/VoucherBase.sol";
import {HeniumToken} from "./HeniumToken.sol";

/**
 * @title HeniumEmission — the bitcoin-like HENIUM schedule
 * @notice The only HENIUM minter in production. The whole world can mint at most
 *         `dailyEmission(day) = initialDailyEmission >> (day / halvingIntervalDays)` per day (0 after 64 halvings),
 *         split into fixed category shares: 70% refiners, 20% guild-war fighters, 10% monster hunters.
 *         With the defaults (7,200 HENIUM/day, a halving every 1,458 days ~ 4 years) the first epoch releases
 *         10,497,600 HENIUM and the whole schedule 20,995,200 HENIUM — like bitcoin's 10.5M / 21M.
 *
 * How HENIUM reaches players: the game server computes each player's share of the day's emission (refinery
 * power share, war points, hunt points — see the game's `G.refShare`, `G.warShare`, `G.huntShare`) and signs an
 * EIP-712 {Claim} voucher. Anyone may submit it (relayers welcome); HENIUM always goes to `claim.account`.
 *
 * The contract enforces trustlessly, whatever the server signs:
 *  - category budgets: `mintedByCategory[c] + amount <= cumulativeEmission(today) * share[c] / 10_000`
 *    (unclaimed budget carries over to later days, it is never lost);
 *  - the 21M cap, counting the genesis allocation and every HENIUM ever issued — burns do not create new
 *    emission room. A claim that would cross the cap is CLAMPED to what is left (the event reports both the
 *    requested and the minted amount, and `claim` returns the minted amount); once nothing is left it reverts.
 *    Like the game prototype, nothing is ever paid out beyond the 21M;
 *  - optional per-account and global daily limits (rate limits against a compromised signer);
 *  - voucher deadline, single-use nonces, the signer's SIGNER_ROLE, and the EIP-712 domain (chain + contract).
 *
 * Genesis: an optional `genesisAmount` for a treasury, minted once by {mintGenesis} after this contract receives
 * MINTER_ROLE. It is reserved at construction and counts toward the 21M cap. Because the schedule itself already
 * totals ~20.9952M, any genesis above `cap - totalScheduledEmission()` (4,800 HENIUM with the defaults) means the
 * cap truncates the far tail of the emission: the last epochs then mint less, or nothing.
 */
contract HeniumEmission is VoucherBase {
    // ------------------------------------------------------------------------------------------------------
    // Types & constants
    // ------------------------------------------------------------------------------------------------------

    /// @notice Who earns the HENIUM: refiners (work), guild-war fighters, monster hunters.
    enum Category {
        REFINERY,
        WAR,
        HUNT
    }

    /// @notice A signed claim voucher. `category` is encoded as uint8 in the EIP-712 type.
    struct Claim {
        address account;
        Category category;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(address account,uint8 category,uint256 amount,uint256 nonce,uint256 deadline)");

    uint256 public constant BPS = 10_000;
    uint256 public constant REFINERY_SHARE_BPS = 7_000;
    uint256 public constant WAR_SHARE_BPS = 2_000;
    uint256 public constant HUNT_SHARE_BPS = 1_000;

    /// @notice After this many halvings the daily emission is zero (as `x >> 64` would be for bitcoin's satoshis).
    uint256 public constant MAX_HALVINGS = 64;

    /// @notice Defaults used by the deploy script: 7,200 HENIUM/day, halving every 1,458 days (~4 years).
    uint256 public constant DEFAULT_INITIAL_DAILY_EMISSION = 7_200e18;
    uint256 public constant DEFAULT_HALVING_INTERVAL_DAYS = 1_458;

    // ------------------------------------------------------------------------------------------------------
    // Immutable parameters
    // ------------------------------------------------------------------------------------------------------

    HeniumToken public immutable token;
    /// @notice Unix time at which day 0 starts.
    uint256 public immutable genesisTime;
    /// @notice HENIUM per day in epoch 0 (18 decimals).
    uint256 public immutable initialDailyEmission;
    /// @notice Days per epoch; the daily emission halves at every epoch boundary.
    uint256 public immutable halvingIntervalDays;
    /// @notice One-time treasury allocation (counts toward the cap).
    uint256 public immutable genesisAmount;
    address public immutable genesisTreasury;
    /// @notice The token's cap (21M HENIUM), read at construction.
    uint256 public immutable supplyCap;
    /// @notice Sum of the whole schedule: all days of all 64 epochs (before the cap is applied).
    uint256 public immutable totalScheduledEmission;

    // ------------------------------------------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------------------------------------------

    /// @notice HENIUM minted through claims per category.
    mapping(Category category => uint256 minted) public mintedByCategory;
    /// @notice Genesis allocation (reserved from construction) plus all HENIUM minted by claims. Never decreases.
    uint256 public totalIssued;
    /// @notice HENIUM minted by claims (excludes genesis).
    uint256 public totalClaimed;
    /// @notice Whether the genesis allocation has been minted (true from the start when there is none).
    bool public genesisMinted;

    /// @notice Max HENIUM one account may claim per emission day; 0 = no limit.
    uint256 public accountDailyLimit;
    /// @notice Max HENIUM all accounts together may claim per emission day; 0 = no limit.
    uint256 public globalDailyLimit;

    struct DailyUsage {
        uint64 day;
        uint192 amount;
    }

    mapping(address account => DailyUsage) private _accountUsage;
    DailyUsage private _globalUsage;

    // ------------------------------------------------------------------------------------------------------
    // Events & errors
    // ------------------------------------------------------------------------------------------------------

    event Claimed(
        address indexed account,
        Category indexed category,
        uint256 indexed nonce,
        uint256 requested,
        uint256 minted,
        address signer
    );
    event GenesisMinted(address indexed treasury, uint256 amount);
    event AccountDailyLimitSet(uint256 previousLimit, uint256 newLimit);
    event GlobalDailyLimitSet(uint256 previousLimit, uint256 newLimit);

    error InvalidSchedule();
    error GenesisExceedsCap(uint256 genesisAmount, uint256 cap);
    error GenesisAlreadyMinted();
    error EmissionNotStarted(uint256 genesisTime);
    error CategoryBudgetExceeded(Category category, uint256 requested, uint256 available);
    error SupplyCapReached();
    error AccountDailyLimitExceeded(address account, uint256 requested, uint256 remaining);
    error GlobalDailyLimitExceeded(uint256 requested, uint256 remaining);

    // ------------------------------------------------------------------------------------------------------
    // Construction
    // ------------------------------------------------------------------------------------------------------

    /**
     * @param token_                The HENIUM token (this contract must be granted its MINTER_ROLE).
     * @param admin                 DEFAULT_ADMIN_ROLE (multisig + timelock in production).
     * @param genesisTime_          Unix time of day 0 (may be in the future for a scheduled launch).
     * @param initialDailyEmission_ HENIUM per day in epoch 0 (default 7,200e18). Must be > 0 and <= cap.
     * @param halvingIntervalDays_  Days per epoch (default 1,458). Must be in [1, 2^32 - 1].
     * @param genesisAmount_        Optional treasury allocation (0 for none), counts toward the cap.
     * @param genesisTreasury_      Receives the genesis allocation (required if `genesisAmount_ > 0`).
     */
    constructor(
        HeniumToken token_,
        address admin,
        uint256 genesisTime_,
        uint256 initialDailyEmission_,
        uint256 halvingIntervalDays_,
        uint256 genesisAmount_,
        address genesisTreasury_
    ) VoucherBase("HeniumEmission", "1", admin) {
        if (address(token_) == address(0)) revert ZeroAddress();
        uint256 cap = token_.cap();
        // Bounds keep every schedule computation far from overflow: sums stay below 2 * 2^32 * cap.
        if (initialDailyEmission_ == 0 || initialDailyEmission_ > cap) revert InvalidSchedule();
        if (halvingIntervalDays_ == 0 || halvingIntervalDays_ > type(uint32).max) revert InvalidSchedule();
        if (genesisAmount_ > cap) revert GenesisExceedsCap(genesisAmount_, cap);
        if (genesisAmount_ != 0 && genesisTreasury_ == address(0)) revert ZeroAddress();

        token = token_;
        genesisTime = genesisTime_;
        initialDailyEmission = initialDailyEmission_;
        halvingIntervalDays = halvingIntervalDays_;
        genesisAmount = genesisAmount_;
        genesisTreasury = genesisTreasury_;
        supplyCap = cap;

        uint256 total;
        for (uint256 e; e < MAX_HALVINGS; ++e) {
            total += (initialDailyEmission_ >> e) * halvingIntervalDays_;
        }
        totalScheduledEmission = total;

        // The genesis allocation is reserved now, so claims can never eat into it.
        totalIssued = genesisAmount_;
        genesisMinted = genesisAmount_ == 0;
    }

    /**
     * @notice Mints the genesis allocation to the treasury. Callable once, by anyone, after this contract holds
     *         MINTER_ROLE on the token. Amount and recipient are immutable, so there is nothing to trust.
     */
    function mintGenesis() external {
        if (genesisMinted) revert GenesisAlreadyMinted();
        genesisMinted = true;
        emit GenesisMinted(genesisTreasury, genesisAmount);
        token.mint(genesisTreasury, genesisAmount);
    }

    // ------------------------------------------------------------------------------------------------------
    // Claims
    // ------------------------------------------------------------------------------------------------------

    /**
     * @notice Redeems a server-signed claim voucher and mints HENIUM to `c.account`.
     * @return minted The amount actually minted: `c.amount`, or less if only that much is left under the 21M cap.
     */
    function claim(Claim calldata c, bytes calldata signature) external whenNotPaused returns (uint256 minted) {
        if (c.account == address(0)) revert ZeroAddress();
        if (c.amount == 0) revert ZeroAmount();
        if (block.timestamp < genesisTime) revert EmissionNotStarted(genesisTime);

        address signer = _useVoucher(c.account, c.nonce, c.deadline, _claimStructHash(c), signature);

        uint256 day = (block.timestamp - genesisTime) / 1 days;

        // 1. category budget: everything emitted for days 0..today, times the category's share.
        //    Invariant: used <= budget (budgets only grow; `used` only grows by amounts that fitted).
        uint256 budget = (cumulativeEmission(day) * shareBps(c.category)) / BPS;
        uint256 used = mintedByCategory[c.category];
        uint256 available = budget - used;
        if (c.amount > available) revert CategoryBudgetExceeded(c.category, c.amount, available);

        // 2. hard cap, including the genesis allocation: clamp to what is left.
        uint256 capLeft = supplyCap - totalIssued;
        if (capLeft == 0) revert SupplyCapReached();
        minted = c.amount < capLeft ? c.amount : capLeft;

        // 3. optional rate limits.
        _consumeDailyLimits(c.account, day, minted);

        mintedByCategory[c.category] = used + minted;
        totalIssued += minted;
        totalClaimed += minted;
        emit Claimed(c.account, c.category, c.nonce, c.amount, minted, signer);

        token.mint(c.account, minted);
    }

    // ------------------------------------------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------------------------------------------

    /// @notice Sets the per-account daily claim limit (0 disables it). Usage is tracked only while enabled.
    function setAccountDailyLimit(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit AccountDailyLimitSet(accountDailyLimit, newLimit);
        accountDailyLimit = newLimit;
    }

    /// @notice Sets the global daily claim limit (0 disables it). Usage is tracked only while enabled.
    function setGlobalDailyLimit(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit GlobalDailyLimitSet(globalDailyLimit, newLimit);
        globalDailyLimit = newLimit;
    }

    // ------------------------------------------------------------------------------------------------------
    // Schedule views
    // ------------------------------------------------------------------------------------------------------

    /// @notice Share of the daily emission that goes to `category`, in basis points.
    function shareBps(Category category) public pure returns (uint256) {
        if (category == Category.REFINERY) return REFINERY_SHARE_BPS;
        if (category == Category.WAR) return WAR_SHARE_BPS;
        return HUNT_SHARE_BPS;
    }

    /// @notice Epoch (number of halvings so far) of emission day `day`.
    function epochOf(uint256 day) public view returns (uint256) {
        return day / halvingIntervalDays;
    }

    /// @notice HENIUM emitted on day `day`: `initial >> epoch`, or 0 after 64 halvings.
    function dailyEmission(uint256 day) public view returns (uint256) {
        uint256 epoch = day / halvingIntervalDays;
        return epoch >= MAX_HALVINGS ? 0 : initialDailyEmission >> epoch;
    }

    /**
     * @notice Total HENIUM emitted for days 0..day inclusive (the world's budget to date).
     * @dev Closed form per epoch: each complete epoch e contributes `interval * (initial >> e)`, the current epoch
     *      `(day % interval + 1) * (initial >> epoch)`. At most 64 iterations, independent of the number of days.
     */
    function cumulativeEmission(uint256 day) public view returns (uint256 total) {
        uint256 interval = halvingIntervalDays;
        uint256 epoch = day / interval;
        if (epoch >= MAX_HALVINGS) return totalScheduledEmission;
        uint256 initial = initialDailyEmission;
        for (uint256 e; e < epoch; ++e) {
            total += (initial >> e) * interval;
        }
        total += (initial >> epoch) * (day - epoch * interval + 1);
    }

    /// @notice Whether day 0 has started.
    function hasStarted() public view returns (bool) {
        return block.timestamp >= genesisTime;
    }

    /// @notice Current emission day (0 before genesis — check {hasStarted}).
    function currentDay() public view returns (uint256) {
        return hasStarted() ? (block.timestamp - genesisTime) / 1 days : 0;
    }

    /// @notice Current epoch (number of halvings so far; 0 before genesis).
    function currentEpoch() external view returns (uint256) {
        return epochOf(currentDay());
    }

    /// @notice Today's daily emission (0 before genesis).
    function currentDailyEmission() external view returns (uint256) {
        return hasStarted() ? dailyEmission(currentDay()) : 0;
    }

    /// @notice Unix time at which `epoch` starts (epoch 1 = first halving).
    function epochStartTime(uint256 epoch) public view returns (uint256) {
        return genesisTime + epoch * halvingIntervalDays * 1 days;
    }

    /// @notice Unix time of the next halving.
    function nextHalvingTime() external view returns (uint256) {
        return epochStartTime(epochOf(currentDay()) + 1);
    }

    /// @notice World emission budget for days 0..today (0 before genesis).
    function budgetToDate() public view returns (uint256) {
        return hasStarted() ? cumulativeEmission(currentDay()) : 0;
    }

    /// @notice Budget of `category` for days 0..today.
    function categoryBudget(Category category) public view returns (uint256) {
        return (budgetToDate() * shareBps(category)) / BPS;
    }

    /// @notice What `category` can still mint right now: its unclaimed budget, limited by what is left of the cap.
    function categoryRemaining(Category category) external view returns (uint256) {
        uint256 left = categoryBudget(category) - mintedByCategory[category];
        uint256 capLeft = remainingSupply();
        return left < capLeft ? left : capLeft;
    }

    /// @notice HENIUM that can still ever be issued under the cap (the genesis allocation is already counted).
    function remainingSupply() public view returns (uint256) {
        return supplyCap - totalIssued;
    }

    // ------------------------------------------------------------------------------------------------------
    // Rate-limit views
    // ------------------------------------------------------------------------------------------------------

    /// @notice HENIUM `account` has claimed today (tracked only while the account limit is enabled).
    function accountClaimedToday(address account) public view returns (uint256) {
        DailyUsage memory u = _accountUsage[account];
        return hasStarted() && u.day == currentDay() ? u.amount : 0;
    }

    /// @notice HENIUM claimed by everyone today (tracked only while the global limit is enabled).
    function globalClaimedToday() public view returns (uint256) {
        DailyUsage memory u = _globalUsage;
        return hasStarted() && u.day == currentDay() ? u.amount : 0;
    }

    /// @notice What `account` may still claim today under the per-account limit (max uint if disabled).
    function accountDailyRemaining(address account) external view returns (uint256) {
        return _remaining(accountDailyLimit, accountClaimedToday(account));
    }

    /// @notice What may still be claimed today under the global limit (max uint if disabled).
    function globalDailyRemaining() external view returns (uint256) {
        return _remaining(globalDailyLimit, globalClaimedToday());
    }

    // ------------------------------------------------------------------------------------------------------
    // Voucher helpers
    // ------------------------------------------------------------------------------------------------------

    /// @notice EIP-712 digest the server signs for `c` (handy to cross-check off-chain signers).
    function hashClaim(Claim calldata c) external view returns (bytes32) {
        return _hashTypedDataV4(_claimStructHash(c));
    }

    function _claimStructHash(Claim calldata c) private pure returns (bytes32) {
        return keccak256(abi.encode(CLAIM_TYPEHASH, c.account, c.category, c.amount, c.nonce, c.deadline));
    }

    // ------------------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------------------

    function _consumeDailyLimits(address account, uint256 day, uint256 amount) private {
        // Amounts stay far below 2^192: everything ever claimed is bounded by the 21M cap.
        uint256 limit = accountDailyLimit;
        if (limit != 0) {
            DailyUsage memory u = _accountUsage[account];
            uint256 used = u.day == day ? u.amount : 0;
            if (used + amount > limit) revert AccountDailyLimitExceeded(account, amount, _remaining(limit, used));
            _accountUsage[account] = DailyUsage(uint64(day), uint192(used + amount));
        }
        limit = globalDailyLimit;
        if (limit != 0) {
            DailyUsage memory g = _globalUsage;
            uint256 used = g.day == day ? g.amount : 0;
            if (used + amount > limit) revert GlobalDailyLimitExceeded(amount, _remaining(limit, used));
            _globalUsage = DailyUsage(uint64(day), uint192(used + amount));
        }
    }

    function _remaining(uint256 limit, uint256 used) private pure returns (uint256) {
        if (limit == 0) return type(uint256).max;
        return used >= limit ? 0 : limit - used;
    }
}
