import fs from 'fs';
import { config } from 'dotenv';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia } from 'viem/chains';
import { createPublicClient, http } from 'viem';
import {
  createRollup,
  createRollupPrepareDeploymentParamsConfig,
  prepareChainConfig,
  ChainConfig,
} from '@arbitrum/orbit-sdk';
import { GENESIS_DEFAULTS, ZERO_HASH, GENESIS_KEY_ORDER, Genesis, AllocMap } from './tools/types';
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

function buildGenesis(chainConfig: ChainConfig, alloc: AllocMap): Genesis {
  return {
    ...GENESIS_DEFAULTS,
    config: chainConfig,
    alloc,
  };
}

// Generate chain config
function getChainConfig() {
  const chainId = generateChainId();
  const chainConfig = prepareChainConfig({
    chainId,
    arbitrum: {
      InitialChainOwner: deployer.address,
      DataAvailabilityCommittee: true,
    },
  });
  console.log(`Chain config: ${JSON.stringify(chainConfig)}`);
  return chainConfig;
}

// Generate genesis
function saveGenesis(chainConfig: ChainConfig) {
  const alloc = loadAlloc();
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

// createRollup entry: read config and chainId from genesis.json then create a rollup
async function createRollupEntry(genesisBlockHash: string) {
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

  const { config: loadedConfig } = loaded;
  const { chainId: loadedChainId } = loadedConfig;

  const createRollupConfig = createRollupPrepareDeploymentParamsConfig(parentChainPublicClient, {
    chainId: BigInt(loadedChainId),
    owner: deployer.address,
    chainConfig: loadedConfig,
    genesisAssertionState: {
      globalState: {
        bytes32Vals: [genesisBlockHash as `0x${string}`, ZERO_HASH as `0x${string}`],
        u64Vals: [1n, 0n], // We set InboxPosition to 1 because the first block needs to consume the first message (Init Message)
      },
      machineStatus: 0,
      endHistoryRoot: ZERO_HASH as `0x${string}`,
    },
  });

  try {
    await createRollup({
      params: {
        config: createRollupConfig,
        batchPosters: [batchPoster],
        validators: [validator],
      },
      account: deployer,
      parentChainPublicClient,
    });
  } catch (error) {
    console.error(`Rollup creation failed with error: ${error}`);
    throw error;
  }
}

// -----------------------------
// Entrypoint
// -----------------------------
async function main() {
  const entrypoint = (process.argv[2] || process.env.ENTRYPOINT || 'saveGenesis').toString();
  switch (entrypoint) {
    case 'saveGenesis': {
      const chainConfig = getChainConfig();
      saveGenesis(chainConfig);
      break;
    }
    case 'createRollup': {
      await createRollupEntry(process.argv[3]);
      break;
    }
    default: {
      console.error(
        `Unknown entrypoint: ${entrypoint}. Valid options: saveGenesis | createRollup\nUsage: node index.js <entrypoint>`,
      );
      process.exitCode = 1;
    }
  }
}

main();
