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

  const MockPolymarket = await ethers.getContractFactory("MockPolymarket");
  const mockPolymarket = await MockPolymarket.deploy(deployer.address, relayerAddress);
  await mockPolymarket.waitForDeployment();

  const PolySignalReactive = await ethers.getContractFactory("PolySignalReactive");
  const reactive = await PolySignalReactive.deploy(
    deployer.address,
    await mockPolymarket.getAddress(),
    precompileAddress
  );
  await reactive.waitForDeployment();

  console.log("MockPolymarket:", await mockPolymarket.getAddress());
  console.log("PolySignalReactive:", await reactive.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
