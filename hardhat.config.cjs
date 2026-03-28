require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-verify");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const baseSepoliaPrivateKey = process.env.BASE_SEPOLIA_PRIVATE_KEY;

/** @type {import("hardhat/config").HardhatUserConfig} */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    baseSepolia: {
      url: baseSepoliaRpcUrl,
      chainId: 84532,
      accounts: baseSepoliaPrivateKey ? [baseSepoliaPrivateKey] : [],
    },
  },
  etherscan: {
    apiKey: {
      baseSepolia: process.env.BASESCAN_API_KEY || "",
    },
  },
  paths: {
    sources: "./contracts/evm",
    cache: "./hardhat-cache",
    artifacts: "./hardhat-artifacts",
  },
};
