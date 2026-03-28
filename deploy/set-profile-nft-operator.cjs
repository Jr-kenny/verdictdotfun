const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  if (!signer) {
    throw new Error("No Base Sepolia signer found. Set BASE_SEPOLIA_PRIVATE_KEY in .env first.");
  }

  const proxyAddress =
    process.env.VERDICT_NFT_CONTRACT_ADDRESS ||
    process.env.VITE_VERDICT_NFT_CONTRACT_ADDRESS;
  const operator = process.env.VERDICT_NFT_OPERATOR;

  if (!proxyAddress) {
    throw new Error("Set VERDICT_NFT_CONTRACT_ADDRESS or VITE_VERDICT_NFT_CONTRACT_ADDRESS.");
  }
  if (!operator) {
    throw new Error("Set VERDICT_NFT_OPERATOR.");
  }

  const contract = await hre.ethers.getContractAt("VerdictProfileNft", proxyAddress, signer);
  const alreadyAllowed = await contract.operators(operator);
  if (alreadyAllowed) {
    console.log(`Operator already enabled: ${operator}`);
    return;
  }

  const tx = await contract.setOperator(operator, true);
  await tx.wait();
  console.log(`Operator enabled: ${operator}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
