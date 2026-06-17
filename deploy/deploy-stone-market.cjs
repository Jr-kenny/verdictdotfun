const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

// Deploys the StoneMarket (non-custodial ETH marketplace for Verdict Stones) to Base Sepolia.
//
//   STONE_HUB_ADDRESS       VerdictStoneHub (default: live hub)
//   STONE_MARKET_TREASURY   fee recipient (default: deployer)
//   STONE_MARKET_FEE_BPS    fee in basis points (default 250 = 2.5%)
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const hub = process.env.STONE_HUB_ADDRESS || "0x6D612207Eea47Ccbd2Bab0D99bAaa54fFb189609";
  const treasury = process.env.STONE_MARKET_TREASURY || deployer.address;
  const feeBps = Number(process.env.STONE_MARKET_FEE_BPS || "250");

  console.log(`Deployer: ${deployer.address}  hub: ${hub}  treasury: ${treasury}  feeBps: ${feeBps}`);

  const Market = await hre.ethers.getContractFactory("StoneMarket");
  const market = await Market.deploy(hub, deployer.address, treasury, feeBps);
  await market.waitForDeployment();
  const address = await market.getAddress();
  console.log("StoneMarket:", address);

  const record = {
    network: "base-sepolia",
    chainId: 84532,
    deployedAt: new Date().toISOString().slice(0, 10),
    deployer: deployer.address,
    explorer: "https://sepolia.basescan.org",
    note: "Non-custodial, approval-based ETH marketplace for Verdict Stones. A sale transfers the stone via the hub, which emits StoneOwnerChanged -> bridge relay -> GenLayer rebind, the same path as any transfer.",
    contracts: {
      StoneMarket: { address, hub, treasury, feeBps },
    },
  };
  fs.writeFileSync(
    path.resolve(__dirname, "deployments", "stone-market-base-sepolia.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log(`\nSet VITE_STONE_MARKET_ADDRESS=${address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
