require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const {
  PRIVATE_KEY,
  SOMNIA_RPC_URL,
  SOMNIA_CHAIN_ID,
  POLYGON_RPC_URL,
} = process.env;

const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
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
  },
};
