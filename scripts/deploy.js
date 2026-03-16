require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();

  const relayerAddress = process.env.RELAYER_ADDRESS || deployer.address;
  const precompileAddress =
    process.env.SOMNIA_REACTIVITY_PRECOMPILE ||
    "0x0000000000000000000000000000000000000100";

  console.log("Deploying with:", deployer.address);
  console.log("Relayer:", relayerAddress);
  console.log("Somnia precompile:", precompileAddress);

  const PolymarketTradeBridge = await ethers.getContractFactory("PolymarketTradeBridge");
  const tradeBridge = await PolymarketTradeBridge.deploy(deployer.address, relayerAddress);
  await tradeBridge.waitForDeployment();

  const PolySignalReactive = await ethers.getContractFactory("PolySignalReactive");
  const reactive = await PolySignalReactive.deploy(
    deployer.address,
    await tradeBridge.getAddress(),
    precompileAddress
  );
  await reactive.waitForDeployment();

  console.log("PolymarketTradeBridge:", await tradeBridge.getAddress());
  console.log("PolySignalReactive:", await reactive.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
