import { ChainMcpClient } from './mcp-client.ts';
import { decodeRevertBytes, parseMethodCall } from './decoder.ts';
import { generateExplanation } from './explanation.ts';
import { getNetwork } from './config.ts';
import type {
  DiagnosisResult,
  FailureCategory,
  GasForensics,
  EvidenceProvenance,
  DecodedError,
} from './types.ts';

export async function diagnoseTransaction(
  hash: string,
  networkId: string = 'pacific',
  mcpClient?: ChainMcpClient
): Promise<DiagnosisResult> {
  const cleanHash = hash.trim();
  const network = getNetwork(networkId);
  const client = mcpClient || new ChainMcpClient();

  // Validate format
  if (!/^0x[0-9a-fA-F]{64}$/.test(cleanHash)) {
    throw new Error(`Invalid transaction hash format. Expected 0x followed by 64 hex characters.`);
  }

  // Stage 1: Fetch transaction and receipt via Chain MCP
  let txData: any;
  let receiptData: any;

  try {
    txData = await client.getTransaction(cleanHash);
    receiptData = await client.getTransactionReceipt(cleanHash);
  } catch (err: any) {
    throw new Error(`Chain MCP communication failure: ${err.message || String(err)}`);
  }

  // Handle transaction not found
  if (!txData || (typeof txData === 'object' && txData.error) || txData === 'null') {
    return createNotFoundDiagnosis(cleanHash, network);
  }

  const blockNumber = txData.blockNumber ? parseInt(txData.blockNumber, 16) : 0;
  const blockHash = txData.blockHash || '';
  const from = (txData.from || '').toLowerCase();
  const to = txData.to ? txData.to.toLowerCase() : null;
  const valueWei = txData.value ? BigInt(txData.value).toString() : '0';
  const valueNative = (Number(valueWei) / 1e18).toFixed(6);
  const nonce = txData.nonce ? parseInt(txData.nonce, 16) : 0;
  const inputBytes = txData.input || '0x';
  const method = parseMethodCall(inputBytes);

  const gasLimit = txData.gas ? parseInt(txData.gas, 16) : 0;
  const gasPriceWei = txData.gasPrice ? BigInt(txData.gasPrice) : 0n;
  const gasPriceGwei = Number(gasPriceWei) / 1e9;

  // Handle pending transaction (no receipt yet)
  if (!receiptData || receiptData === 'null') {
    return createPendingDiagnosis(cleanHash, network, txData, from, to, valueWei, valueNative, nonce, inputBytes, method, gasLimit, gasPriceGwei);
  }

  const gasUsed = receiptData.gasUsed ? parseInt(receiptData.gasUsed, 16) : 0;
  const effectiveGasPriceWei = receiptData.effectiveGasPrice ? BigInt(receiptData.effectiveGasPrice) : gasPriceWei;
  const effectiveGasPriceGwei = Number(effectiveGasPriceWei) / 1e9;
  const gasRatio = gasLimit > 0 ? gasUsed / gasLimit : 0;
  const isOutOfGas = (gasLimit > 0 && gasUsed === gasLimit) || (gasLimit > 0 && gasRatio >= 0.999);
  const totalFeeWei = BigInt(gasUsed) * effectiveGasPriceWei;
  const totalFeeNative = (Number(totalFeeWei) / 1e18).toFixed(8);

  const gasForensics: GasForensics = {
    gasLimit,
    gasUsed,
    gasPriceGwei,
    effectiveGasPriceGwei,
    gasRatio,
    isOutOfGas,
    totalFeeNative,
  };

  const statusRaw = receiptData.status;
  const isSuccess = statusRaw === '0x1' || statusRaw === 1 || statusRaw === '1';

  // Check if destination is a contract
  let recipientIsContract = false;
  if (to) {
    try {
      const code = await client.getCode(to, blockNumber);
      if (typeof code === 'string' && code !== '0x' && code.length > 2) {
        recipientIsContract = true;
      }
    } catch {
      // non-fatal
    }
  }

  // Check sender balance at the block
  let senderBalanceAtBlock: string | undefined;
  try {
    const bal = await client.getBalance(from, blockNumber);
    if (typeof bal === 'string') {
      senderBalanceAtBlock = bal;
    } else if (bal && bal.balance) {
      senderBalanceAtBlock = bal.balance;
    }
  } catch {
    // non-fatal
  }

  // Handle successful transaction
  if (isSuccess) {
    const evidence: EvidenceProvenance = {
      source: 'Chain MCP',
      mcpToolUsed: 'get_transaction, get_transaction_receipt',
      blockNumber,
      blockHash,
      transactionHash: cleanHash,
      from,
      to,
      valueWei,
      valueNative,
      nonce,
      inputBytes,
      methodSelector: method.selector,
      decodedMethodName: method.name,
      recipientIsContract,
      senderBalanceAtBlock,
      timestamp: txData.blockTimestamp ? new Date(parseInt(txData.blockTimestamp, 16) * 1000).toISOString() : undefined,
    };

    const resolution = generateExplanation('SUCCESS', undefined, gasForensics, evidence, network);
    return {
      transactionHash: cleanHash,
      network,
      status: 'SUCCESS',
      category: 'SUCCESS',
      categoryLabel: 'Transaction Confirmed Successfully',
      confidence: 'HIGH',
      gas: gasForensics,
      evidence,
      resolution,
      explorerUrl: network.txUrlTemplate.replace('{hash}', cleanHash),
      diagnosedAt: new Date().toISOString(),
    };
  }

  // ==========================================
  // TRANSACTION FAILED (status: 0x0)
  // Stage 4: Revert Replay & Forensic Classification
  // ==========================================

  let category: FailureCategory = 'CONTRACT_REVERT_WITH_REASON';
  let categoryLabel = 'Smart Contract Reverted';
  let decodedError: DecodedError | undefined;
  let rawRevertBytes = '0x';

  if (isOutOfGas) {
    category = 'OUT_OF_GAS';
    categoryLabel = 'Out of Gas (Gas Limit Exhausted)';
  } else {
    // Execute eth_call replay to retrieve exact revert bytes
    let replayResult: any;
    try {
      replayResult = await client.ethCall(
        {
          from,
          to,
          data: inputBytes,
          value: txData.value || '0x0',
          gas: txData.gas || '0x4c4b40',
        },
        blockNumber
      );
    } catch (e: any) {
      replayResult = { error: { message: e.message || String(e) } };
    }

    // Extract revert bytes from replayResult
    if (replayResult && typeof replayResult === 'object') {
      if (replayResult.error) {
        const err = replayResult.error;
        rawRevertBytes = err.data || (typeof err.message === 'string' && err.message.includes('0x') ? err.message.slice(err.message.indexOf('0x')) : '0x');
        
        // If error message contains text like "execution reverted: REASON"
        if (!rawRevertBytes || rawRevertBytes === '0x') {
          const match = (err.message || '').match(/execution reverted:\s*([^\n,]+)/i);
          if (match && match[1].trim()) {
            decodedError = {
              type: 'Error(string)',
              signature: 'Error(string)',
              reason: match[1].trim(),
              rawBytes: '0x',
            };
          }
        }
      } else if (typeof replayResult === 'string' && replayResult.startsWith('0x')) {
        rawRevertBytes = replayResult;
      }
    }

    if (!decodedError && rawRevertBytes && rawRevertBytes !== '0x') {
      decodedError = decodeRevertBytes(rawRevertBytes);
    }

    // Classify based on decoded error content
    const errorText = ((decodedError?.reason || '') + ' ' + (decodedError?.signature || '')).toLowerCase();

    if (errorText.includes('slippage') || errorText.includes('spl0') || errorText.includes('too little received') || errorText.includes('maxslippage')) {
      category = 'SLIPPAGE_EXCEEDED';
      categoryLabel = 'Slippage Protection Exceeded';
    } else if (errorText.includes('insufficient balance') || decodedError?.selector === '0xe450d38c') {
      category = 'INSUFFICIENT_BALANCE';
      categoryLabel = 'Insufficient Balance';
    } else if (errorText.includes('insufficient allowance') || decodedError?.selector === '0xfb8f41b2') {
      category = 'INSUFFICIENT_ALLOWANCE';
      categoryLabel = 'Insufficient Token Allowance';
    } else if (decodedError && decodedError.type === 'CustomError') {
      category = 'CUSTOM_ERROR_REVERT';
      categoryLabel = `Custom Error Revert (${decodedError.signature || decodedError.selector})`;
    } else if (decodedError && decodedError.type === 'Panic(uint256)') {
      category = 'CONTRACT_REVERT_WITH_REASON';
      categoryLabel = `Solidity Panic (${decodedError.panicDescription})`;
    } else if (decodedError && decodedError.type === 'Error(string)' && decodedError.reason) {
      category = 'CONTRACT_REVERT_WITH_REASON';
      categoryLabel = `Contract Reverted: "${decodedError.reason}"`;
    } else {
      if (!recipientIsContract && to) {
        category = 'CALL_TO_NON_CONTRACT';
        categoryLabel = 'Call to Non-Contract Address';
      } else {
        category = 'REVERTED_WITHOUT_REASON';
        categoryLabel = 'Reverted Without Reason String';
      }
    }
  }

  const evidence: EvidenceProvenance = {
    source: 'Chain MCP',
    mcpToolUsed: 'get_transaction, get_transaction_receipt, eth_call',
    blockNumber,
    blockHash,
    transactionHash: cleanHash,
    from,
    to,
    valueWei,
    valueNative,
    nonce,
    inputBytes,
    methodSelector: method.selector,
    decodedMethodName: method.name,
    recipientIsContract,
    senderBalanceAtBlock,
    rawRevertBytes,
    timestamp: txData.blockTimestamp ? new Date(parseInt(txData.blockTimestamp, 16) * 1000).toISOString() : undefined,
  };

  const resolution = generateExplanation(category, decodedError, gasForensics, evidence, network);

  return {
    transactionHash: cleanHash,
    network,
    status: 'FAILED',
    category,
    categoryLabel,
    confidence: decodedError?.reason || isOutOfGas ? 'HIGH' : 'MEDIUM',
    gas: gasForensics,
    decodedError,
    evidence,
    resolution,
    explorerUrl: network.txUrlTemplate.replace('{hash}', cleanHash),
    diagnosedAt: new Date().toISOString(),
  };
}

function createNotFoundDiagnosis(hash: string, network: any): DiagnosisResult {
  const emptyGas: GasForensics = {
    gasLimit: 0,
    gasUsed: 0,
    gasPriceGwei: 0,
    effectiveGasPriceGwei: 0,
    gasRatio: 0,
    isOutOfGas: false,
    totalFeeNative: '0',
  };

  const evidence: EvidenceProvenance = {
    source: 'Chain MCP',
    mcpToolUsed: 'get_transaction',
    blockNumber: 0,
    blockHash: '',
    transactionHash: hash,
    from: '',
    to: null,
    valueWei: '0',
    valueNative: '0',
    nonce: 0,
    inputBytes: '0x',
    methodSelector: '0x',
    recipientIsContract: false,
  };

  const resolution = generateExplanation('TRANSACTION_NOT_FOUND', undefined, emptyGas, evidence, network);

  return {
    transactionHash: hash,
    network,
    status: 'NOT_FOUND',
    category: 'TRANSACTION_NOT_FOUND',
    categoryLabel: 'Transaction Not Found On-Chain',
    confidence: 'HIGH',
    gas: emptyGas,
    evidence,
    resolution,
    explorerUrl: network.txUrlTemplate.replace('{hash}', hash),
    diagnosedAt: new Date().toISOString(),
  };
}

function createPendingDiagnosis(hash: string, network: any, txData: any, from: string, to: string | null, valueWei: string, valueNative: string, nonce: number, inputBytes: string, method: any, gasLimit: number, gasPriceGwei: number): DiagnosisResult {
  const gasForensics: GasForensics = {
    gasLimit,
    gasUsed: 0,
    gasPriceGwei,
    effectiveGasPriceGwei: gasPriceGwei,
    gasRatio: 0,
    isOutOfGas: false,
    totalFeeNative: '0',
  };

  const evidence: EvidenceProvenance = {
    source: 'Chain MCP',
    mcpToolUsed: 'get_transaction',
    blockNumber: txData.blockNumber ? parseInt(txData.blockNumber, 16) : 0,
    blockHash: txData.blockHash || '',
    transactionHash: hash,
    from,
    to,
    valueWei,
    valueNative,
    nonce,
    inputBytes,
    methodSelector: method.selector,
    decodedMethodName: method.name,
    recipientIsContract: false,
  };

  return {
    transactionHash: hash,
    network,
    status: 'PENDING',
    category: 'INSUFFICIENT_EVIDENCE',
    categoryLabel: 'Transaction Pending / In Mempool',
    confidence: 'MEDIUM',
    gas: gasForensics,
    evidence,
    resolution: {
      summary: 'Transaction is pending or awaiting block inclusion.',
      plainEnglishExplanation: 'This transaction was found in the network mempool but has not yet been processed into a block receipt.',
      technicalReason: 'get_transaction succeeded but get_transaction_receipt returned null.',
      actionableSteps: ['Wait 5-10 seconds for the block to confirm and re-diagnose.'],
      preventativeAdvice: [],
    },
    explorerUrl: network.txUrlTemplate.replace('{hash}', hash),
    diagnosedAt: new Date().toISOString(),
  };
}
