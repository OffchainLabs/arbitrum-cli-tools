export interface CommandLineArgs {
  blockhash?: string;
  sendRoot?: string;
  gasPrice?: string;
  chainId?: string;
  useAnyTrust?: boolean;
}

export function parseCommandLineArgs(): CommandLineArgs {
  const args = process.argv.slice(2);
  const result: CommandLineArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--blockhash':
        if (i + 1 < args.length) {
          result.blockhash = args[i + 1];
          i++;
        }
        break;
      case '--sendRoot':
        if (i + 1 < args.length) {
          result.sendRoot = args[i + 1];
          i++;
        }
        break;
      case '--gas-price':
        if (i + 1 < args.length) {
          result.gasPrice = args[i + 1];
          i++;
        }
        break;
      case '--chain-id':
        if (i + 1 < args.length) {
          result.chainId = args[i + 1];
          i++;
        }
        break;
      case '--use-anytrust':
        result.useAnyTrust = true;
        break;
    }
  }

  return result;
}
