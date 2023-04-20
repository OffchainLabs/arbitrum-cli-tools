import { ethers } from 'ethers';
import brotli from 'brotli';
import { rlp, bufArrToArr } from 'ethereumjs-util';
import { Decoded, Input } from 'rlp';
import { getL2Network } from '@arbitrum/sdk';
import { Interface } from 'ethers/lib/utils';
import { seqFunctionAbi } from './abi';

const MaxL2MessageSize = 256 * 1024;
const BrotliMessageHeaderByte = 0;

const BatchSegmentKindL2Message = 0;
const BatchSegmentKindL2MessageBrotli = 1;
const BatchSegmentKindDelayedMessages = 2;

const L2MessageKind_Batch = 3;
const L2MessageKind_SignedTx = 4;

// Use brotli to decompress the compressed data and use rlp to decode to l2 message segments
export const decompressAndDecode = (compressedData: Uint8Array): Uint8Array[] => {
  //decompress data
  const decompressedData = brotli.decompress(Buffer.from(compressedData));
  const hexData = ethers.utils.hexlify(decompressedData);

  //use rlp to decode stream type
  let res = rlp.decode(hexData, true) as Decoded;
  const l2Segments: Uint8Array[] = [];
  while (res.remainder !== undefined) {
    l2Segments.push(bufArrToArr(res.data as Buffer));
    res = rlp.decode(res.remainder as Input, true) as Decoded;
  }
  return l2Segments;
};

//Check if the raw data valid
export const processRawData = (rawData: Uint8Array): Uint8Array => {
  // This is to make sure this message is Nitro Rollups type. (For example: Anytrust use 0x80 here)
  if (rawData[0] !== BrotliMessageHeaderByte) {
    throw Error('Can only process brotli compressed data.');
  }
  //remove type tag of this message
  const compressedData = rawData.subarray(1);

  if (compressedData.length === 0) {
    throw new Error('Empty sequencer message');
  }
  return compressedData;
};

const getNextSerializedTransactionSize = (remainData: Uint8Array, start: number): number => {
  //the size tag of each message here length 8 bytes
  const sizeBytes = remainData.subarray(start, start + 8);
  const size = ethers.BigNumber.from(sizeBytes).toNumber();
  if (size > MaxL2MessageSize) {
    throw new Error('size too large in getOneSerializedTransaction');
  }
  return size;
};

export const getAllL2Msgs = (l2segments: Uint8Array[]): Uint8Array[] => {
  const l2Msgs: Uint8Array[] = [];

  for (let i = 0; i < l2segments.length; i++) {
    const kind = l2segments[i][0];
    let segment = l2segments[i].subarray(1);
    /**
     * Here might contain Timestamp updates and l1 block updates message here, but it is useless
     * in finding tx hash here, so we just need to find tx related messages.
     */
    if (kind === BatchSegmentKindL2Message || kind === BatchSegmentKindL2MessageBrotli) {
      if (kind === BatchSegmentKindL2MessageBrotli) {
        segment = brotli.decompress(Buffer.from(segment));
      }
      l2Msgs.push(segment);
    }
    if (kind === BatchSegmentKindDelayedMessages) {
      //TODO
    }
  }

  if (l2Msgs.length > MaxL2MessageSize) {
    throw Error('Message too large');
  }

  return l2Msgs;
};

export const decodeL2Msgs = (l2Msgs: Uint8Array): string[] => {
  const txHash: string[] = [];

  const kind = l2Msgs[0];
  if (kind === L2MessageKind_SignedTx) {
    const serializedTransaction = l2Msgs.subarray(1); // remove kind tag
    const tx = ethers.utils.parseTransaction(serializedTransaction);
    const currentHash = tx.hash!; // calculate tx hash
    txHash.push(currentHash);
  } else if (kind === L2MessageKind_Batch) {
    const remainData: Uint8Array = l2Msgs.subarray(1);
    const lengthOfData = remainData.length;
    let current = 0;
    while (current < lengthOfData) {
      const nextSize = getNextSerializedTransactionSize(remainData, Number(current));
      current += 8; // the size of next data length value is 8 bytes, so we need to skip it
      const endOfNext = current + nextSize;
      // read next segment data which range from ${current} to ${endOfNext}
      const nextData = remainData.subarray(Number(current), Number(endOfNext));
      txHash.push(...decodeL2Msgs(nextData));
      current = endOfNext;
    }
  }
  return txHash;
};

// Get related sequencer batch data from a sequencer batch submission transaction.
export const getRawData = async (
  sequencerTx: string,
  l2NetworkId: number,
  provider: ethers.providers.JsonRpcProvider,
): Promise<Uint8Array> => {
  //Because current arbitrum-sdk doesn't support latest sequencer inbox contract, so we use ethersjs here directly.
  const contractInterface = new Interface(seqFunctionAbi);
  const l2Network = await getL2Network(l2NetworkId);
  const txReceipt = await provider.getTransactionReceipt(sequencerTx);
  const tx = await provider.getTransaction(sequencerTx);
  if (!tx || !txReceipt || (txReceipt && !txReceipt.status)) {
    throw new Error('No such a l1 transaction or transaction reverted');
  }

  if (tx.to !== l2Network.ethBridge.sequencerInbox) {
    throw new Error('Not a sequencer inbox transaction');
  }

  const funcData = contractInterface.decodeFunctionData('addSequencerL2BatchFromOrigin', tx.data);
  const seqData = funcData['data'].substring(2); //remove '0x'
  const rawData = Uint8Array.from(Buffer.from(seqData, 'hex'));
  return rawData;
};

//TODO: get all startBlock tx in this batch
export const getAllStartBlockTx = () => {};

//TODO: get all tx from delayed inbox in this batch
export const getAllDelayed = () => {};
