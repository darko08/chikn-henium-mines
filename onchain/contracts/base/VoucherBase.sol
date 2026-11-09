// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title VoucherBase
 * @notice Shared logic for the game gateways that act on EIP-712 vouchers signed by the game server
 *         ({HeniumEmission}, {HeniumGameVault}, {ResourceBridge}).
 *
 * A voucher is accepted once, and only when:
 *  1. `block.timestamp <= deadline`;
 *  2. it was signed (EIP-712, ECDSA, low-s only) by an address holding SIGNER_ROLE;
 *  3. its `(account, nonce)` pair has never been used or cancelled.
 *
 * The EIP-712 domain contains the chain id and this contract's address, so a voucher signed for another chain,
 * another deployment or another gateway recovers to a different address and is rejected.
 *
 * Nonces are a per-account bitmap (256 nonces per storage word): any unused nonce can be used exactly once, in
 * any order, so the server can have several vouchers outstanding for the same player without them invalidating
 * each other. The server can revoke a voucher it issued with {cancelNonce}. A voucher that was neither redeemed
 * nor cancelled is dead once its deadline has passed, which is when the server may safely refund the player.
 *
 * Roles: DEFAULT_ADMIN_ROLE manages roles (multisig + timelock in production), SIGNER_ROLE signs vouchers
 * (game server key; several keys may hold it, which allows rotation without downtime), PAUSER_ROLE (guardian)
 * can pause and unpause.
 */
abstract contract VoucherBase is AccessControl, Pausable, EIP712 {
    /// @notice Role whose holders sign vouchers (the game server).
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    /// @notice Role whose holders can pause and unpause (a guardian).
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @dev account => word index (nonce >> 8) => bitmap of used nonces.
    mapping(address account => mapping(uint256 wordIndex => uint256 bitmap)) private _usedNonces;

    /// @notice A voucher nonce was revoked before use.
    event NonceCancelled(address indexed account, uint256 indexed nonce, address indexed cancelledBy);

    error ZeroAddress();
    error ZeroAmount();
    error VoucherExpired(uint256 deadline, uint256 timestamp);
    error NonceAlreadyUsed(address account, uint256 nonce);
    error InvalidSigner(address recovered);

    /**
     * @param name    EIP-712 domain name (one per gateway contract).
     * @param version EIP-712 domain version.
     * @param admin   Receives DEFAULT_ADMIN_ROLE.
     */
    constructor(string memory name, string memory version, address admin) EIP712(name, version) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------------------------------------------
    // Guardian
    // ------------------------------------------------------------------------------------------------------

    /// @notice Stops every voucher redemption (and the gateway's other state-changing user functions).
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resumes normal operation.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------------------------------------------------
    // Nonces
    // ------------------------------------------------------------------------------------------------------

    /// @notice True if `nonce` was already redeemed or cancelled for `account`.
    function isNonceUsed(address account, uint256 nonce) public view returns (bool) {
        return (_usedNonces[account][nonce >> 8] & (uint256(1) << (nonce & 0xff))) != 0;
    }

    /**
     * @notice Revokes an outstanding voucher so that it can never be redeemed.
     * @dev Only SIGNER_ROLE (the issuer) may cancel, so that the server always knows whether a voucher it
     *      issued was redeemed (event of the gateway) or cancelled (by itself). Works while paused.
     */
    function cancelNonce(address account, uint256 nonce) external onlyRole(SIGNER_ROLE) {
        _useNonce(account, nonce);
        emit NonceCancelled(account, nonce, msg.sender);
    }

    /// @notice The EIP-712 domain separator of this gateway (chain id and address included).
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------------------------------------------

    /**
     * @dev Validates a voucher and burns its nonce. Reverts unless the deadline has not passed, the signature
     *      recovers to a SIGNER_ROLE holder, and the nonce is unused. Returns the signer (for events).
     * @param structHash `keccak256(abi.encode(TYPEHASH, ...fields))` of the voucher.
     */
    function _useVoucher(
        address account,
        uint256 nonce,
        uint256 deadline,
        bytes32 structHash,
        bytes calldata signature
    ) internal returns (address signer) {
        if (block.timestamp > deadline) revert VoucherExpired(deadline, block.timestamp);
        // ECDSA.recover rejects malformed signatures and high-s (malleable) signatures.
        signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (!hasRole(SIGNER_ROLE, signer)) revert InvalidSigner(signer);
        _useNonce(account, nonce);
    }

    function _useNonce(address account, uint256 nonce) private {
        mapping(uint256 => uint256) storage words = _usedNonces[account];
        uint256 wordIndex = nonce >> 8;
        uint256 bit = uint256(1) << (nonce & 0xff);
        uint256 word = words[wordIndex];
        if (word & bit != 0) revert NonceAlreadyUsed(account, nonce);
        words[wordIndex] = word | bit;
    }

    /// @dev Day index used by the gateways' rate limits (UTC days since the Unix epoch).
    function _utcDay() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
