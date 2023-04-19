export const seqFunctionAbi = [
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'sequenceNumber',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        internalType: 'uint256',
        name: 'afterDelayedMessagesRead',
        type: 'uint256',
      },
      {
        internalType: 'contract IGasRefunder',
        name: 'gasRefunder',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'prevMessageCount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: 'newMessageCount',
        type: 'uint256',
      },
    ],
    name: 'addSequencerL2BatchFromOrigin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];
