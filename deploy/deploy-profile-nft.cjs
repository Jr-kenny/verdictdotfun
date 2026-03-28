const hre = require("hardhat");
const ERC1967_IMPLEMENTATION_SLOT = "0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No Base Sepolia signer found. Set BASE_SEPOLIA_PRIVATE_KEY in .env before deploying.");
  }

  const owner = process.env.VERDICT_NFT_OWNER || deployer.address;
  const operator = process.env.VERDICT_NFT_OPERATOR || "";
  const name = process.env.VERDICT_NFT_NAME || "Verdict NFT";
  const symbol = process.env.VERDICT_NFT_SYMBOL || "VNFT";
  const baseUri = process.env.VERDICT_NFT_BASE_URI || "";

  const factory = await hre.ethers.getContractFactory("VerdictProfileNft");
  const contract = await hre.upgrades.deployProxy(factory, [owner, name, symbol, baseUri], {
    initializer: "initialize",
    kind: "uups",
  });

  await contract.waitForDeployment();

  const proxyAddress = await contract.getAddress();
  const implementationSlot = await hre.ethers.provider.getStorage(proxyAddress, ERC1967_IMPLEMENTATION_SLOT);
  const implementationAddress = hre.ethers.getAddress(`0x${implementationSlot.slice(-40)}`);

  if (operator) {
    const tx = await contract.setOperator(operator, true);
    await tx.wait();
  }

  console.log(JSON.stringify(
    {
      network: "baseSepolia",
      deployer: deployer.address,
      owner,
      operator: operator || null,
      proxyAddress,
      implementationAddress,
    },
    null,
    2,
  ));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
