import {
  getRawData,
  processRawData,
  decompressAndDecode,
  getAllL2Msgs,
  decodeL2Msgs,
} from './utils';
import fs from 'fs';
import args from '../getClargs';
import { BigNumber, ethers, providers } from 'ethers';
import { number } from 'yargs';

export let l2NetworkId: number;
export let l1Provider: providers.JsonRpcProvider;

export const startL1BatchHandler = async (
  sequencerTx: string,
  provider: providers.JsonRpcProvider,
) => {
  if (!args.outputFile) {
    throw new Error('No outputFile! (You should add --outputFile)');
  }
  if (!args.l2NetworkId) {
    throw new Error('No l2NetworkId! (You should add --l2NetworkId)');
  }

  l2NetworkId = args.l2NetworkId;
  l1Provider = provider;

  const [rawData, deleyedCount] = await getRawData(sequencerTx);
  const compressedData = processRawData(rawData);
  const l2segments = decompressAndDecode(compressedData);

  const l2Msgs = await getAllL2Msgs(l2segments, deleyedCount.toNumber());
  console.log(l2Msgs.length);

  const txHash: string[] = [];
  for (let i = 0; i < l2Msgs.length; i++) {
    txHash.push(...decodeL2Msgs(l2Msgs[i]));
  }

  console.log(
    `Get all ${txHash.length} l2 transaction and ${l2Msgs.length} blocks in this batch, writing tx to ${args.outputFile}`,
  );
  fs.writeFileSync(args.outputFile, txHash.toString());
};
