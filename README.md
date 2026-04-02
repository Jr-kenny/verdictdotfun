# verdictdotfun

GenLayer game app with on-chain profiles, live rooms, and two shipped modes: argue and riddle.

## What this project is

This repo has two parts:

- a React frontend in `src/`
- GenLayer contracts in `contracts/`

The root contract is `contracts/verdictdotfun.py`. It owns player profiles, seasonal stats, leaderboard data, approved game contracts, and the room registry.

There are two mode contracts:

- `contracts/argue_game.py`
- `contracts/riddle_game.py`

`argue` supports two room styles: `debate` and `convince`.

`riddle` runs a three-round match. Each guess resolves immediately, each player gets up to three tries per riddle, and the higher score after three riddles wins. Equal scores resolve as a tie.

There is also an optional EVM profile badge/NFT mirror under `contracts/evm/` and the related deploy scripts in `deploy/`.

## How it works

1. The user connects an EVM wallet through Reown/AppKit.
2. The user creates a profile on the core contract with `create_profile`.
3. The lobby loads the active game contracts and reads live rooms from the mode contracts.
4. Room creation goes through `verdictdotfun.create_room(...)` on the core contract.
5. The core stores the room id, mode, owner profile, and target mode contract, then forwards room creation to the selected mode contract.
6. The forwarded call is mode-specific: `argue` receives `argue_style`; `riddle` does not.
7. Joining, starting, submitting, resolving, and forfeiting happen on the mode contract for that room.
8. When a room resolves, the mode contract reports the winner and loser back to the core with `apply_match_result`.
9. The frontend reads profile data and leaderboard data from the core contract.
10. If the optional relayer is running, profile data can also be mirrored to the Base Sepolia NFT contract.

## Key features

- One permanent profile per wallet
- Seasonal profile stats and leaderboard
- Argue rooms with `debate` and `convince`
- Riddle rooms with immediate on-chain guess resolution and three tries per player per riddle
- Core contract keeps the room registry and approved mode contracts
- Local alias fallback when the core contract is not configured
- Optional Base Sepolia profile badge sync

## Tech stack

- React 18
- Vite
- TypeScript
- TanStack Query
- Reown AppKit with Wagmi
- `genlayer-js`
- Python GenLayer contracts
- Hardhat for the EVM badge contract
- Vitest and Playwright

## Setup

```bash
pnpm install
pip install -r requirements.txt
cp .env.example .env
```

## Usage

1. Put your StudioNet addresses and deployer key in `.env`.
2. Start the app with `pnpm dev`.
3. Connect a wallet.
4. Mint a profile.
5. Open a room from the lobby.
6. Share the room code with another player.
7. Play the match and wait for the on-chain result.
8. Check the leaderboard for updated profile stats.

Useful commands:

```bash
pnpm deploy:contract
pnpm deploy:bind:modes
pnpm deploy:upgrade
pnpm deploy:smoke:c2c
pnpm relayer
```

## Testing

Frontend tests:

```bash
pnpm test
```

Direct contract tests:

```bash
C:\Users\LDC\AppData\Local\Programs\Python\Python312\python.exe -m pytest tests/direct -q -p no:cacheprovider
```

These direct tests cover the shipped single-contract game flows and core room-routing behavior.

## Upgrade flow

Use the upgrade script when you need to patch an already deployed contract in place:

```bash
pnpm deploy:upgrade
```

Relevant env vars:

- `UPGRADE_TARGET=all|verdictdotfun|argue|riddle`
- `UPGRADE_WAIT_STATUS=accepted|finalized`
- `GENLAYER_CHAIN`
- `GENLAYER_ENDPOINT`
- `GENLAYER_DEPLOYER_PRIVATE_KEY`
- `VERDICTDOTFUN_CONTRACT_ADDRESS`
- `VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS`
- `VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS`

## Notes / decisions

- StudioNet is the current target network.
- The core contract is the source of truth for profiles, leaderboard state, approved game contracts, and room registration.
- Room creation goes through the core contract. Room play goes through the mode contract.
- The frontend still supports a local alias path for cases where the core contract is not configured.
- The mode contracts are fixed addresses in the current app config and are bound to the core with `set_mode_contract`.

## Limitations / TODO

- The frontend still reads room lists directly from the mode contracts instead of reading a unified room index from the core.
- There are only two shipped modes right now: argue and riddle.
- No profile transfer flow.
- No quiz mode.
