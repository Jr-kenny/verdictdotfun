# verdictdotfun

VerdictDotFun is a GenLayer multiplayer game app with persistent on-chain player profiles, live room-based gameplay, and contract-native match resolution.

Instead of treating the blockchain like a place to merely store outcomes, VerdictDotFun treats contracts as the game engine:

- the core contract owns player identity, leaderboard state, and room registration
- game mode contracts run the actual match flow
- player actions advance the game directly on-chain

The current shipped modes are `argue` and `riddle`.

## Deployed contracts

- Core (`verdictdotfun`): [0x26B1ed21bC73895531446e4B1B913F0a87e8BFA1](https://studio.genlayer.com/contracts?import-contract=0x26B1ed21bC73895531446e4B1B913F0a87e8BFA1)
- Mode (`argue`): [0x70836563637f4EdeC812e1ECA58AC6a21591B048](https://studio.genlayer.com/contracts?import-contract=0x70836563637f4EdeC812e1ECA58AC6a21591B048)
- Mode (`riddle`): [0xF50432BB1A90DE73A5e1D128b272E7294EE353C1](https://studio.genlayer.com/contracts?import-contract=0xF50432BB1A90DE73A5e1D128b272E7294EE353C1)

## Why this project exists

Most on-chain games still feel like transaction demos. Users click through a sequence of writes, but the game loop itself is not really encoded into the contract flow.

VerdictDotFun is built around a different idea:

- players should have a persistent identity
- rooms should feel like live multiplayer spaces
- contracts should advance the match, not just record it
- the game loop should avoid unnecessary extra transactions

That design goal shaped the current architecture and gameplay rules.

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

## What makes it different

VerdictDotFun is not just a frontend that sends transactions to static contracts. The gameplay itself is modeled in the contracts:

- room creation is routed through a shared core registry
- `argue` prompts are generated on-chain and the final submission resolves the room immediately
- `riddle` guesses are checked immediately on-chain and the room advances automatically
- match outcomes update persistent profile progression on-chain
- tied rooms are handled explicitly instead of being treated like failures

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

## Shipped gameplay rules

### Argue

- The room owner opens either a `debate` or `convince` room
- The contract generates the prompt after both players are ready
- Each player submits one argument
- The final submission triggers verdict resolution in the same transaction

### Riddle

- Each room contains 3 riddles
- Every guess is checked immediately on-chain
- The fastest correct guess wins that riddle immediately
- Each player gets up to 3 guesses per riddle
- If both players miss all 3 guesses, the contract advances to the next riddle automatically
- After 3 riddles, the higher score wins and equal scores resolve as a tie

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

## Why it matters

VerdictDotFun is a useful GenLayer demo because it shows a full multiplayer product loop instead of an isolated contract gimmick:

- player identity persists across matches
- multiple game modes share the same progression system
- the room lifecycle is contract-driven
- the game flow has been tightened so users do not need unnecessary follow-up transactions just to finish a normal turn

## Limitations / TODO

- The frontend still reads room lists directly from the mode contracts instead of reading a unified room index from the core.
- There are only two shipped modes right now: argue and riddle.
- No profile transfer flow.
- No quiz mode.
