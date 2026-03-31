# verdictdotfun

`verdictdotfun` is a GenLayer game app with one canonical core contract and two live game modes:

- `argue`: one contract that supports `debate` and `convince` room styles
- `riddle`: five-riddle head-to-head matches

The canonical root contract is [`contracts/verdictdotfun.py`](C:\Users\LDC\Documents\verdictdotfun\contracts\verdictdotfun.py). It owns player identity, leaderboard state, rank progression, seasonal reset data, and approved game-contract permissions.

## Contract architecture

- [`contracts/verdictdotfun.py`](C:\Users\LDC\Documents\verdictdotfun\contracts\verdictdotfun.py)
  Permanent one-wallet-one-profile identity, XP, wins/losses, leaderboard, operators, seasonal resets, and room registry.
- [`contracts/argue_game.py`](C:\Users\LDC\Documents\verdictdotfun\contracts\argue_game.py)
  Generates either debate motions or convince-me scenarios based on `argue_style`.
- [`contracts/riddle_game.py`](C:\Users\LDC\Documents\verdictdotfun\contracts\riddle_game.py)
  Generates five riddles and resolves the match when a player reaches three solves or the pack ends.

Game contracts report finalized room results back to the core contract with cross-contract `emit(...)` calls. The core treats game contracts as approved reporters for profile updates.

## Current product rules

- One permanent profile per wallet.
- No profile transfer flow.
- No quiz mode.
- `argue` and `riddle` are the only shipped modes.
- Room creation should go through the core contract, not directly to a mode contract.

## Frontend

The app is a React + Vite frontend using `genlayer-js` and `pnpm`.

Important runtime files:

- [`src/lib/verdictArena.ts`](C:\Users\LDC\Documents\verdictdotfun\src\lib\verdictArena.ts)
- [`src/lib/profileFactory.ts`](C:\Users\LDC\Documents\verdictdotfun\src\lib\profileFactory.ts)
- [`src/context/ArenaContext.tsx`](C:\Users\LDC\Documents\verdictdotfun\src\context\ArenaContext.tsx)

## Environment

Browser app:

```bash
VITE_GENLAYER_CHAIN=testnetBradbury
VITE_GENLAYER_ENDPOINT=
VITE_REOWN_PROJECT_ID=
VITE_VERDICTDOTFUN_CONTRACT_ADDRESS=
VITE_VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS=
VITE_VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS=
VITE_VERDICT_NFT_CONTRACT_ADDRESS=
VITE_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

Deploy and maintenance scripts:

```bash
GENLAYER_CHAIN=testnetBradbury
GENLAYER_ENDPOINT=
GENLAYER_DEPLOYER_PRIVATE_KEY=
PROFILE_INITIAL_SEASON=1
VERDICTDOTFUN_CONTRACT_ADDRESS=
VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS=
VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS=
```

Legacy `VITE_VDT_*` and `VDT_*` variables still work as fallbacks, but the preferred names now use `VERDICTDOTFUN_*`.

## Install

```bash
pnpm install
pip install -r requirements.txt
```

## Checks

```bash
pnpm contract:test
pnpm typecheck
pnpm lint
pnpm build
```

## Deploy to GenLayer Testnet Bradbury

Deploy the core and both live game contracts:

```bash
pnpm deploy:contract
```

Upgrade an existing deployment:

```bash
pnpm deploy:upgrade
```

Run the cross-contract smoke test:

```bash
pnpm deploy:smoke:c2c
```

## Notes

- GenLayer docs should be treated as the source of truth for contract interaction and deployment behavior.
- The app assumes the core contract is configured for real gameplay deployments.
- The direct contract smoke test remains `xfail` under the current local direct VM because multi-contract execution there is not stable enough to treat as authoritative.
