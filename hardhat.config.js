require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const {
  PRIVATE_KEY,
  SOMNIA_RPC_URL,
  SOMNIA_CHAIN_ID,
  POLYGON_RPC_URL,
  SEPOLIA_RPC_URL,
  SEPOLIA_CHAIN_ID,
  REACTIVE_RPC_URL,
  REACTIVE_CHAIN_ID,
} = process.env;

const normalizedPrivateKey =
  PRIVATE_KEY && !PRIVATE_KEY.startsWith("0x") ? `0x${PRIVATE_KEY}` : PRIVATE_KEY;
const validPrivateKey =
  normalizedPrivateKey && /^0x[a-fA-F0-9]{64}$/.test(normalizedPrivateKey)
    ? normalizedPrivateKey
    : null;
const accounts = validPrivateKey ? [validPrivateKey] : [];

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {},
    somniaTestnet: {
      url: SOMNIA_RPC_URL || "https://dream-rpc.somnia.network",
      chainId: Number(SOMNIA_CHAIN_ID || 50312),
      accounts,
    },
    polygon: {
      url: POLYGON_RPC_URL || "https://polygon-rpc.com",
      chainId: 137,
      accounts,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: Number(SEPOLIA_CHAIN_ID || 11155111),
      accounts,
    },
    reactiveLasna: {
      url: REACTIVE_RPC_URL || "https://lasna-rpc.rnk.dev/",
      chainId: Number(REACTIVE_CHAIN_ID || 5318007),
      accounts,
    },
  },
};
