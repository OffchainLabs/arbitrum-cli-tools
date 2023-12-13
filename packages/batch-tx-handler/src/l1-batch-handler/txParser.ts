import { EthDepositMessage, L1ToL2Message } from '@arbitrum/sdk/dist/lib/message/L1ToL2Message';
import { SubmitRetryableMessageDataParser } from '@arbitrum/sdk/dist/lib/message/messageDataParser';
import { BigNumber } from 'ethers';
import { getAddress } from 'ethers/lib/utils';
import { l2NetworkId } from './exec';

const parseEthDepositData = (eventData: string) => {
  // https://github.com/OffchainLabs/nitro/blob/aa84e899cbc902bf6da753b1d66668a1def2c106/contracts/src/bridge/Inbox.sol#L242
  // ethers.defaultAbiCoder doesnt decode packed args, so we do a hardcoded parsing
  const addressEnd = 2 + 20 * 2;
  const to = getAddress('0x' + eventData.substring(2, addressEnd));
  const value = BigNumber.from('0x' + eventData.substring(addressEnd));

  return { to, value };
};

export const parseEthDepositMessage = async (
  messageIndex: number,
  messageData: string,
  sender: string,
) => {
  const { to, value } = parseEthDepositData(messageData);
  return EthDepositMessage.calculateDepositTxId(
    l2NetworkId,
    BigNumber.from(messageIndex),
    sender,
    to,
    value,
  );
};

export const parseRetryableTx = async (
  messageIndex: number,
  messageData: string,
  sender: string,
  l1BaseFee: BigNumber,
) => {
  const messageDataParser = new SubmitRetryableMessageDataParser();
  const inboxData = messageDataParser.parse(messageData);
  return L1ToL2Message.calculateSubmitRetryableId(
    l2NetworkId,
    sender,
    BigNumber.from(messageIndex),
    l1BaseFee,
    inboxData.destAddress,
    inboxData.l2CallValue,
    inboxData.l1Value,
    inboxData.maxSubmissionFee,
    inboxData.excessFeeRefundAddress,
    inboxData.callValueRefundAddress,
    inboxData.gasLimit,
    inboxData.maxFeePerGas,
    inboxData.data,
  );
};

// parseEthDepositMessage()
