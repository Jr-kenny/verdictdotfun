// Pure helpers for the credit bridge. No network access — unit tested.

const ATTO = 10n ** 18n;

/** Stable idempotency key for a deposit event. */
export function depositRef(txHash, nonce) {
  return `${String(txHash).toLowerCase()}:${BigInt(nonce).toString()}`;
}

/**
 * Convert a raw on-chain token amount into atto-credits.
 * atto = rawAmount * 10^(18 - decimals) * creditsPerToken
 * creditsPerToken is an integer count of credits per ONE whole token.
 */
export function attoCreditsForDeposit({ rawAmount, decimals, creditsPerToken }) {
  const raw = BigInt(rawAmount);
  const scale = 18 - Number(decimals);
  const scaled = scale >= 0 ? raw * 10n ** BigInt(scale) : raw / 10n ** BigInt(-scale);
  return scaled * BigInt(creditsPerToken);
}

/** Inverse of attoCreditsForDeposit: atto-credits → raw token amount. */
export function tokenAmountForAtto({ attoAmount, decimals, creditsPerToken }) {
  const atto = BigInt(attoAmount) / BigInt(creditsPerToken);
  const scale = 18 - Number(decimals);
  return scale >= 0 ? atto / 10n ** BigInt(scale) : atto * 10n ** BigInt(-scale);
}

/** Decode a bytes32 GenLayer profile id into a 20-byte address string. */
export function profileFromBytes32(profile) {
  return "0x" + String(profile).slice(-40);
}

export const ATTO_PER_CREDIT = ATTO;
