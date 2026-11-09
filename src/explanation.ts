import type {
  FailureCategory,
  DecodedError,
  GasForensics,
  EvidenceProvenance,
  ResolutionPlan,
  NetworkConfig,
} from './types.ts';

export function generateExplanation(
  category: FailureCategory,
  decodedError: DecodedError | undefined,
  gas: GasForensics,
  evidence: EvidenceProvenance,
  network: NetworkConfig
): ResolutionPlan {
  switch (category) {
    case 'OUT_OF_GAS':
      return {
        summary: 'Transaction failed because it ran out of gas before completing.',
        plainEnglishExplanation:
          `Your transaction requested an operation that consumed more computational work than the gas limit you specified (${gas.gasLimit.toLocaleString()} units). ` +
          `On EVM networks like Pharos, when a transaction exhausts its allocated gas, the network reverts all state changes to protect against infinite loops, but the fee used up to that point is consumed.`,
        technicalReason:
          `gasUsed (${gas.gasUsed}) equaled 100% of the gasLimit (${gas.gasLimit}). Receipt status is 0x0. No remaining gas was available to complete contract execution.`,
        actionableSteps: [
          `Increase the gas limit by 25% to 50% when re-submitting in your wallet (e.g. from ${gas.gasLimit.toLocaleString()} to ${Math.round(gas.gasLimit * 1.35).toLocaleString()}).`,
          `Check if the smart contract was trying to loop over too many items or complex batch processing.`,
          `Ensure the dApp is providing a dynamic gas estimate rather than a hardcoded gas limit.`,
        ],
        preventativeAdvice: [
          `Always allow your Web3 wallet (MetaMask, Rabby) to calculate gas automatically rather than manually capping it.`,
          `If executing a batch transfer or multi-hop trade, split large operations into smaller batches.`,
        ],
      };

    case 'SLIPPAGE_EXCEEDED':
      return {
        summary: 'Swap transaction failed due to price slippage protection.',
        plainEnglishExplanation:
          `Your token swap reverted because the market price moved unfavorably between the moment you confirmed the transaction and when the validator included it in a block. ` +
          `The decentralized exchange aborted the trade to protect you from receiving fewer tokens than your minimum acceptable threshold.`,
        technicalReason:
          `Execution reverted with error string: "${decodedError?.reason || 'SLIPPAGE'}". ` +
          `Gas used (${gas.gasUsed.toLocaleString()} of ${gas.gasLimit.toLocaleString()} units) proves execution proceeded into the DEX router before aborting on the slippage check.`,
        actionableSteps: [
          `Open the dApp's settings modal and slightly increase your slippage tolerance (e.g., from 0.5% to 1.0% or 1.5%).`,
          `Wait a minute for high market volatility or liquidity pool fluctuations to stabilize, then retry.`,
          `Check whether the liquidity pool has sufficient token reserves for your order size.`,
        ],
        preventativeAdvice: [
          `Avoid trading large volumes during major token launches or high-volatility news events.`,
          `Check route liquidity across multiple pools or use a DEX aggregator to minimize price impact.`,
        ],
      };

    case 'CONTRACT_REVERT_WITH_REASON':
      const reasonStr = decodedError?.reason || 'Unknown requirement';
      return {
        summary: `Smart contract explicitly rejected the transaction: "${reasonStr}".`,
        plainEnglishExplanation:
          `The smart contract executed successfully up until a safety check (a "require" statement) that was not satisfied. ` +
          `The contract developer provided an explanation: "${reasonStr}". Your state changes were reverted safely and no tokens were lost (except the gas fee consumed).`,
        technicalReason:
          `Contract at ${evidence.to} reverted during eth_call replay with standard Error(string) selector 0x08c379a0. Decoded UTF-8 string: "${reasonStr}". Gas used: ${gas.gasUsed.toLocaleString()} / ${gas.gasLimit.toLocaleString()}.`,
        actionableSteps: [
          `Read the revert reason carefully: "${reasonStr}". It points directly to the contract condition that failed.`,
          `Ensure your account satisfies all permissions, deadlines, or precondition requirements expected by the contract.`,
          `If this was an auction, staking, or vault interaction, verify that the deposit window is open and your amount satisfies min/max limits.`,
        ],
        preventativeAdvice: [
          `Verify contract state and deadlines on ${network.name} explorer before submitting.`,
          `Double-check your account role or whitelist status if calling restricted functions.`,
        ],
      };

    case 'CUSTOM_ERROR_REVERT':
      const customSelector = decodedError?.selector || 'Custom Error';
      const customSig = decodedError?.signature || customSelector;
      const customExplanation = decodedError?.reason || 'Protocol-specific custom error';
      return {
        summary: `Protocol reverted with custom error ${customSig}.`,
        plainEnglishExplanation:
          `Modern Solidity smart contracts use gas-efficient custom errors instead of error strings. ` +
          `The contract returned custom error code ${customSelector}. ${customExplanation}`,
        technicalReason:
          `Transaction reverted at block ${evidence.blockNumber}. Eth_call replay returned 4-byte custom error selector ${customSelector} (${customSig}). Raw bytes: ${decodedError?.rawBytes.slice(0, 34)}...`,
        actionableSteps: [
          `Review the custom error details: ${customExplanation}.`,
          `Check the parameter values supplied to method ${evidence.methodSelector}.`,
          `Ensure you have approved sufficient token allowances and hold adequate balance.`,
        ],
        preventativeAdvice: [
          `Check the protocol's official documentation or ABI for ${customSig} requirements.`,
        ],
      };

    case 'INSUFFICIENT_BALANCE':
      return {
        summary: `Transaction failed due to insufficient native or token balance.`,
        plainEnglishExplanation:
          `The transaction required more funds than your wallet held at the time of execution. ` +
          `This can happen if you tried to send more native ${network.currency} than available, or if an ERC-20 transfer exceeded your token balance.`,
        technicalReason:
          `Transaction attempted to spend funds exceeding available balance. Value: ${evidence.valueNative} ${network.currency}. Gas used: ${gas.gasUsed}.`,
        actionableSteps: [
          `Check your wallet's current balance on ${network.name}.`,
          `Ensure you leave enough native ${network.currency} to cover future gas fees in addition to the transfer amount.`,
          `Acquire additional tokens or reduce the transaction amount before retrying.`,
        ],
        preventativeAdvice: [
          `Always maintain a small reserve of ${network.currency} (e.g. 0.05-0.10) in your wallet for transaction fees.`,
        ],
      };

    case 'INSUFFICIENT_ALLOWANCE':
      return {
        summary: `Transaction failed because the contract does not have permission to transfer your tokens.`,
        plainEnglishExplanation:
          `Before a decentralized application (like a DEX or staking pool) can move ERC-20 tokens on your behalf, you must first submit an "Approve" transaction. ` +
          `The contract attempted to transfer tokens from your wallet, but the existing allowance was lower than the requested amount.`,
        technicalReason:
          `ERC-20 transferFrom failed due to allowance limit. Current approval is less than transaction requirement.`,
        actionableSteps: [
          `Submit an "Approve" transaction in the dApp to grant permission for the contract to spend your tokens.`,
          `Verify the approved amount covers your intended deposit or trade size.`,
          `Once the approval transaction is confirmed on ${network.name}, retry your original transaction.`,
        ],
        preventativeAdvice: [
          `Check your active token allowances using a revoke tool or explorer before interacting with complex dApps.`,
        ],
      };

    case 'REVERTED_WITHOUT_REASON':
      return {
        summary: `Contract execution reverted without returning an error message.`,
        plainEnglishExplanation:
          `The smart contract stopped execution and reverted all changes, but did not provide an explanatory text message or custom error. ` +
          `This typically occurs when a developer wrote a simple "require(condition)" without a failure string, when a contract's fallback function rejected unexpected input, or when an internal assertion was triggered.`,
        technicalReason:
          `Receipt status is 0x0. Gas used was ${gas.gasUsed.toLocaleString()} of ${gas.gasLimit.toLocaleString()} (leaving ${((gas.gasLimit - gas.gasUsed) / gas.gasLimit * 100).toFixed(1)}% unused gas, confirming this was NOT an Out of Gas failure). EVM call replay returned empty data (0x).`,
        actionableSteps: [
          `Verify that the destination address (${evidence.to}) is the intended contract and not an outdated deployment.`,
          `Inspect the contract's verified source code on ${network.explorerUrl} to check requirements for method ${evidence.methodSelector}.`,
          `Ensure all parameters (dates, amounts, addresses) adhere strictly to the contract's expected format.`,
        ],
        preventativeAdvice: [
          `Test unfamiliar contract interactions using small amounts first.`,
          `Contact the dApp team's support channel with the transaction hash for contract-specific guidance.`,
        ],
        uncertaintyNotes: [
          `Because the contract author did not attach an error string or custom error data, the exact internal condition can only be identified by reviewing the contract's source code at block ${evidence.blockNumber}.`,
        ],
      };

    case 'CALL_TO_NON_CONTRACT':
      return {
        summary: `Transaction failed because the recipient address has no smart contract code deployed.`,
        plainEnglishExplanation:
          `Your transaction sent contract calldata to an address that does not contain a smart contract (it is an externally owned user wallet or an uninitialized address). ` +
          `The transaction cannot execute any contract logic.`,
        technicalReason:
          `Recipient ${evidence.to} bytecode length is 0 (get_code returned 0x). Calldata was sent to a non-contract address.`,
        actionableSteps: [
          `Double-check the contract address you are trying to interact with.`,
          `Verify you are connected to the correct network (${network.name}).`,
        ],
        preventativeAdvice: [
          `Only copy contract addresses from verified project links and official documentation.`,
        ],
      };

    case 'SUCCESS':
      return {
        summary: `Transaction was successful!`,
        plainEnglishExplanation:
          `This transaction confirmed successfully on ${network.name}. All state changes were committed to the blockchain.`,
        technicalReason:
          `Receipt status is 0x1 (success). Block: ${evidence.blockNumber}. Cumulative gas used: ${gas.gasUsed.toLocaleString()}.`,
        actionableSteps: [
          `No troubleshooting is needed. Your transaction completed successfully.`,
        ],
        preventativeAdvice: [],
      };

    case 'TRANSACTION_NOT_FOUND':
    default:
      return {
        summary: `Transaction could not be found or diagnosed.`,
        plainEnglishExplanation:
          `The transaction hash could not be retrieved from ${network.name}. It may be still pending in the mempool, dropped, or on a different chain.`,
        technicalReason:
          `Chain MCP get_transaction returned null or error for hash ${evidence.transactionHash}.`,
        actionableSteps: [
          `Verify that the transaction hash is correct and formatted with a 0x prefix followed by 64 hex characters.`,
          `Confirm whether the transaction was broadcast on ${network.name} (Chain ID ${network.chainId}) or a different network.`,
          `Wait a few seconds if you just submitted it, then try again.`,
        ],
        preventativeAdvice: [],
      };
  }
}
