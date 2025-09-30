import fs from 'fs';
import { config } from 'dotenv';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { concat, createPublicClient, http, keccak256 } from 'viem';
import {
  createRollup,
  createRollupPrepareDeploymentParamsConfig,
  createRollupPrepareTransactionRequest,
  createRollupPrepareTransactionReceipt,
  prepareChainConfig,
  ChainConfig,
} from '@arbitrum/orbit-sdk';
import { GENESIS_DEFAULTS, ZERO_HASH, GENESIS_KEY_ORDER, Genesis, AllocMap } from './tools/types';
import { parseCommandLineArgs } from './tools/cli';
import { stringifyTopLevelMixed } from './tools/format';
import { sanitizePrivateKey, generateChainId } from '@arbitrum/orbit-sdk/utils';
config();

function withFallbackPrivateKey(privateKey: string | undefined): `0x${string}` {
  if (typeof privateKey === 'undefined' || privateKey === '') {
    return generatePrivateKey();
  }

  return sanitizePrivateKey(privateKey);
}

// Load or generate a random batch poster account
const batchPosterPrivateKey = withFallbackPrivateKey(process.env.BATCH_POSTER_PRIVATE_KEY);
const batchPoster = privateKeyToAccount(batchPosterPrivateKey).address;

// Load or generate a random validator account
const validatorPrivateKey = withFallbackPrivateKey(process.env.VALIDATOR_PRIVATE_KEY);
const validator = privateKeyToAccount(validatorPrivateKey).address;

if (typeof process.env.DEPLOYER_PRIVATE_KEY === 'undefined') {
  throw new Error(`Please provide the "DEPLOYER_PRIVATE_KEY" environment variable`);
}

// Set the parent chain and create a public client for it
const parentChain = arbitrumSepolia;
const parentChainPublicClient = createPublicClient({
  chain: parentChain,
  transport: http(process.env.PARENT_CHAIN_RPC),
});

// Load the deployer account
const deployer = privateKeyToAccount(sanitizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY));

// Read alloc.json from current working directory.
function loadAlloc(): AllocMap {
  let content = '{}';
  try {
    content = fs.readFileSync('alloc.json', { encoding: 'utf8' });
  } catch (err) {
    console.warn('alloc.json not found. Using empty alloc.');
    return {} as AllocMap;
  }

  console.log('Successfully loaded alloc.json');

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch (parseErr) {
    console.error('alloc.json is not a valid JSON.');
    throw parseErr;
  }

  const normalized: AllocMap = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`;
    normalized[normalizedKey] = value;
  }
  return normalized;
}

// Read predeploys.json from current working directory and compute the needed information (e.g. immutable variables)
function loadPredeploys(chainConfig: ChainConfig): AllocMap {
  // Read predeploys file
  let predeploysFileContents = '{}';
  try {
    predeploysFileContents = fs.readFileSync('predeploys.json', { encoding: 'utf8' });
  } catch (err) {
    return {} as AllocMap;
  }

  // Parse contents
  let predeploysJson: Record<string, unknown>;
  try {
    predeploysJson = JSON.parse(predeploysFileContents) as Record<string, unknown>;
  } catch (parseErr) {
    console.error('predeploys.json is not a valid JSON.');
    throw parseErr;
  }

  // Create alloc object with its contents
  type PredeployContract = {
    address: `0x${string}`;
    bytecode: `0x${string}`;
    storage?: Record<`0x${string}`, `0x${string}`>;
    immutableReferences?: Record<
      string,
      {
        references: { start: number; length: number }[];
        value: string;
        extraInformation?: `0x${string}`[];
      }
    >;
  };

  // Create alloc entry
  const predeploysAlloc: AllocMap = {};
  for (const [, value] of Object.entries(predeploysJson)) {
    const predeploy = value as PredeployContract;
    const contractAddress = (
      predeploy.address.startsWith('0x') ? predeploy.address : `0x${predeploy.address}`
    ) as `0x${string}`;

    // Initial properties
    const contractAlloc = {
      balance: '',
      nonce: '1',
      code: predeploy.bytecode,
      storage: predeploy.storage ? predeploy.storage : {},
    };

    // Compute immutable variables and add them to bytecode
    // Note: for now we only handle 2 cases: chainId and eip712DomainSeparator
    // More cases can be added if needed, but it might make sense to limit this list to the
    // cases where the immutable variable depends on something that is different between chains
    // (e.g. chainId)
    if (predeploy.immutableReferences) {
      let bytecode = predeploy.bytecode;
      for (const [, immutablesInformation] of Object.entries(predeploy.immutableReferences)) {
        for (const reference of immutablesInformation.references) {
          const { start, length } = reference;

          // Compute value
          let immutableValue: string;
          switch (immutablesInformation.value) {
            case 'chainId':
              immutableValue = chainConfig.chainId.toString(16);
              break;

            case 'eip712DomainSeparator':
              // Note: `extraInformation` can have multiple values, depending on the version used:
              //
              // 2 values (e.g. Permit2):
              //  - Ref: https://github.com/Uniswap/permit2/blob/main/src/EIP712.sol#L34
              //  - Values: [hashedEIP712DomainType, hashedContractName]
              //
              // 3 values (e.g. Entrypoint v0.8.0):
              //  - Ref: https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.1.0/contracts/utils/cryptography/EIP712.sol#L89
              //  - Values: [hashedEIP712DomainType, hashedContractName, hashedContractVersion]
              const domainValues = immutablesInformation.extraInformation
                ? immutablesInformation.extraInformation
                : [];

              // Add the chain id padded to 32 bytes
              domainValues.push(`0x${chainConfig.chainId.toString(16).padStart(64, '0')}`);

              // Add the contract address padded to 32 bytes
              domainValues.push(`0x${contractAddress.slice(2).padStart(64, '0')}`);

              // Compute the domain separator
              const domainSeparator = keccak256(concat(domainValues));

              immutableValue = domainSeparator;
              break;

            default:
              immutableValue = immutablesInformation.value;
              break;
          }

          // Pad value to the left with zeros to fit the length
          const value = immutableValue.startsWith('0x')
            ? immutableValue.slice(2).padStart(length * 2, '0')
            : immutableValue.padStart(length * 2, '0');

          // Replace in bytecode
          bytecode =
            bytecode.slice(0, 2 + start * 2) + value + bytecode.slice(2 + (start + length) * 2);
        }
      }

      // Update bytecode in alloc
      contractAlloc.code = bytecode;
    }

    predeploysAlloc[contractAddress] = contractAlloc;
  }

  return predeploysAlloc;
}

function buildGenesis(chainConfig: ChainConfig, alloc: AllocMap): Genesis {
  return {
    ...GENESIS_DEFAULTS,
    config: chainConfig,
    alloc,
  };
}

// Generate chain config
function getChainConfig(overrideChainId?: string, useAnyTrust?: boolean) {
  const chainId = overrideChainId ? Number(overrideChainId) : generateChainId();
  const chainConfig = prepareChainConfig({
    chainId,
    arbitrum: {
      InitialChainOwner: deployer.address,
      DataAvailabilityCommittee: useAnyTrust,
    },
  });

  return chainConfig;
}

// Generate genesis
function saveGenesis(chainConfig: ChainConfig) {
  const alloc = loadAlloc();
  const predeploysAlloc = loadPredeploys(chainConfig);
  Object.assign(alloc, predeploysAlloc);
  const genesis = buildGenesis(chainConfig, alloc);

  // Only the value of `config` is compact; other top-level keys use 2-space pretty print.
  // This is because the original value of `config` will be read by the go tool and use it as the
  // serializedChainConfig to calculate block hash.
  const output = stringifyTopLevelMixed(genesis as unknown as Record<string, unknown>, {
    orderedKeys: [...GENESIS_KEY_ORDER],
    compactKey: 'config',
  });
  fs.writeFileSync('genesis.json', output, { encoding: 'utf8' });
  console.log(`Genesis saved to genesis.json`);
}

// Custom rollup creation function with gas price support
async function createRollupWithCustomGasPrice(params: {
  config: unknown;
  batchPosters: readonly `0x${string}`[];
  validators: readonly `0x${string}`[];
  gasPrice?: string;
}) {
  const { config, batchPosters, validators, gasPrice } = params;

  if (gasPrice) {
    console.log(`Using custom gas price: ${gasPrice} wei`);

    // Prepare the transaction request
    const txRequest = await createRollupPrepareTransactionRequest({
      params: { config: config as any, batchPosters, validators },
      account: deployer.address,
      publicClient: parentChainPublicClient,
    });

    // Override gas price - clean up the transaction object for signing
    const customGasPriceTxRequest = {
      chainId: txRequest.chainId,
      to: txRequest.to,
      value: txRequest.value || 0n,
      data: txRequest.data,
      gas: txRequest.gas,
      gasPrice: BigInt(gasPrice),
      nonce: txRequest.nonce,
      type: 'legacy' as const,
    };

    console.log('Signing and sending rollup creation transaction with custom gas price...');

    // Sign and send the transaction
    const txHash = await parentChainPublicClient.sendRawTransaction({
      serializedTransaction: await deployer.signTransaction(customGasPriceTxRequest),
    });

    console.log(`Transaction sent: ${txHash}`);

    // Wait for transaction receipt
    const txReceipt = await parentChainPublicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    console.log(`Transaction confirmed in block ${txReceipt.blockNumber}`);

    // Process the receipt to get core contracts
    const processedReceipt = createRollupPrepareTransactionReceipt(txReceipt);
    const coreContracts = processedReceipt.getCoreContracts();

    return {
      transaction: { hash: txHash },
      transactionReceipt: processedReceipt,
      coreContracts,
    };
  } else {
    // Use standard createRollup function
    return await createRollup({
      params: { config: config as any, batchPosters, validators },
      account: deployer,
      parentChainPublicClient,
    });
  }
}

// createRollup entry: read config and chainId from genesis.json then create a rollup
async function createRollupEntry(args: {
  genesisBlockHash?: string;
  sendRoot?: string;
  gasPrice?: string;
}) {
  const { genesisBlockHash, gasPrice } = args;

  if (!genesisBlockHash) {
    console.error('Genesis block hash is required. Use --blockhash flag to provide it.');
    process.exitCode = 1;
    return;
  }

  // if (!sendRoot) {
  //   console.error('Send root flag is required. Use --sendRoot flag to enable it.');
  //   process.exitCode = 1;
  //   return;
  // }

  let genesisContent: string;
  try {
    genesisContent = fs.readFileSync('genesis.json', { encoding: 'utf8' });
  } catch (readErr) {
    console.error('Failed to read genesis.json. Please run saveGenesis first.');
    throw readErr;
  }

  type LoadedGenesis = { config: ChainConfig };
  let loaded: LoadedGenesis;
  try {
    loaded = JSON.parse(genesisContent) as LoadedGenesis;
  } catch (parseErr) {
    console.error('Invalid genesis.json format.');
    throw parseErr;
  }

  // Only need chainId and config from genesis.json
  const { config: loadedConfig } = loaded;
  const { chainId: loadedChainId } = loadedConfig;

  const createRollupConfig = createRollupPrepareDeploymentParamsConfig(parentChainPublicClient, {
    chainId: BigInt(loadedChainId),
    owner: deployer.address,
    chainConfig: loadedConfig,
    genesisAssertionState: {
      globalState: {
        bytes32Vals: [
          genesisBlockHash as `0x${string}`,
          args.sendRoot ? (args.sendRoot as `0x${string}`) : (ZERO_HASH as `0x${string}`),
        ],
        u64Vals: [1n, 0n], // We set InboxPosition to 1 because the first block needs to consume the first message (Init Message)
      },
      machineStatus: 0,
      endHistoryRoot: ZERO_HASH as `0x${string}`,
    },
  });

  try {
    // Because createRollup in orbit-sdk doesn't support custom gas price, we need to use a custom method  createRollupWithCustomGasPrice
    const result = await createRollupWithCustomGasPrice({
      config: createRollupConfig,
      batchPosters: [batchPoster],
      validators: [validator],
      gasPrice,
    });

    console.log('Rollup created successfully!');
    console.log(`Core contracts deployed at:`);
    console.log(`- Rollup: ${result.coreContracts.rollup}`);
  } catch (error) {
    console.error(`Rollup creation failed with error: ${error}`);
    throw error;
  }
}

// -----------------------------
// Entrypoint
// -----------------------------
async function main() {
  const args = parseCommandLineArgs();
  const entrypoint = (process.argv[2] || process.env.ENTRYPOINT || 'saveGenesis').toString();

  switch (entrypoint) {
    case 'saveGenesis': {
      const chainConfig = getChainConfig(args.chainId, args.useAnyTrust);
      saveGenesis(chainConfig);
      break;
    }
    case 'createRollup': {
      await createRollupEntry({
        genesisBlockHash: args.blockhash,
        sendRoot: args.sendRoot,
        gasPrice: args.gasPrice,
      });
      break;
    }
    default: {
      console.error(`Unknown entrypoint: ${entrypoint}. Valid options: saveGenesis | createRollup`);
      console.error('Usage:');
      console.error('  node index.js saveGenesis');
      console.error(
        '  node index.js createRollup --blockhash <hash> --sendRoot <hash> [--gas-price <wei>]',
      );
      process.exitCode = 1;
    }
  }
}

main();
