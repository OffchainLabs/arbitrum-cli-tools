import { providers, BigNumber } from 'ethers';
import args from '../getClargs';
import { getBlockRangeByBatch, getAllTxByBlockRange, BlockRange } from './utils';
import { writeFileSync } from 'fs';

export const startL2PrecompileHandler = async (
  l1Provider: providers.JsonRpcProvider,
  l2Provider: providers.JsonRpcProvider,
  l2BatchProvider: providers.JsonRpcBatchProvider,
) => {
  if (!args.batchNum) {
    throw new Error(`No batchNum! (You should add --batchNum) in action: ${args.action}`);
  }
  switch (args.precompileAction) {
    case 'getBlockRange':
      const blockRangeOutput: BlockRange = await getBlockRangeByBatch(
        BigNumber.from(args.batchNum),
        l1Provider,
        l2Provider,
      );
      console.log('Here is the block range of this batch: ');
      console.log(blockRangeOutput);
      break;

    case 'getAllTxns':
      if (!args.outputFile) {
        throw new Error('No outputFile! (You should add --outputFile)');
      }
      const blockRange: BlockRange = await getBlockRangeByBatch(
        BigNumber.from(args.batchNum),
        l1Provider,
        l2Provider,
      );
      console.log('Here is the block range of this batch: ');
      console.log(blockRange);
      console.log('Now we query the txns within those blocks...');
      const allTxns = await getAllTxByBlockRange(blockRange, l2BatchProvider);
      console.log(`All ${allTxns.length} txns found, now writing to ${args.outputFile}...`);
      writeFileSync(args.outputFile, allTxns.toString());
      break;

    default:
      console.log(`Unknown precompileAction: ${args.precompileAction}`);
  }
};
