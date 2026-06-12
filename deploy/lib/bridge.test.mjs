import { describe, it, expect } from "vitest";
import {
  depositRef,
  attoCreditsForDeposit,
  tokenAmountForAtto,
  profileFromBytes32,
} from "./bridge.mjs";

const CREDIT = 10n ** 18n;

describe("depositRef", () => {
  it("composes a stable idempotency key from tx hash and nonce", () => {
    expect(depositRef("0xABCDEF", 7n)).toBe("0xabcdef:7");
  });
});

describe("attoCreditsForDeposit", () => {
  it("converts 1.0 USDC (6 decimals, 1:1) to 1 credit (atto)", () => {
    expect(attoCreditsForDeposit({ rawAmount: 1_000_000n, decimals: 6, creditsPerToken: 1 }))
      .toBe(CREDIT);
  });

  it("converts 0.5 ETH (18 decimals) at 2000 credits/ETH to 1000 credits", () => {
    expect(
      attoCreditsForDeposit({ rawAmount: 5n * 10n ** 17n, decimals: 18, creditsPerToken: 2000 })
    ).toBe(1000n * CREDIT);
  });
});

describe("tokenAmountForAtto", () => {
  it("is the inverse of the deposit conversion for USDC", () => {
    const atto = attoCreditsForDeposit({ rawAmount: 2_500_000n, decimals: 6, creditsPerToken: 1 });
    expect(tokenAmountForAtto({ attoAmount: atto, decimals: 6, creditsPerToken: 1 }))
      .toBe(2_500_000n);
  });

  it("is the inverse for ETH at a non-1 rate", () => {
    const atto = attoCreditsForDeposit({ rawAmount: 10n ** 18n, decimals: 18, creditsPerToken: 2000 });
    expect(tokenAmountForAtto({ attoAmount: atto, decimals: 18, creditsPerToken: 2000 }))
      .toBe(10n ** 18n);
  });
});

describe("profileFromBytes32", () => {
  it("extracts the trailing 20-byte address from a bytes32 profile id", () => {
    const b32 = "0x000000000000000000000000abc1230000000000000000000000000000000001";
    expect(profileFromBytes32(b32)).toBe("0xabc1230000000000000000000000000000000001");
  });
});
