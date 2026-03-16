require("dotenv").config();
const { applyClashProxyEnv, normalizePrivateKey } = require("./lib/proxy");
applyClashProxyEnv();

const { SDK } = require("@somnia-chain/reactivity");
const {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  stringToHex,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const privateKey = normalizePrivateKey(requireEnv("PRIVATE_KEY"));
  const account = privateKeyToAccount(privateKey);
  const somniaTestnet = defineChain({
    id: Number(process.env.SOMNIA_CHAIN_ID || 50312),
    name: "Somnia Testnet",
    network: "somnia-testnet",
    nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
    rpcUrls: {
      default: {
        http: [process.env.SOMNIA_RPC_URL || "https://dream-rpc.somnia.network"],
      },
    },
  });

  const publicClient = createPublicClient({
    chain: somniaTestnet,
    transport: http(),
  });
  const walletClient = createWalletClient({
    account,
    chain: somniaTestnet,
    transport: http(),
  });
  const sdk = new SDK({
    public: publicClient,
    wallet: walletClient,
  });

  const txHash = await sdk.createSoliditySubscription({
    eventTopics: [
      keccak256(
        stringToHex(
          "TradeBridged(bytes32,bytes32,address,uint256,uint8,uint64,uint32,uint256,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint16,uint64,string)"
        )
      ),
    ],
    emitter: getAddress(requireEnv("POLYMARKET_TRADE_BRIDGE_ADDRESS")),
    handlerContractAddress: getAddress(requireEnv("POLYSIGNAL_REACTIVE_ADDRESS")),
    priorityFeePerGas: BigInt(process.env.REACTIVE_PRIORITY_FEE_WEI || "2000000000"),
    maxFeePerGas: BigInt(process.env.REACTIVE_MAX_FEE_WEI || "10000000000"),
    gasLimit: BigInt(process.env.REACTIVE_GAS_LIMIT || "500000"),
    isGuaranteed: (process.env.REACTIVE_IS_GUARANTEED || "true") === "true",
    isCoalesced: (process.env.REACTIVE_IS_COALESCED || "false") === "true",
  });

  if (txHash instanceof Error) {
    throw txHash;
  }

  console.log("Somnia subscription tx:", txHash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
