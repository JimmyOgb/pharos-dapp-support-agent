export type NetworkId = 'pacific' | 'atlantic';

export interface NetworkConfig {
  id: NetworkId;
  name: string;
  chainId: number;
  chainIdHex: string;
  currency: string;
  rpcUrl: string;
  explorerUrl: string;
  txUrlTemplate: string;
  isMainnet: boolean;
}

export type FailureCategory =
  | 'SUCCESS'
  | 'OUT_OF_GAS'
  | 'SLIPPAGE_EXCEEDED'
  | 'CONTRACT_REVERT_WITH_REASON'
  | 'CUSTOM_ERROR_REVERT'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_ALLOWANCE'
  | 'REVERTED_WITHOUT_REASON'
  | 'CALL_TO_NON_CONTRACT'
  | 'INSUFFICIENT_EVIDENCE'
  | 'TRANSACTION_NOT_FOUND';

export interface DecodedError {
  type: 'Error(string)' | 'Panic(uint256)' | 'CustomError' | 'Empty' | 'Unknown';
  selector?: string;
  signature?: string;
  reason?: string;
  panicCode?: number;
  panicDescription?: string;
  params?: Array<{ name?: string; value: string; type?: string }>;
  rawBytes: string;
}

export interface GasForensics {
  gasLimit: number;
  gasUsed: number;
  gasPriceGwei: number;
  effectiveGasPriceGwei: number;
  gasRatio: number;
  isOutOfGas: boolean;
  totalFeeNative: string;
}

export interface EvidenceProvenance {
  source: 'Chain MCP' | 'Direct RPC Fallback' | 'Simulated Replay';
  mcpToolUsed: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  from: string;
  to: string | null;
  valueWei: string;
  valueNative: string;
  nonce: number;
  inputBytes: string;
  methodSelector: string;
  decodedMethodName?: string;
  recipientIsContract: boolean;
  senderBalanceAtBlock?: string;
  rawRevertBytes?: string;
  timestamp?: string;
}

export interface ResolutionPlan {
  summary: string;
  plainEnglishExplanation: string;
  technicalReason: string;
  actionableSteps: string[];
  preventativeAdvice: string[];
  uncertaintyNotes?: string[];
}

export interface DiagnosisResult {
  transactionHash: string;
  network: NetworkConfig;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'NOT_FOUND';
  category: FailureCategory;
  categoryLabel: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  gas: GasForensics;
  decodedError?: DecodedError;
  evidence: EvidenceProvenance;
  resolution: ResolutionPlan;
  explorerUrl: string;
  diagnosedAt: string;
}
