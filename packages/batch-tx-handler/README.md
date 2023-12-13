# Batch tx handler

This repo has 2 way to get txns related to a single batch, one is `l1 batch handler` which decodes l1 sequencer submission tx and extract all tx included in that calldata, another is `l2 precompile handler` which uses arbitrum network's precompile to get batch information and use binary search to find all blocks related to that batch. The first way is much efficiency.

## l1 batch handler

`l1 batch handler` is a simple demo of how to decompress and decode sequencer's calldata to get all related l2 message, but this way currently hasn't implemented `startBlock` and delayed tx found (Will support in the future).

This demo will tell you how to use brotli to decompress the calldata and decode them to l2 msg.

See [./exec.js](./src/l1-batch-handler/exec.js) for inline explanations.

Currently this handler supported extract delayed transaction (`retryable ticket creation` and `deposit eth`), but still doesn't support `startBlock` transaction and `l1funded` transaction, because those 2 types of tx needs some cached state from l2 or re-run all batch tx to get.

TODO:
Add `startBlock` and delayed transaction handler.

### Run Demo:

```
yarn L1BatchHandler --l1TxHash {SEQUENCER_SUBMISSION_TX} --outputFile {FILE_TO_RECORD_TXNS} --l2NetworkId {L2_NETWORK_ID}
```

## l2 precompile handler

`l2 precompile handler` is a simple demo of how to query all the blocks and transactions related to a specific batch on Arbitrum.

To achieve this, we should use binary search to find one of the matched Block by calling precompile nodeInterface.findBatchContainingBlock method, then after we found one, we can search around this block to find all matched block. After got all matched block (block range), we can use rpc call to get all txns within those blocks.

It has 2 functions;
The first function, `getBlockRange`, will output the range of blocks that matched to the batch number.
The second is `getAllTxns`, which will not only output the range of blocks, but also write all the txns to a specific file.

See [./exec.js](./src/l2-precompile-handler/exec.js) for inline explanations.

### Run Demo:

Only get the block range:

```
yarn L2PrecompileHandler --precompileAction getBlockRange --batchNum {YOUR_BATCH_NUMBER}
```

Get the block range and all txns:

```
yarn L2PrecompileHandler --precompileAction getAllTxns --batchNum {YOUR_BATCH_NUMBER} --outputFile {FILE_TO_RECORD_TXNS}
```

## Config Environment Variables

Set the values shown in `.env-sample` as environmental variables. To copy it into a `.env` file:

```bash
cp .env-sample .env
```

In `l1 batch handler`, you just need to set `L1RPC`, but in `l2 precompile handler` you need set both `L1RPC` and `L2RPC`.
