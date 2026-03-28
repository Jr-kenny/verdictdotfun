# Verdict Arena

Verdict Arena is a GenLayer game hub built around one root contract: `VDTCore`.

At a high level, the idea is:

- each wallet creates one transferable on-chain player profile
- that profile becomes the player's identity across all game modes
- `VDTCore` deploys and tracks child room contracts for each game mode
- child room contracts run the actual match logic
- completed matches update the owning player's profile with wins, losses, and XP
- an optional Base Sepolia `Verdict NFT` mirrors long-term badge progress outside GenLayer

Main contracts:

- `contracts/vdt_core.py`: root registry and coordinator for profiles, rooms, leaderboard, operators, and seasonal resets
- `contracts/player_profile.py`: per-player contract storing handle, seasonal rank, XP, and lifetime record
- `contracts/debate_game.py`, `contracts/convince_me_game.py`, `contracts/quiz_game.py`, `contracts/riddle_game.py`: child room contracts for each mode
- `contracts/evm/VerdictProfileNft.sol`: optional Base Sepolia badge mirror

Frontend/runtime stack:

- `genlayer-js` for GenLayer reads and writes
- `pnpm` for JavaScript package management
- React + Vite for the client

## Runtime model

- Gameplay transactions happen on `GenLayer Studionet` in this workspace
- The production-style final can then be copied into `verdictdotfun` and pointed at `TestnetBradbury`
- The profile system now lives on GenLayer as `VDTCore` + one `PlayerProfile` contract per player
- A wallet can own at most one profile, and the profile can be transferred to a new wallet
- An optional Base Sepolia `Verdict NFT` can mirror a linked profile as a permanent badge
- `VDTCore` deploys one child room contract per room based on the selected mode
- Game rooms are keyed by profile address when the core is configured
- Debate and convince-me rooms generate their own prompts on-chain at room creation
- Quiz rooms generate a full question set on-chain, store canonical answers, validate each answer with a read call, and only resolve XP after the full round completes
- Riddle rooms generate the clue, canonical answer, and acceptable aliases on-chain
- The relayer can mint the `Verdict NFT` once a profile reaches permanent level 2 (`1000` permanent XP)
- Permanent badge XP does not reset monthly; seasonal rank still resets on the GenLayer profile contract

## How VDTCore Works

`VDTCore` is the root contract for the whole app. It is not the per-player profile itself and it is not a single room. It sits above both.

Its role is to act like the protocol registry and coordinator:

- it stores the canonical profile code
- it stores the canonical room code for each mode
- it deploys one `PlayerProfile` contract per wallet
- it maps wallet -> profile and profile -> wallet
- it deploys room contracts on demand
- it maps room id -> room contract and room id -> mode
- it decides which contracts are approved game contracts
- it exposes profile reads and leaderboard reads for the frontend
- it allows operators to advance the season and reset profiles in batches

In practice, the app talks to `VDTCore` first for almost everything:

- "does this wallet have a profile?"
- "what is this wallet's profile data?"
- "what room contract belongs to this room id?"
- "what mode is this room?"
- "what are the room ids?"
- "who is on the leaderboard?"

### Mental model

Think of the system as:

1. `VDTCore` = root hub
2. `PlayerProfile` = one contract per player
3. room contracts = one contract per match/room

So the app does not directly create a profile by deploying `player_profile.py` itself. It asks `VDTCore` to do that. The same is true for rooms: the app asks `VDTCore` to create a room, and `VDTCore` deploys the correct child contract for that mode.

## Core VDTCore Functions

These are the most important functions in `contracts/vdt_core.py`.

### Profile functions

- `create_profile(handle)`
  Creates one new `PlayerProfile` contract for the calling wallet.
  It rejects the call if that wallet already owns a profile.

- `transfer_profile(new_owner)`
  Moves profile ownership from the current wallet to another wallet.
  `VDTCore` updates both ownership maps:
  wallet -> profile and profile -> wallet.

- `get_profile(owner)`
  Returns the full profile object for a wallet.
  If the wallet has no profile, it returns an empty/default profile-shaped object.

- `get_profile_by_address(profile_address)`
  Returns the full profile object for a profile contract address.

- `get_profile_of_owner(owner)`
  Returns the profile contract address owned by a wallet.

- `get_profile_owner(profile)`
  Returns the wallet that currently owns the given profile contract.

- `get_profile_count()`
  Returns how many player profiles have been created.

- `get_profile_at(index)`
  Returns the profile address at a specific index in the stored profile list.

- `is_registered_profile(profile)`
  Returns whether a profile contract is registered in the system.

### Room functions

- `create_room(mode, room_id, category, owner_profile)`
  Creates a room for a specific mode.
  `VDTCore` verifies the caller owns the supplied profile, chooses the correct room code, deploys the child room contract, records it, and then calls that child room contract's `create_room(...)`.

- `get_room_ids()`
  Returns all known room ids.

- `get_room_contract(room_id)`
  Returns the child room contract address for a room id.

- `get_room_mode(room_id)`
  Returns the mode string for a room id.

### Game approval and admin functions

- `approve_game_contract(game_address, allowed)`
  Marks a game contract as approved or unapproved.
  This matters because player profiles only accept match-result updates from approved game contracts.

- `is_game_contract(game)`
  Returns whether a contract is approved as a game contract.

- `set_operator(operator, allowed)`
  Lets the owner assign operator wallets that can manage seasonal tasks.

- `set_profile_code(code)`
  Updates the source code used for newly deployed player profiles.

- `set_room_code(mode, code)`
  Updates the source code used for newly deployed rooms of a given mode.

- `start_new_season(season_id)`
  Moves the system to a new season.
  This does not itself loop through and reset every profile immediately.

- `reset_profiles_batch(start_index, batch_size)`
  Resets profiles in batches for the new season.
  This is designed so seasonal resets can be done safely over time instead of trying to reset every profile in one transaction.

- `upgrade(new_code)`
  Allows the owner to replace the root contract code.

### Read functions used heavily by the frontend

For frontend routing and app state, these are the most important ones:

- `get_profile(owner)`
- `get_room_ids()`
- `get_room_contract(room_id)`
- `get_room_mode(room_id)`
- `get_leaderboard(limit)`

If these reads are unstable on a network, the app will feel unstable even if the contracts themselves are correct.

## How PlayerProfile Works

Each player gets a dedicated `PlayerProfile` contract deployed by `VDTCore`.

That profile stores:

- `handle`
- `season_id`
- `rank_tier`
- `rank_division`
- `xp`
- `season_total_xp`
- `wins`
- `losses`
- `lifetime_wins`
- `lifetime_losses`
- `processed_matches`

Important behavior:

- only the current profile owner can rename the handle
- only approved game contracts can apply match results
- match ids are tracked so the same room cannot award results twice
- wins add XP
- losses subtract seasonal XP pressure
- season sync can happen automatically when the profile notices the factory season changed
- hard seasonal reset is also available from `VDTCore` via batch processing

### XP and rank idea

The profile system is designed to give players two kinds of progression:

- seasonal competitive progress
- lifetime identity/history

Seasonal values:

- rank tier
- rank division
- current XP
- seasonal wins/losses

Lifetime values:

- lifetime wins
- lifetime losses

This means the player can keep one persistent identity while still participating in recurring ranked seasons.

## Local setup

1. Install frontend dependencies:

```bash
pnpm install
```

2. Install contract tooling:

```bash
pip install -r requirements.txt
```

3. Copy environment config:

```bash
cp .env.example .env
```

4. Fill in the browser env vars in `.env`:

```bash
VITE_VDT_CORE_CONTRACT_ADDRESS=
VITE_VERDICT_NFT_CONTRACT_ADDRESS=
VITE_BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
```

If `VITE_VDT_CORE_CONTRACT_ADDRESS` is blank, the app has no active GenLayer arena contract to talk to.

## GenLayer deployment

GenLayer docs recommend progressing from localnet to Studionet and then to TestnetBradbury for production-like validation. This repo is currently set up to use `studionet` in-place and `testnetBradbury` for the final copy.

Set `GENLAYER_DEPLOYER_PRIVATE_KEY` and deploy the full Studionet stack:

```bash
pnpm deploy:contract
```

Useful env vars for deployment:

```bash
PROFILE_INITIAL_SEASON=1
GENLAYER_CHAIN=testnetBradbury
GENLAYER_ENDPOINT=https://rpc-bradbury.genlayer.com
```

That deploy prints JSON for:

- `vdtCore`

Take that printed address and place it in `VITE_VDT_CORE_CONTRACT_ADDRESS`.

If you are upgrading an older `ProfileFactory` deployment in place, use:

```bash
pnpm deploy:upgrade
```

The upgraded `VDTCore` must preserve the original storage prefix, and the upgrade flow needs to reseed `player_profile.py` plus each room contract code after the code swap.

## Verdict NFT Mirror

The optional EVM badge contract is:

- [VerdictProfileNft.sol](/Users/LDC/Documents/verdict-arena/contracts/evm/VerdictProfileNft.sol)

Its job is different from the GenLayer profile contract:

- GenLayer `PlayerProfile` is the seasonal gameplay source of truth
- Base Sepolia `Verdict NFT` is the permanent collectible badge mirror

How it works:

- the relayer watches all GenLayer profiles
- no NFT is minted at profile creation
- once permanent XP reaches `1000`, the relayer mints one NFT tied to that profile address
- `tokenId` is the numeric form of the profile contract address
- while linked, the relayer mirrors profile ownership changes onto the NFT
- the NFT can be explicitly unlinked from the app; once unlinked, relayer ownership mirroring stops

Permanent badge levels:

- level `1`: below `1000` permanent XP
- level `2`: `1000`
- each next level doubles the previous upgrade requirement
- capped at level `10`

Deploy the badge contract on Base Sepolia:

```bash
pnpm compile:evm
pnpm deploy:profile:nft
```

Optional operator setup for the relayer:

```bash
VERDICT_NFT_OPERATOR=0x...
pnpm deploy:profile:nft:operator
```

Relevant env vars:

```bash
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_SEPOLIA_PRIVATE_KEY=
VERDICT_NFT_OWNER=
VERDICT_NFT_OPERATOR=
VERDICT_NFT_CONTRACT_ADDRESS=
VERDICT_NFT_RELAYER_PRIVATE_KEY=
```

The GenLayer relayer also handles:

- room auto-resolution
- profile result retry sync
- Verdict NFT mint/sync/linked-owner mirroring

## Profile Contracts

The profile system is:

- [vdt_core.py](/Users/LDC/Documents/verdict-arena/contracts/vdt_core.py)
- [player_profile.py](/Users/LDC/Documents/verdict-arena/contracts/player_profile.py)

`VDTCore` deploys one `PlayerProfile` per wallet, enforces one-wallet-one-profile ownership, handles transfers, deploys room contracts, exposes the leaderboard, approves child game contracts, and drives seasonal resets.

`PlayerProfile` stores:

- mutable handle
- current season
- rank tier and division
- XP progress to the next division
- wins and losses
- lifetime wins and losses

Monthly reset behavior:

- `Bronze 1-5` -> `Bronze 1`
- `Silver 1-5` -> `Silver 1`
- `Gold 1-5` -> `Gold 1`
- `Platinum 1-5` -> `Platinum 1`
- `Diamond 1-5` -> `Diamond 1`

## Product idea summary

Verdict Arena is trying to make on-chain identity matter across multiple AI-native games.

The product idea is:

- your wallet gets one portable player identity
- that identity is stored as its own GenLayer profile contract
- all supported game modes feed the same profile
- rooms are disposable child contracts, but the player identity persists
- seasonal competition can reset without deleting the long-term player record
- optional NFT mirroring gives a more permanent public badge layer outside GenLayer

So the app is not just "play one game room". The bigger idea is a reusable competitive identity layer for many AI-judged room types.

## Run the app

```bash
pnpm dev
```

## Verification

Frontend checks:

```bash
pnpm check
pnpm build
```

GenLayer contract direct tests:

```bash
pnpm contract:test
```
