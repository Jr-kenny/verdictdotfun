import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  getAddress,
  http,
  isAddress,
  pad,
  parseEther,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { arenaEnv } from "@/lib/env";
import type { BrowserEthereumProvider } from "@/lib/ethereum";
import { createArenaClient } from "@/lib/genlayer";

// The credit rail: deposit ETH into the EVM CreditVault (Base Sepolia), which the credit-bridge
// relay mirrors into atto-credit balances on the GenLayer CreditLedger. Credits fund room wagers.

const ATTO = 10n ** 18n;

const vaultAbi = [
  { type: "function", name: "depositEth", stateMutability: "payable", inputs: [{ name: "profile", type: "bytes32" }], outputs: [] },
] as const;

function vaultAddress(): Address | null {
  return arenaEnv.creditVaultAddress && isAddress(arenaEnv.creditVaultAddress)
    ? getAddress(arenaEnv.creditVaultAddress)
    : null;
}

function profileToBytes32(profileAddress: string): `0x${string}` {
  return pad(getAddress(profileAddress), { size: 32 });
}

/** Credits (whole, floored) currently held by a profile on the GenLayer ledger. */
export async function fetchCreditBalance(profileAddress: string): Promise<number> {
  if (!arenaEnv.creditLedgerAddress || !isAddress(profileAddress)) return 0;
  const client = createArenaClient();
  const atto = (await client.readContract({
    address: arenaEnv.creditLedgerAddress as Address,
    functionName: "get_balance",
    args: [getAddress(profileAddress)],
  })) as bigint | string | number;
  return Number(BigInt(atto) / ATTO);
}

/** ETH -> credits at the configured rate (matches the bridge's CREDIT_TOKENS conversion). */
export function creditsForEth(amountEth: string): number {
  const n = Number(amountEth);
  return Number.isFinite(n) ? Math.floor(n * arenaEnv.creditsPerEth) : 0;
}

export function formatCredits(value: number): string {
  return value.toLocaleString("en-US");
}

/** Buy credits: deposit `amountEth` ETH into the vault, attributed to the caller's profile. */
export async function depositEthForCredits(
  amountEth: string,
  profileAddress: string,
  account: Address,
  provider: BrowserEthereumProvider,
) {
  const vault = vaultAddress();
  if (!vault) throw new Error("Credit vault is not configured.");
  if (!isAddress(profileAddress)) throw new Error("A permanent profile is required to buy credits.");
  const value = parseEther(amountEth);
  if (value <= 0n) throw new Error("Enter an amount greater than zero.");

  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: custom(provider) });
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(arenaEnv.profileEvmRpcUrl) });
  const hash = await walletClient.writeContract({
    address: vault,
    abi: vaultAbi,
    functionName: "depositEth",
    args: [profileToBytes32(profileAddress)],
    value,
    account,
    chain: baseSepolia,
  });
  return publicClient.waitForTransactionReceipt({ hash });
}

export { formatEther };
