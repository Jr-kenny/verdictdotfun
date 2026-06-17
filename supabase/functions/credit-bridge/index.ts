/**
 * verdictdotfun credit-bridge — Supabase Edge Function (Deno).
 *
 * Hosted port of deploy/credit-bridge.mjs. Invoked every minute by pg_cron -> pg_net
 * (see supabase/migrations/*_credit_bridge_cron.sql). Three idempotent loops:
 *   1. deposits  — vault CreditPurchased events -> ledger.credit (mirror ETH/USDC into credits)
 *   2. redeems   — drain ledger pending redeems -> vault.redeem (cash out to ETH/USDC)
 *   3. finalize  — poke provisional rooms past their challenge window -> finalize_room
 *
 * On-chain dedup makes each tick independent: ledger.credit keys on a deposit ref,
 * vault.redeem keys on redeemId + the ledger's settled flag, and finalize_room is a no-op
 * until the window elapses. A block cursor (credit_bridge_state table) bounds the deposit scan.
 *
 * Reuses Tokenpost's project secrets PRIVATE_KEY / GENLAYER_RPC_URL / BASE_RPC_URL (same bridge
 * wallet 0xa64f…). verdictdotfun-specific config secrets: CREDIT_VAULT_ADDRESS,
 * CREDIT_LEDGER_ADDRESS, VDT_CORE_ADDRESS, CREDIT_TOKENS, optional CREDIT_BRIDGE_FROM_BLOCK.
 */
import { ethers } from "npm:ethers@6";
import { createAccount, createClient as createGlClient } from "npm:genlayer-js@0.23.1";
import { studionet } from "npm:genlayer-js@0.23.1/chains";
import { createClient as createSb } from "npm:@supabase/supabase-js@2";

const ATTO = 10n ** 18n;
const LOG_CHUNK = 450; // under the Base public-RPC getLogs window

function req(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing secret: ${key}`);
  return v;
}
function mget(m: unknown, k: string): unknown {
  if (m && typeof (m as Map<string, unknown>).get === "function") return (m as Map<string, unknown>).get(k);
  return (m as Record<string, unknown>)?.[k];
}

// Public config (addresses + token table) — baked in with env override so the function needs only
// the project's real secrets (PRIVATE_KEY / GENLAYER_RPC_URL / BASE_RPC_URL), already set for the relay.
function cfg(key: string, fallback: string): string {
  return Deno.env.get(key) || fallback;
}
const VAULT_ADDR = cfg("CREDIT_VAULT_ADDRESS", "0x604bb7eb4dBCD4D1bd2A11166367284a5aFD1a9a");
const LEDGER_ADDR = cfg("CREDIT_LEDGER_ADDRESS", "0xeb70F3bbC2706c9cC2A83BEf27B2D07fa1b07De5");
const CORE_ADDR = cfg("VDT_CORE_ADDRESS", "0x9F4Cb5A8cbbE04957976Ee8bCD2d53Ee6e6975dE");
const TOKENS_CFG = cfg(
  "CREDIT_TOKENS",
  "ETH:0x0000000000000000000000000000000000000000:18:2000,USDC:0x036CbD53842c5426634e7929541eC2318f3dCF7e:6:1",
);

// CREDIT_TOKENS = "SYMBOL:address:decimals:creditsPerToken,..."
function parseTokens(raw: string) {
  const byAddr = new Map<string, { symbol: string; address: string; decimals: number; cpt: number }>();
  const bySym = new Map<string, { symbol: string; address: string; decimals: number; cpt: number }>();
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [symbol, address, decimals, cpt] = part.split(":");
    const meta = { symbol, address, decimals: Number(decimals), cpt: Number(cpt) };
    byAddr.set(address.toLowerCase(), meta);
    bySym.set(symbol.toUpperCase(), meta);
  }
  return { byAddr, bySym };
}
function attoForDeposit(rawAmount: bigint, decimals: number, cpt: number): bigint {
  const scale = 18 - decimals;
  const scaled = scale >= 0 ? rawAmount * 10n ** BigInt(scale) : rawAmount / 10n ** BigInt(-scale);
  return scaled * BigInt(cpt);
}
function tokenForAtto(atto: bigint, decimals: number, cpt: number): bigint {
  const a = atto / BigInt(cpt);
  const scale = 18 - decimals;
  return scale >= 0 ? a / 10n ** BigInt(scale) : a * 10n ** BigInt(-scale);
}

const VAULT_ABI = [
  "event CreditPurchased(address indexed buyer, address indexed token, bytes32 indexed profile, uint256 amount, uint256 nonce)",
  "function redeem(address user, address token, uint256 amount, uint256 redeemId) external",
];

function gl() {
  return createGlClient({
    chain: { ...studionet, rpcUrls: { default: { http: [req("GENLAYER_RPC_URL")] } } },
    account: createAccount(`0x${req("PRIVATE_KEY").replace(/^0x/, "")}` as `0x${string}`),
  });
}
function sb() {
  return createSb(req("SUPABASE_URL"), req("SUPABASE_SERVICE_ROLE_KEY"));
}

async function readCursor(db: ReturnType<typeof sb>): Promise<number> {
  const { data } = await db.from("credit_bridge_state").select("last_block").eq("id", 1).maybeSingle();
  return data?.last_block ?? Number(Deno.env.get("CREDIT_BRIDGE_FROM_BLOCK") ?? "0");
}
async function writeCursor(db: ReturnType<typeof sb>, block: number) {
  await db.from("credit_bridge_state").upsert({ id: 1, last_block: block });
}

async function syncDeposits(log: string[]) {
  const provider = new ethers.JsonRpcProvider(req("BASE_RPC_URL"));
  const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, provider);
  const ledger = LEDGER_ADDR;
  const { byAddr } = parseTokens(TOKENS_CFG);
  const client = gl();
  const db = sb();

  const latest = await provider.getBlockNumber();
  let from = await readCursor(db);
  if (from === 0) from = Math.max(0, latest - LOG_CHUNK);
  if (from > latest) return;

  for (let start = from; start <= latest; start += LOG_CHUNK) {
    const end = Math.min(start + LOG_CHUNK - 1, latest);
    const events = await vault.queryFilter(vault.filters.CreditPurchased(), start, end);
    for (const ev of events) {
      const { token, profile, amount, nonce } = (ev as ethers.EventLog).args;
      const ref = `${ev.transactionHash.toLowerCase()}:${BigInt(nonce).toString()}`;
      const meta = byAddr.get(String(token).toLowerCase());
      if (!meta) continue;
      const atto = attoForDeposit(BigInt(amount), meta.decimals, meta.cpt);
      const profileAddr = "0x" + String(profile).slice(-40);
      const txHash = await client.writeContract({
        address: ledger as `0x${string}`,
        functionName: "credit",
        args: [profileAddr, atto.toString(), ref],
      });
      await client.waitForTransactionReceipt({ hash: txHash, status: "ACCEPTED", retries: 30 });
      log.push(`[credit] +${atto} atto -> ${profileAddr} (${ref})`);
    }
  }
  await writeCursor(db, latest + 1);
}

async function syncRedeems(log: string[]) {
  const wallet = new ethers.Wallet(req("PRIVATE_KEY"), new ethers.JsonRpcProvider(req("BASE_RPC_URL")));
  const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, wallet);
  const ledger = LEDGER_ADDR;
  const { bySym } = parseTokens(TOKENS_CFG);
  const client = gl();

  const count = BigInt(
    (await client.readContract({ address: ledger as `0x${string}`, functionName: "get_redeem_count", args: [] })) as
      | string
      | number
      | bigint,
  );
  for (let id = 0n; id < count; id++) {
    const r = await client.readContract({ address: ledger as `0x${string}`, functionName: "get_redeem", args: [id.toString()] });
    if (mget(r, "settled")) continue;
    const meta = bySym.get(String(mget(r, "token")).toUpperCase());
    if (!meta) continue;
    const amount = tokenForAtto(BigInt(String(mget(r, "atto_amount"))), meta.decimals, meta.cpt);
    const tx = await vault.redeem(String(mget(r, "payout_wallet")), meta.address, amount.toString(), id.toString());
    await tx.wait();
    const mh = await client.writeContract({ address: ledger as `0x${string}`, functionName: "mark_redeem_settled", args: [id.toString()] });
    await client.waitForTransactionReceipt({ hash: mh, status: "ACCEPTED", retries: 30 });
    log.push(`[redeem] released ${amount} ${meta.symbol} -> ${mget(r, "payout_wallet")} (id ${id})`);
  }
}

async function syncFinalize(log: string[]) {
  const core = CORE_ADDR;
  const client = gl();
  const roomIds = (await client.readContract({ address: core as `0x${string}`, functionName: "get_room_ids", args: [] })) as string[];
  for (const roomId of roomIds || []) {
    let mode: string | undefined;
    try {
      const entry = await client.readContract({ address: core as `0x${string}`, functionName: "get_room_registry_entry", args: [roomId] });
      mode = String(mget(entry, "contract"));
    } catch {
      continue;
    }
    if (!mode || /^0x0+$/.test(mode)) continue;
    try {
      const room = await client.readContract({ address: mode as `0x${string}`, functionName: "get_room", args: [roomId] });
      if (mget(room, "status") !== "provisional" || mget(room, "appeal_state") === "filed") continue;
      const h = await client.writeContract({ address: mode as `0x${string}`, functionName: "finalize_room", args: [roomId] });
      await client.waitForTransactionReceipt({ hash: h, status: "ACCEPTED", retries: 30 });
      log.push(`[finalize] poked ${roomId}`);
    } catch (e) {
      if (!String((e as Error)?.message ?? "").includes("window")) log.push(`[finalize] ${roomId}: ${(e as Error).message}`);
    }
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-relay-secret",
};

/** The exact message the UI signs to authorize a redeem (must match src/lib/creditRail.ts). */
export function redeemMessage(credits: number, wallet: string, issuedAt: number): string {
  return `Verdict.fun: redeem ${credits} credits to ${wallet} at ${issuedAt}`;
}

// User-initiated cash-out. The wallet signs `redeemMessage`; we verify it, resolve the wallet's
// profile via core, debit credits and queue a PendingRedeem (settled by syncRedeems on the next tick).
async function handleRedeem(body: Record<string, unknown>) {
  const credits = Number(body.credits);
  const wallet = String(body.wallet ?? "");
  const signature = String(body.signature ?? "");
  const issuedAt = Number(body.issuedAt);
  if (!Number.isInteger(credits) || credits <= 0) return json({ error: "Invalid credits amount." }, 400);
  if (!ethers.isAddress(wallet)) return json({ error: "Invalid wallet." }, 400);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 5 * 60_000) {
    return json({ error: "Request expired — try again." }, 400);
  }
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(redeemMessage(credits, wallet, issuedAt), signature);
  } catch {
    return json({ error: "Bad signature." }, 400);
  }
  if (recovered.toLowerCase() !== wallet.toLowerCase()) return json({ error: "Signature mismatch." }, 401);

  const db = sb();
  const { error: dupe } = await db.from("credit_redeem_requests").insert({ signature, wallet: wallet.toLowerCase(), credits });
  if (dupe) return json({ error: "Already submitted." }, 409); // primary-key conflict = replay

  const client = gl();
  const core = CORE_ADDR;
  const profile = String(
    await client.readContract({ address: core as `0x${string}`, functionName: "get_profile_of_owner", args: [wallet] }),
  );
  if (/^0x0+$/.test(profile)) return json({ error: "No profile for this wallet." }, 400);

  const ledger = LEDGER_ADDR;
  const balance = BigInt(
    (await client.readContract({ address: ledger as `0x${string}`, functionName: "get_balance", args: [profile] })) as string,
  );
  const atto = BigInt(credits) * ATTO;
  if (balance < atto) return json({ error: "Insufficient credit balance." }, 400);

  const h = await client.writeContract({
    address: ledger as `0x${string}`,
    functionName: "request_redeem",
    args: [profile, atto.toString(), wallet, "ETH"],
  });
  await client.waitForTransactionReceipt({ hash: h, status: "ACCEPTED", retries: 30 });
  return json({ ok: true, queued: credits });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* empty body = cron tick */
  }

  if (body.action === "redeem") return handleRedeem(body);

  // Cron tick: idempotent loops, optionally gated by a shared secret. Independent of Tokenpost's
  // project-wide RELAY_SECRET; leave CREDIT_RELAY_SECRET unset to run the tick open (safe: idempotent).
  const expected = Deno.env.get("CREDIT_RELAY_SECRET");
  if (expected && request.headers.get("x-relay-secret") !== expected) {
    return new Response("forbidden", { status: 403 });
  }
  const log: string[] = [];
  const started = Date.now();
  const results = await Promise.allSettled([syncDeposits(log), syncRedeems(log), syncFinalize(log)]);
  for (const r of results) if (r.status === "rejected") log.push(`fatal: ${r.reason}`);
  console.log(log.join("\n"));
  return new Response(JSON.stringify({ ok: true, ms: Date.now() - started, log }), {
    headers: { "Content-Type": "application/json" },
  });
});
