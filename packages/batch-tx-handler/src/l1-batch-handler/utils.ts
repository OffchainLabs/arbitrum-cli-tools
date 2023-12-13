import { BigNumber, ethers } from 'ethers';
import brotli from 'brotli';
import { rlp, bufArrToArr } from 'ethereumjs-util';
import { Decoded, Input } from 'rlp';
import { getL2Network } from '@arbitrum/sdk';
import { Bridge__factory } from '@arbitrum/sdk/dist/lib/abi/factories/Bridge__factory';
import { Interface } from 'ethers/lib/utils';
import { seqFunctionAbi } from './abi';
import { l1Provider, l2NetworkId } from './exec';
import { parseEthDepositMessage, parseRetryableTx } from './txParser';
import { InboxMessageDeliveredEvent } from '@arbitrum/sdk/dist/lib/abi/Inbox';
import { MessageDeliveredEvent } from '@arbitrum/sdk/dist/lib/abi/Bridge';
import { EventArgs } from '@arbitrum/sdk/dist/lib/dataEntities/event';
import { L1TransactionReceipt } from '@arbitrum/sdk/dist/lib/message/L1Transaction';
import fetch from 'node-fetch';
import { Base64 } from 'js-base64';
import {
  BatchSegmentKindDelayedMessages,
  BatchSegmentKindL2Message,
  BatchSegmentKindL2MessageBrotli,
  BrotliMessageHeaderByte,
  DASMessageHeaderFlag,
  delayedMsgToBeAdded,
  L1MessageType_ethDeposit,
  L1MessageType_submitRetryableTx,
  L2MessageKind_Batch,
  L2MessageKind_SignedTx,
  MaxL2MessageSize,
} from './constant';

export type DelayedTxEvent = {
  inboxMessageEvent: EventArgs<InboxMessageDeliveredEvent>;
  bridgeMessageEvent: EventArgs<MessageDeliveredEvent>;
};

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

export const getAllL2Msgs = async (
  l2segments: Uint8Array[],
  afterDelayedMessagesRead: number,
): Promise<Uint8Array[]> => {
  const l2Msgs: Uint8Array[] = [];
  let currentDelayedMessageIndex = afterDelayedMessagesRead - 1;
  for (let i = l2segments.length - 1; i >= 0; i--) {
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
      //MessageDelivered
      l2Msgs.push(await getDelayedTx(currentDelayedMessageIndex));
      currentDelayedMessageIndex -= 1;
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
  } else if (kind === delayedMsgToBeAdded) {
    const remainData: Uint8Array = l2Msgs.subarray(1);
    const currentHash = ethers.utils.hexlify(remainData);
    txHash.push(currentHash);
  }
  return txHash;
};

// Get related sequencer batch data from a sequencer batch submission transaction.
export const getRawData = async (sequencerTx: string): Promise<[Uint8Array, BigNumber]> => {
  //Because current arbitrum-sdk doesn't support latest sequencer inbox contract, so we use ethersjs here directly.
  const contractInterface = new Interface(seqFunctionAbi);
  const l2Network = await getL2Network(l2NetworkId);
  const txReceipt = await l1Provider.getTransactionReceipt(sequencerTx);
  const tx = await l1Provider.getTransaction(sequencerTx);
  if (!tx || !txReceipt || !txReceipt.status) {
    throw new Error('No such a l1 transaction or transaction reverted');
  }
  if (tx.to!.toLowerCase() !== l2Network.ethBridge.sequencerInbox.toLowerCase()) {
    throw new Error('Not a sequencer inbox transaction');
  }

  const funcData = contractInterface.decodeFunctionData('addSequencerL2BatchFromOrigin', tx.data);
  const seqData = funcData['data'].substring(2); //remove '0x'
  const deleyedCount = funcData['afterDelayedMessagesRead'] as BigNumber;
  let rawData = Uint8Array.from(Buffer.from(seqData, 'hex'));
  if (rawData[0] & DASMessageHeaderFlag) {
    if (l2Network.chainID !== 42170) {
      throw new Error('For anytrust network, only support Arbitrum nova now');
    }
    rawData = await processDASBatch(rawData);
  }
  return [rawData, deleyedCount];
};

const processDASBatch = async (rawData: Uint8Array) => {
  if(!process.env.NovaDacListUrl) {
    throw new Error("You are calling anytrust dac while don't provide the dac list url")
  }
  const req = await fetch(process.env.NovaDacListUrl);
  const urls = (await req.text()).split('\n');
  if (urls.length === 0) {
    throw Error('No online das servers now');
  }
  return getDACData(urls, rawData);
};

// Here is the reference in nitro source code: https://github.com/OffchainLabs/nitro/blob/v2.1.3/arbstate/inbox.go#L127
const getDACData = async (urls: string[], rawData: Uint8Array) => {
  // The first byte is header flag, the 2nd to 33rd bytes is keyset hash, 34th to 65th is data hash which is what we want.
  const dataHash = ethers.utils.hexlify(rawData.subarray(33, 65));
  let req;
  let base64Data;
  for(let i = 0; i < urls.length; i++) {
    const requestUrl = urls[i] + `/get-by-hash/` + dataHash.substring(2);
    try {
      req = await fetch(requestUrl);
      base64Data = await req.json();
      if(!base64Data["data"]) {
        throw new Error("Empty data");
      }
      break;
    } catch {
      if(i === urls.length - 1) {
        console.log(`URL for one of the da node (${urls[i]}) is broken.`);
        throw new Error("All url seems broken, try it later or check your network connection.");
      }
      console.log(`URL for one of the da node (${urls[i]}) is broken, trying another one...`);
    }
  }
  return Base64.toUint8Array(base64Data.data);
};

//TODO: get all startBlock tx in this batch
export const getAllStartBlockTx = () => {};

// TODO: get all tx from delayed inbox in this batch
export const getDelayedTx = async (messageIndex: number): Promise<Uint8Array> => {
  const l2Network = await getL2Network(l2NetworkId);
  const bridge = Bridge__factory.connect(l2Network.ethBridge.bridge, l1Provider);

  // Get tx message data
  const queryInboxMessageDelivered = bridge.filters.MessageDelivered(messageIndex);
  const inboxMsgEvent = await bridge.queryFilter(queryInboxMessageDelivered);
  const txReceipt = await inboxMsgEvent[0].getTransactionReceipt();
  const l1Tx = new L1TransactionReceipt(txReceipt);
  const targetEvent = getTargetEvent(messageIndex, l1Tx);

  switch (targetEvent.bridgeMessageEvent.kind) {
    case L1MessageType_submitRetryableTx: {
      let txHash = await parseRetryableTx(
        messageIndex,
        targetEvent.inboxMessageEvent.data,
        targetEvent.bridgeMessageEvent.sender,
        targetEvent.bridgeMessageEvent.baseFeeL1,
      );

      txHash = '0' + delayedMsgToBeAdded.toString() + txHash.substring(2);
      const res = Uint8Array.from(Buffer.from(txHash, 'hex'));
      return res;
    }
    case L1MessageType_ethDeposit: {
      let txHash = await parseEthDepositMessage(
        messageIndex,
        targetEvent.inboxMessageEvent.data,
        targetEvent.bridgeMessageEvent.sender,
      );
      txHash = '0' + delayedMsgToBeAdded.toString() + txHash.substring(2);
      const res = Uint8Array.from(Buffer.from(txHash, 'hex'));
      return res;
    }
  }
  return new Uint8Array([0]);
};

const getTargetEvent = (messageIndex: number, l1Tx: L1TransactionReceipt): DelayedTxEvent => {
  const inboxEvents = l1Tx.getInboxMessageDeliveredEvents();
  const bridgeEvents = l1Tx.getMessageDeliveredEvents();

  let targetInboxEvent: EventArgs<InboxMessageDeliveredEvent>;
  let targetBridgeEvent: EventArgs<MessageDeliveredEvent>;
  inboxEvents.forEach((event) => {
    if (event.messageNum.eq(messageIndex)) {
      targetInboxEvent = event;
    }
  });
  bridgeEvents.forEach((event) => {
    if (event.messageIndex.eq(messageIndex)) {
      targetBridgeEvent = event;
    }
  });
  const targetEventInfo: DelayedTxEvent = {
    inboxMessageEvent: targetInboxEvent!,
    bridgeMessageEvent: targetBridgeEvent!,
  };
  return targetEventInfo;
};