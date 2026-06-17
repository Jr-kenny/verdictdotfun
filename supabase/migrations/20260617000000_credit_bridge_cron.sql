-- verdictdotfun credit-bridge: deposit-scan cursor + per-minute trigger.
-- Deployed alongside Tokenpost's relay in the same project; this adds an independent
-- job that pokes the credit-bridge Edge Function (idempotent, so safe to run every minute).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Block cursor for the vault deposit scan (single row, id = 1).
create table if not exists public.credit_bridge_state (
  id          integer primary key,
  last_block  bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- Replay guard for user redeem requests (the signed signature is the unique key).
create table if not exists public.credit_redeem_requests (
  signature   text primary key,
  wallet      text not null,
  credits     bigint not null,
  created_at  timestamptz not null default now()
);

-- Per-minute tick. The endpoint runs open (loops are idempotent); to lock it down, set
-- CREDIT_RELAY_SECRET via `supabase secrets set` and add a matching 'x-relay-secret' header here.
select cron.schedule(
  'credit-bridge-tick',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://peeqjjqpomjpdmnpogfs.functions.supabase.co/credit-bridge',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- To remove later:  select cron.unschedule('credit-bridge-tick');
