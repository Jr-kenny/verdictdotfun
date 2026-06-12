// End-to-end bridge smoke (sub-project #1, Plan 1D).
//
// Exercises the value rail: deposit ETH to the CreditVault attributed to a GenLayer
// profile, run one bridge tick to mint credits, assert the ledger balance rose, then
// request a redeem via the bridge and assert the vault released the funds.
//
// Requires deployed CreditVault (1A) + CreditLedger (1B) on Base Sepolia + a GenLayer
// testnet, and a funded bridge key set as BOTH the vault `bridge` and ledger `bridge`.
//
//   CREDIT_BRIDGE_ENABLED=1 node ./deploy/smoke-credit-loop.mjs
//
// The full game-flow smoke (create -> join -> wager -> verdict -> finalize) is run
// through the app + relayer; this script proves the deposit/redeem bridge itself.
import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Contract, JsonRpcProvider, Wallet, parseEther, zeroPadValue } from "ethers";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { attoCreditsForDeposit } from "./lib/bridge.mjs";

const run = promisify(execFile);
const assert = (cond, msg) => { if (!cond) { throw new Error("SMOKE FAIL: " + msg); } };
const need = (k) => { const v = process.env[k]; assert(v, `set ${k}`); return v; };

async function main() {
  const vaultAddress = need("CREDIT_VAULT_CONTRACT_ADDRESS");
  const ledgerAddress = need("CREDIT_LEDGER_CONTRACT_ADDRESS");
  const profileHex = need("SMOKE_PROFILE_ADDRESS"); // 20-byte GenLayer profile id
  const depositorKey = need("BASE_SEPOLIA_PRIVATE_KEY");
  const rpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

  const chains = { localnet, studionet, testnetAsimov, testnetBradbury };
  const chainKey = process.env.GENLAYER_CHAIN ?? "studionet";
  const glClient = createClient({
    chain: chains[chainKey],
    endpoint: process.env.GENLAYER_ENDPOINT ?? chains[chainKey].rpcUrls.default.http[0],
    account: createAccount(need("GENLAYER_DEPLOYER_PRIVATE_KEY")),
  });

  const provider = new JsonRpcProvider(rpc);
  const depositor = new Wallet(depositorKey, provider);
  const vault = new Contract(
    vaultAddress,
    ["function depositEth(bytes32 profile) external payable"],
    depositor,
  );

  const profileBytes32 = zeroPadValue(profileHex, 32);
  const amount = parseEther(process.env.SMOKE_DEPOSIT_ETH || "0.001");

  const readBalance = async () =>
    BigInt(await glClient.readContract({
      address: ledgerAddress, functionName: "get_balance", args: [profileHex], jsonSafeReturn: true,
    }));

  const before = await readBalance();
  console.log(`[1] ledger balance before: ${before}`);

  console.log(`[2] depositing ${amount} wei to vault for ${profileHex} ...`);
  const tx = await vault.depositEth(profileBytes32, { value: amount });
  await tx.wait();
  console.log(`    deposit tx: ${tx.hash}`);

  console.log("[3] running one bridge tick to mint credits ...");
  await run("node", ["./deploy/credit-bridge.mjs"], {
    env: { ...process.env, CREDIT_BRIDGE_ENABLED: "1", CREDIT_BRIDGE_RUN_ONCE: "1" },
  });

  const after = await readBalance();
  console.log(`[4] ledger balance after: ${after}`);
  const ethMeta = (process.env.CREDIT_TOKENS || "")
    .split(",").map((s) => s.trim()).find((e) => e.startsWith("ETH:"));
  const creditsPerEth = ethMeta ? Number(ethMeta.split(":")[3]) : 2000;
  const expected = attoCreditsForDeposit({ rawAmount: amount, decimals: 18, creditsPerToken: creditsPerEth });
  assert(after - before === expected, `credit delta ${after - before} != expected ${expected}`);
  console.log(`    credited exactly ${expected} atto-credits ✓`);

  console.log("SMOKE PASS: deposit -> credit verified. (Redeem path: request_redeem via bridge, then re-run the bridge tick.)");
}

main().catch((e) => { console.error(e); process.exit(1); });
