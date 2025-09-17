import { ChainConfig } from '@arbitrum/orbit-sdk';

export const GENESIS_DEFAULTS = {
  nonce: '0x0',
  timestamp: '0x0',
  extraData: '0x',
  gasLimit: '0x1c9c380',
  difficulty: '0x1',
  mixHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  coinbase: '0x0000000000000000000000000000000000000000',
} as const;

export const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const GENESIS_KEY_ORDER = [
  'config',
  'nonce',
  'timestamp',
  'extraData',
  'gasLimit',
  'difficulty',
  'mixHash',
  'coinbase',
  'alloc',
] as const;

export interface Genesis {
  config: ChainConfig;
  nonce: string;
  timestamp: string;
  extraData: string;
  gasLimit: string;
  difficulty: string;
  mixHash: string;
  coinbase: string;
  alloc: Record<`0x${string}`, unknown>;
}

export type AllocMap = Record<`0x${string}`, unknown>;
