# Verdict Arena

Verdict Arena now runs as a four-surface app:

- `contracts/debate_game.py` for proposer-versus-opposer debates
- `contracts/convince_me_game.py` for stance-shifting persuasion matches
- `contracts/quiz_game.py` for head-to-head quiz answers
- `contracts/evm/VerdictProfileNft.sol` for the upgradable player profile NFT

The React/Vite client uses:

- `genlayer-js` for GenLayer reads and writes
- `viem` for profile NFT reads and minting
- `pnpm` for all JavaScript package management

## Runtime model

- Gameplay transactions happen on `Genlayer Bradbury Testnet`
- The profile NFT is expected on `Base Sepolia`
- The app prompts the wallet to switch networks when the user moves between minting and gameplay
- Each GenLayer game contract can emit finalized XP updates into the profile NFT through the EVM interface

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
VITE_DEBATE_CONTRACT_ADDRESS=
VITE_CONVINCE_ME_CONTRACT_ADDRESS=
VITE_QUIZ_CONTRACT_ADDRESS=
VITE_PROFILE_NFT_CONTRACT_ADDRESS=
```

## GenLayer deployment

Set `GENLAYER_DEPLOYER_PRIVATE_KEY` and then deploy each game contract separately:

```bash
GAME_MODE=debate pnpm deploy:contract
GAME_MODE=convince pnpm deploy:contract
GAME_MODE=quiz pnpm deploy:contract
```

Useful env vars for deployment:

```bash
PROFILE_NFT_CONTRACT_ADDRESS=0x...
CONVINCE_ME_HOUSE_STANCE=WhatsApp is bad.
GENLAYER_CHAIN=testnetBradbury
GENLAYER_ENDPOINT=https://rpc-bradbury.genlayer.com
```

Take each printed address and place it in the matching `VITE_*_CONTRACT_ADDRESS` variable.

## Profile NFT

The profile contract source is in [contracts/evm/VerdictProfileNft.sol](/Users/LDC/Documents/verdict-arena/contracts/evm/VerdictProfileNft.sol).

It is written as a proxy-safe UUPS implementation and exposes:

- `mintProfile(handle)`
- `hasProfile(owner)`
- `getProfile(owner)`
- `applyMatchResult(matchId, winner, loser, winnerXp, loserPenalty, mode)`

The frontend assumes this contract is already deployed and that `VITE_PROFILE_NFT_CONTRACT_ADDRESS` points at the proxy address. This repo does not yet include an EVM deployment pipeline, so deploy that contract with your preferred Solidity toolchain before using the production mint flow.

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
