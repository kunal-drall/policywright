/**
 * Network constants shared by the recorder and the dry-run harness.
 *
 * The native-asset (XLM) Stellar Asset Contract has no deployment step: its
 * address is a function of the network passphrase alone
 * (`Asset.native().contractId(passphrase)`), so the harness can name "XLM"
 * on any network without a network read. Verified against the SAC metadata
 * the recorder resolved live on testnet (docs/FACTS.md §12.1).
 */

import { Asset, Networks } from '@stellar/stellar-sdk';
import type { Network } from './types.js';

/** Network passphrases per {@link Network}. */
export const NETWORK_PASSPHRASES: Record<Network, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
  futurenet: Networks.FUTURENET,
};

/** The native XLM Stellar Asset Contract address for a network. */
export function nativeSacContractId(network: Network): string {
  return Asset.native().contractId(NETWORK_PASSPHRASES[network]);
}

/**
 * True when a string has the StrKey *shape* of a contract address: the `C`
 * version prefix followed by 55 base32 characters (56 in total). This is a
 * shape check, not a checksum check — it is what the argument-derivation rule
 * uses to tell a `Vec<Address>` of token contracts from other vectors.
 */
export function isContractAddressShaped(value: unknown): value is string {
  return typeof value === 'string' && CONTRACT_ADDRESS_SHAPE.test(value);
}

/** The StrKey contract-address shape: `C` + 55 base32 characters. */
export const CONTRACT_ADDRESS_SHAPE = /^C[A-Z2-7]{55}$/;
