// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {VoucherBase} from "./base/VoucherBase.sol";
import {GameResourceToken} from "./GameResourceToken.sol";

/**
 * @title ResourceBridge — moves in-game resources on and off chain
 * @notice
 *  - {withdraw}: the server debits a player's in-game resources and signs a {Withdrawal} voucher; the bridge
 *    mints the matching {GameResourceToken} to the player's wallet (so they can trade it on the DEX).
 *  - {deposit}: a player burns resource tokens (with an allowance) to move them back into the game; the server
 *    listens to {Deposited} and credits `playerId` in game.
 *
 * Only tokens registered by the admin are accepted, and only tokens whose immutable `bridge` is this contract.
 * Each token can have a daily mint cap (UTC days; 0 = unlimited) that bounds what a compromised signer could
 * mint per day before the guardian pauses the bridge.
 */
contract ResourceBridge is VoucherBase {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @notice A signed voucher that mints `amount` of `token` to `account`.
    struct Withdrawal {
        address account;
        address token;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 public constant WITHDRAWAL_TYPEHASH =
        keccak256("Withdrawal(address account,address token,uint256 amount,uint256 nonce,uint256 deadline)");

    struct MintWindow {
        uint64 day;
        uint192 minted;
    }

    EnumerableSet.AddressSet private _tokens;
    /// @notice Max amount of a token minted per UTC day; 0 = no limit.
    mapping(address token => uint256 cap) public dailyMintCap;
    mapping(address token => MintWindow) private _window;

    event TokenRegistered(address indexed token, uint256 dailyMintCap);
    event TokenDeregistered(address indexed token);
    event DailyMintCapSet(address indexed token, uint256 previousCap, uint256 newCap);
    event Withdrawn(address indexed account, address indexed token, uint256 indexed nonce, uint256 amount, address signer);
    event Deposited(address indexed account, address indexed token, bytes32 indexed playerId, uint256 amount);

    error ZeroPlayerId();
    error TokenNotRegistered(address token);
    error TokenAlreadyRegistered(address token);
    error WrongBridge(address token, address tokenBridge);
    error DailyMintCapExceeded(address token, uint256 requested, uint256 remaining);

    constructor(address admin) VoucherBase("ResourceBridge", "1", admin) {}

    // ------------------------------------------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------------------------------------------

    /// @notice Accepts `token` (which must be mintable by this bridge) with a daily mint cap (0 = unlimited).
    function registerToken(address token, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        address tokenBridge = GameResourceToken(token).bridge();
        if (tokenBridge != address(this)) revert WrongBridge(token, tokenBridge);
        if (!_tokens.add(token)) revert TokenAlreadyRegistered(token);
        dailyMintCap[token] = cap;
        emit TokenRegistered(token, cap);
    }

    /// @notice Stops accepting `token` in both directions (holders can still trade or burn it).
    function deregisterToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_tokens.remove(token)) revert TokenNotRegistered(token);
        delete dailyMintCap[token];
        emit TokenDeregistered(token);
    }

    /// @notice Changes the daily mint cap of a registered token (0 = unlimited).
    function setDailyMintCap(address token, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_tokens.contains(token)) revert TokenNotRegistered(token);
        emit DailyMintCapSet(token, dailyMintCap[token], cap);
        dailyMintCap[token] = cap;
    }

    // ------------------------------------------------------------------------------------------------------
    // Player entry points
    // ------------------------------------------------------------------------------------------------------

    /// @notice Redeems a server-signed withdrawal voucher: mints `w.amount` of `w.token` to `w.account`.
    function withdraw(Withdrawal calldata w, bytes calldata signature) external whenNotPaused {
        if (w.account == address(0)) revert ZeroAddress();
        if (w.amount == 0) revert ZeroAmount();
        if (!_tokens.contains(w.token)) revert TokenNotRegistered(w.token);
        address signer = _useVoucher(w.account, w.nonce, w.deadline, _withdrawalStructHash(w), signature);
        _consumeMintCap(w.token, w.amount);
        emit Withdrawn(w.account, w.token, w.nonce, w.amount, signer);
        GameResourceToken(w.token).mint(w.account, w.amount);
    }

    /// @notice Burns `amount` of `token` from the caller (needs an allowance) and credits `playerId` in game.
    function deposit(address token, uint256 amount, bytes32 playerId) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (playerId == bytes32(0)) revert ZeroPlayerId();
        if (!_tokens.contains(token)) revert TokenNotRegistered(token);
        emit Deposited(msg.sender, token, playerId, amount);
        GameResourceToken(token).burnFrom(msg.sender, amount);
    }

    // ------------------------------------------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------------------------------------------

    function isRegistered(address token) external view returns (bool) {
        return _tokens.contains(token);
    }

    /// @notice All registered tokens.
    function registeredTokens() external view returns (address[] memory) {
        return _tokens.values();
    }

    /// @notice Amount of `token` minted today (UTC).
    function mintedToday(address token) public view returns (uint256) {
        MintWindow memory w = _window[token];
        return w.day == _utcDay() ? w.minted : 0;
    }

    /// @notice What can still be minted of `token` today (max uint if uncapped).
    function mintRemainingToday(address token) external view returns (uint256) {
        uint256 cap = dailyMintCap[token];
        if (cap == 0) return type(uint256).max;
        uint256 used = mintedToday(token);
        return used >= cap ? 0 : cap - used;
    }

    /// @notice EIP-712 digest the server signs for `w`.
    function hashWithdrawal(Withdrawal calldata w) external view returns (bytes32) {
        return _hashTypedDataV4(_withdrawalStructHash(w));
    }

    // ------------------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------------------

    function _consumeMintCap(address token, uint256 amount) private {
        uint256 day = _utcDay();
        MintWindow memory w = _window[token];
        uint256 used = w.day == day ? w.minted : 0;
        uint256 cap = dailyMintCap[token];
        if (cap != 0 && used + amount > cap) {
            revert DailyMintCapExceeded(token, amount, used >= cap ? 0 : cap - used);
        }
        // Resource supply is unbounded, so the packed counter is range-checked (reverts above 2^192 per day).
        _window[token] = MintWindow(uint64(day), SafeCast.toUint192(used + amount));
    }

    function _withdrawalStructHash(Withdrawal calldata w) private pure returns (bytes32) {
        return keccak256(abi.encode(WITHDRAWAL_TYPEHASH, w.account, w.token, w.amount, w.nonce, w.deadline));
    }
}
