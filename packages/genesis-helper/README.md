# Genesis Helper

A TypeScript utility for generating and managing Arbitrum Orbit chain genesis configurations and rollup deployments.

## Overview

This tool provides two main functionalities:
1. **Genesis Generation**: Creates a properly formatted `genesis.json` file with chain configuration and account allocations
2. **Rollup Creation**: Deploys an Arbitrum Orbit rollup using the generated genesis configuration

## Features

- Generate random chain IDs for Orbit chains
- Create genesis configurations with custom chain parameters
- Load account allocations from `alloc.json`
- Format genesis files with mixed indentation (compact config, pretty-printed other fields)
- Deploy rollup contracts to Arbitrum Sepolia testnet
- Support for custom batch posters and validators

## Installation

```bash
# Install dependencies
npm install
# or
yarn install
```

## Usage

### 1. Generate Genesis Configuration

```bash
# Generate chain config and genesis.json
node index.js saveGenesis
```

This command will:
- Generate a random chain ID
- Create a chain configuration with Arbitrum parameters
- Load account allocations from `alloc.json` (if present)
- Generate `genesis.json` with proper formatting

### 2. Create Rollup

```bash
# Deploy rollup using genesis configuration, please see below section to see how to get genesis_block_hash
node index.js createRollup <genesis_block_hash>
```

This command will:
- Read the previously generated `genesis.json`
- Extract chain configuration and chain ID
- Deploy the rollup contract to Arbitrum Sepolia
- Configure batch posters and validators



## Configuration Files

### alloc.json

Optional file containing account allocations for the genesis block. Keys can be with or without `0x` prefix:

```json
{
  "0x0000000000000000000000000000000000007070": {
    "balance": "",
    "nonce": "1",
    "code": "0x608060405234801561000f575f80fd5b...",
    "storage": {
      "0x0000000000000000000000000000000000000000000000000000000000000404": "8ce8c13d816fe6daf12d6fd9e4952e1fc88850af0001"
    }
  }
}
```

### genesis.json

Generated file with the following structure:

```json
{
  "config": {"chainId":123,"homesteadBlock":0,...},
  "nonce": "0x0",
  "timestamp": "0x0",
  "extraData": "0x",
  "gasLimit": "0x1c9c380",
  "difficulty": "0x1",
  "mixHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "coinbase": "0x0000000000000000000000000000000000000000",
  "alloc": {
    "0x0000000000000000000000000000000000007070": {
      "balance": "",
      "nonce": "1",
      "code": "0x608060405234801561000f575f80fd5b..."
    }
  }
}
```

**Note**: The `config` field is kept compact (single line) for compatibility with Go tools that calculate block hashes, while other fields use 2-space indentation for readability.

## How to get <genesis_block_hash>

Please go to our [nitro repo](https://github.com/OffchainLabs/nitro) and compile [genesis-generator](https://github.com/OffchainLabs/nitro/tree/master/cmd/genesis-generator) to calculate.

## License

This project is part of the Arbitrum CLI Tools suite.