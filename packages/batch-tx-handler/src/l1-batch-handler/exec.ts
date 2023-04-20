import {
  getRawData,
  processRawData,
  decompressAndDecode,
  getAllL2Msgs,
  decodeL2Msgs,
} from './utils';
import fs from 'fs';
import args from '../getClargs';
import { providers } from 'ethers';

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

  const rawData = await getRawData(sequencerTx, args.l2NetworkId, provider);
  const compressedData = processRawData(rawData);
  const l2segments = decompressAndDecode(compressedData);
  const l2Msgs = getAllL2Msgs(l2segments);

  const txHash: string[] = [];
  for (let i = 0; i < l2Msgs.length; i++) {
    txHash.push(...decodeL2Msgs(l2Msgs[i]));
  }

  console.log(
    `Get all ${txHash.length} l2 transaction and ${l2Msgs.length} blocks in this batch, writing tx to ${args.outputFile}`,
  );
  fs.writeFileSync(args.outputFile, txHash.toString());
};
