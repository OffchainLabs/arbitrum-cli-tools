export const MaxL2MessageSize = 256 * 1024;
export const BrotliMessageHeaderByte = 0;
export const DASMessageHeaderFlag = 0x80;

export const BatchSegmentKindL2Message = 0;
export const BatchSegmentKindL2MessageBrotli = 1;
export const BatchSegmentKindDelayedMessages = 2;

export const L1MessageType_submitRetryableTx = 9;
export const L1MessageType_ethDeposit = 12;
// const L1MessageType_batchPostingReport = 13;
export const L2MessageKind_Batch = 3;
export const L2MessageKind_SignedTx = 4;
export const delayedMsgToBeAdded = 9;

export const NovaDacUrl = 'https://nova.arbitrum.io/das-servers';
