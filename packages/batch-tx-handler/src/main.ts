import { startL1BatchHandler } from './l1-batch-handler/exec';
import { startL2PrecompileHandler } from './l2-precompile-handler/exec';
import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import args from './getClargs';
import { providers } from 'ethers';

const myEnv = dotenv.config();
dotenvExpand.expand(myEnv);

const main = async () => {
  if (!process.env.L1RPC) {
    throw new Error(`You need set l1 rpc in env in action: ${args.action}`);
  }
  switch (args.action) {
    case 'L1BatchHandler':
      if (!args.l1TxHash) {
        throw new Error('No l1TxHash! (You should add --l1TxHash)');
      }
      console.log("**Note**: L1BatchHandler is deprecated and will no longer be updated, please refer to [go-batchhandler](https://github.com/OffchainLabs/go-batchhandler)");
      const provider = new providers.JsonRpcProvider(process.env.L1RPC);
      // yargs will read l1TxHash as number wrongly so we need add this convert.
      const txHash = args.l1TxHash?.toString();
      await startL1BatchHandler(txHash, provider);
      break;
    case 'L2PrecompileHandler':
      if (!process.env.L2RPC) {
        throw new Error(`You need set l1 rpc in env in action: ${args.action}`);
      }
      const l1Provider = new providers.JsonRpcProvider(process.env.L1RPC);
      const l2Provider = new providers.JsonRpcProvider(process.env.L2RPC);
      const l2BatchProvider = new providers.JsonRpcBatchProvider(process.env.L2RPC);
      await startL2PrecompileHandler(l1Provider, l2Provider, l2BatchProvider);
      break;
    default:
      console.log(`Unknown action: ${args.action}`);
  }
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
