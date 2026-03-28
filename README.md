# Verdict Arena

Verdict Arena now runs through `VDTCore` on GenLayer with an optional Base Sepolia `Verdict NFT` mirror:

- `contracts/vdt_core.py` governs the app, creates profiles, deploys child room contracts, and exposes the leaderboard
- `contracts/player_profile.py` stores transferable player handle, rank, seasonal XP, and record state
- `contracts/debate_game.py`, `contracts/convince_me_game.py`, `contracts/quiz_game.py`, and `contracts/riddle_game.py` act as intelligent child room contracts
- `contracts/evm/VerdictProfileNft.sol` is the optional Base Sepolia `Verdict NFT` badge layer

The React/Vite client uses:

- `genlayer-js` for GenLayer reads and writes
- `pnpm` for all JavaScript package management

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
