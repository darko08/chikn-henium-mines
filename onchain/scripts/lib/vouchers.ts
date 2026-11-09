/**
 * EIP-712 voucher helpers — the reference for what the game server signs.
 *
 * The server keeps the player ledger off chain. When a player earns HENIUM (refining, guild wars, hunts), asks to
 * take HENIUM out of the game, or to withdraw resources, the server debits/records it, picks an unused nonce for
 * that player, and signs one of these typed messages with a SIGNER_ROLE key (ideally an HSM/KMS key). The player
 * (or a relayer) submits it to the gateway contract. Rules for the server:
 *  - one nonce per voucher, never reused (any unused uint256 works: nonces are a bitmap on chain);
 *  - short deadlines (minutes to hours); a voucher that was neither redeemed (event) nor cancelled is dead after
 *    its deadline, and only then may the server refund the player in game;
 *  - to revoke earlier, call `cancelNonce(account, nonce)` from a SIGNER_ROLE key, then refund.
 */
import type { Signer, TypedDataDomain } from "ethers";

/** Emission categories, in the contract's enum order. */
export enum Category {
  REFINERY = 0,
  WAR = 1,
  HUNT = 2,
}

export const CLAIM_TYPES = {
  Claim: [
    { name: "account", type: "address" },
    { name: "category", type: "uint8" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const RELEASE_TYPES = {
  Release: [
    { name: "account", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const WITHDRAWAL_TYPES = {
  Withdrawal: [
    { name: "account", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export interface ClaimVoucher {
  account: string;
  category: number;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}

export interface ReleaseVoucher {
  account: string;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}

export interface WithdrawalVoucher {
  account: string;
  token: string;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** EIP-712 domain names of the gateways (version "1"). */
export const DOMAIN_NAMES = {
  emission: "HeniumEmission",
  vault: "HeniumGameVault",
  bridge: "ResourceBridge",
} as const;

export interface Addressable {
  getAddress(): Promise<string>;
}

/** Builds the EIP-712 domain of a deployed gateway. */
export async function domainFor(
  contract: Addressable,
  name: string,
  chainId: bigint,
  version = "1",
): Promise<TypedDataDomain> {
  return { name, version, chainId, verifyingContract: await contract.getAddress() };
}

export function signClaim(signer: Signer, domain: TypedDataDomain, v: ClaimVoucher): Promise<string> {
  return signer.signTypedData(domain, CLAIM_TYPES, v);
}

export function signRelease(signer: Signer, domain: TypedDataDomain, v: ReleaseVoucher): Promise<string> {
  return signer.signTypedData(domain, RELEASE_TYPES, v);
}

export function signWithdrawal(signer: Signer, domain: TypedDataDomain, v: WithdrawalVoucher): Promise<string> {
  return signer.signTypedData(domain, WITHDRAWAL_TYPES, v);
}
