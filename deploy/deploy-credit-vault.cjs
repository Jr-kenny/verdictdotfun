const hre = require("hardhat");

async function main() {
  const owner = process.env.CREDIT_VAULT_OWNER || (await hre.ethers.getSigners())[0].address;
  const bridge = process.env.CREDIT_VAULT_BRIDGE;
  if (!bridge) throw new Error("Set CREDIT_VAULT_BRIDGE (relayer authority address).");

  const Vault = await hre.ethers.getContractFactory("CreditVault");
  const vault = await Vault.deploy(owner, bridge);
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  console.log("CreditVault deployed:", address);

  const usdc = process.env.CREDIT_VAULT_USDC;
  if (usdc) {
    const tx = await vault.setTokenAllowed(usdc, true);
    await tx.wait();
    console.log("Allowed USDC:", usdc);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
