// src/config.ts
var NETWORKS = {
  pacific: {
    id: "pacific",
    name: "Pharos Pacific Mainnet",
    chainId: 1672,
    chainIdHex: "0x688",
    currency: "PROS",
    rpcUrl: process.env.PHAROS_PACIFIC_RPC || "https://rpc.pharos.xyz",
    explorerUrl: "https://pharosscan.xyz",
    txUrlTemplate: "https://pharosscan.xyz/tx/{hash}",
    isMainnet: true
  },
  atlantic: {
    id: "atlantic",
    name: "Pharos Atlantic Testnet",
    chainId: 688689,
    chainIdHex: "0xa8231",
    currency: "PHRS",
    rpcUrl: process.env.PHAROS_ATLANTIC_RPC || "https://atlantic.dplabs-internal.com",
    explorerUrl: "https://atlantic.pharosscan.xyz",
    txUrlTemplate: "https://atlantic.pharosscan.xyz/tx/{hash}",
    isMainnet: false
  }
};
var OFFICIAL_MCP_URL = process.env.PHAROS_MCP_URL || "https://mcp.pharos.xyz/mcp";
var DEFAULT_NETWORK_ID = process.env.DEFAULT_NETWORK || "pacific";
function getNetwork(networkId) {
  if (networkId && networkId.toLowerCase() in NETWORKS) {
    return NETWORKS[networkId.toLowerCase()];
  }
  return NETWORKS[DEFAULT_NETWORK_ID];
}

// src/mcp-client.ts
var ChainMcpClient = class {
  url;
  sessionId = null;
  cookie = null;
  msgId = 1;
  constructor(url = OFFICIAL_MCP_URL) {
    this.url = url;
  }
  parseSse(text) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("data: ")) {
        try {
          return JSON.parse(trimmed.slice(6));
        } catch {
        }
      }
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  async initialize() {
    const initPayload = {
      jsonrpc: "2.0",
      id: this.msgId++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "pharos-dapp-support-agent",
          version: "1.0.0"
        }
      }
    };
    const resp = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "User-Agent": "Mozilla/5.0 (compatible; PharosSupportAgent/1.0)"
      },
      body: JSON.stringify(initPayload)
    });
    if (!resp.ok) {
      throw new Error(`Failed to initialize Chain MCP session: HTTP ${resp.status} ${resp.statusText}`);
    }
    this.sessionId = resp.headers.get("mcp-session-id");
    const setCookie = resp.headers.get("set-cookie");
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }
    const bodyText = await resp.text();
    const parsed = this.parseSse(bodyText);
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "Mozilla/5.0 (compatible; PharosSupportAgent/1.0)"
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.cookie) headers["Cookie"] = this.cookie;
    try {
      await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized"
        })
      });
    } catch {
    }
    return parsed?.result || {};
  }
  async callTool(toolName, args, retry = true) {
    if (!this.sessionId) {
      await this.initialize();
    }
    const payload = {
      jsonrpc: "2.0",
      id: this.msgId++,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      }
    };
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "User-Agent": "Mozilla/5.0 (compatible; PharosSupportAgent/1.0)"
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.cookie) headers["Cookie"] = this.cookie;
    try {
      const resp = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        if ((resp.status === 400 || resp.status === 404 || resp.status === 401) && retry) {
          this.sessionId = null;
          await this.initialize();
          return this.callTool(toolName, args, false);
        }
        throw new Error(`Chain MCP tool call '${toolName}' failed: HTTP ${resp.status}`);
      }
      const bodyText = await resp.text();
      const parsed = this.parseSse(bodyText);
      if (!parsed) {
        throw new Error(`Chain MCP tool call '${toolName}' returned unparseable SSE body`);
      }
      if (parsed.error) {
        return { error: parsed.error };
      }
      const contentItem = parsed.result?.content?.[0];
      if (contentItem && contentItem.text) {
        try {
          return JSON.parse(contentItem.text);
        } catch {
          return contentItem.text;
        }
      }
      return parsed.result;
    } catch (err) {
      if (retry) {
        this.sessionId = null;
        try {
          await this.initialize();
          return await this.callTool(toolName, args, false);
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }
  // Convenience methods matching official tool names
  async getTransaction(hash) {
    return this.callTool("get_transaction", { hash });
  }
  async getTransactionReceipt(hash) {
    return this.callTool("get_transaction_receipt", { hash });
  }
  async ethCall(transaction, block) {
    return this.callTool("eth_call", { transaction, block });
  }
  async getBalance(address, block) {
    return this.callTool("get_balance", { address, block });
  }
  async getCode(address, block) {
    return this.callTool("get_code", { address, block });
  }
  async getChainInfo() {
    return this.callTool("get_chain_info", {});
  }
};

// src/decoder.ts
var SELECTOR_ERROR_STRING = "0x08c379a0";
var SELECTOR_PANIC = "0x4e487b71";
var PANIC_CODES = {
  0: "Generic compiler panic",
  1: "Assertion failed (assert statement evaluated to false)",
  17: "Arithmetic underflow or overflow outside unchecked block",
  18: "Division or modulo by zero",
  33: "Enum conversion out of bounds",
  34: "Access to incorrectly encoded storage byte array",
  49: "Called .pop() on an empty array",
  50: "Array index out of bounds",
  65: "Out of memory / allocation limit reached",
  81: "Called zero-initialized internal function pointer"
};
var KNOWN_CUSTOM_ERRORS = {
  // OpenZeppelin ERC20
  "0xe450d38c": {
    signature: "ERC20InsufficientBalance(address,uint256,uint256)",
    reason: "The sender does not hold enough token balance to fulfill this transfer.",
    paramTypes: ["address", "uint256", "uint256"]
  },
  "0xfb8f41b2": {
    signature: "ERC20InsufficientAllowance(address,uint256,uint256)",
    reason: "The spender allowance is lower than the amount requested to transferFrom.",
    paramTypes: ["address", "uint256", "uint256"]
  },
  "0xec447034": {
    signature: "ERC20InvalidSender(address)",
    reason: "Invalid token sender address (e.g. zero address).",
    paramTypes: ["address"]
  },
  "0x94280d62": {
    signature: "ERC20InvalidReceiver(address)",
    reason: "Invalid token recipient address (e.g. zero address).",
    paramTypes: ["address"]
  },
  "0x118cdaa7": {
    signature: "OwnableUnauthorizedAccount(address)",
    reason: "Caller is not the contract owner or authorized admin.",
    paramTypes: ["address"]
  },
  "0xd92e233d": {
    signature: "EnforcedPause()",
    reason: "The contract is currently paused by protocol admins for emergency or maintenance.",
    paramTypes: []
  },
  "0x8baa579f": {
    signature: "AddressInsufficientBalance(address)",
    reason: "The contract or account has insufficient native balance to perform the call.",
    paramTypes: ["address"]
  },
  "0x5734e94a": {
    signature: "FailedInnerCall()",
    reason: "A low-level contract call (call/delegatecall) failed during execution.",
    paramTypes: []
  },
  // DeFi & Swaps
  "0x2c19b8b8": {
    signature: "InsufficientAmount(uint256,uint256)",
    reason: "Available balance or reserve amount is less than the required amount.",
    paramTypes: ["uint256", "uint256"]
  },
  "0x90b8ec18": {
    signature: "PoolRequirementFailed()",
    reason: "Internal pool invariant or liquidity check was not satisfied.",
    paramTypes: []
  },
  "0xd7815800": {
    signature: "UnauthorizedOrExpired()",
    reason: "Execution expired or caller signature failed authentication verification.",
    paramTypes: []
  },
  "0x22611167": {
    signature: "CommitPeriodExpired()",
    reason: "The transaction commit or dispute window has closed or state is locked.",
    paramTypes: []
  },
  "0x718a7051": {
    signature: "MaxSlippageExceeded()",
    reason: "The actual swap price exceeded the maximum allowed slippage tolerance.",
    paramTypes: []
  }
};
function decodeRevertBytes(rawHex) {
  if (!rawHex || rawHex === "0x" || rawHex === "") {
    return {
      type: "Empty",
      rawBytes: rawHex || "0x",
      reason: "No error data returned (reverted without reason string)"
    };
  }
  const cleanHex = rawHex.startsWith("0x") ? rawHex.slice(2) : rawHex;
  if (cleanHex.length < 8) {
    return {
      type: "Unknown",
      rawBytes: rawHex,
      reason: `Truncated return data (${cleanHex.length / 2} bytes)`
    };
  }
  const selector = "0x" + cleanHex.slice(0, 8).toLowerCase();
  if (selector === SELECTOR_ERROR_STRING.toLowerCase()) {
    try {
      if (cleanHex.length >= 136) {
        const lengthHex = cleanHex.slice(72, 136);
        const length = parseInt(lengthHex, 16);
        const stringHex = cleanHex.slice(136, 136 + length * 2);
        const buffer = Buffer.from(stringHex, "hex");
        const reason = buffer.toString("utf-8");
        return {
          type: "Error(string)",
          selector,
          signature: "Error(string)",
          reason,
          rawBytes: rawHex
        };
      }
    } catch {
    }
  }
  if (selector === SELECTOR_PANIC.toLowerCase()) {
    try {
      if (cleanHex.length >= 72) {
        const codeHex = cleanHex.slice(8, 72);
        const panicCode = parseInt(codeHex, 16);
        const panicDescription = PANIC_CODES[panicCode] || `Unknown panic code (0x${panicCode.toString(16)})`;
        return {
          type: "Panic(uint256)",
          selector,
          signature: "Panic(uint256)",
          panicCode,
          panicDescription,
          reason: `Solidity Panic: ${panicDescription}`,
          rawBytes: rawHex
        };
      }
    } catch {
    }
  }
  if (KNOWN_CUSTOM_ERRORS[selector]) {
    const errorDef = KNOWN_CUSTOM_ERRORS[selector];
    const params = [];
    if (cleanHex.length > 8 && errorDef.paramTypes) {
      let offset = 8;
      for (const pType of errorDef.paramTypes) {
        if (offset + 64 <= cleanHex.length) {
          const chunk = cleanHex.slice(offset, offset + 64);
          if (pType === "address") {
            params.push({ type: pType, value: "0x" + chunk.slice(24) });
          } else if (pType === "uint256") {
            const valBig = BigInt("0x" + chunk);
            params.push({ type: pType, value: valBig.toString() });
          } else {
            params.push({ type: pType, value: "0x" + chunk });
          }
          offset += 64;
        }
      }
    }
    return {
      type: "CustomError",
      selector,
      signature: errorDef.signature,
      reason: errorDef.reason,
      params,
      rawBytes: rawHex
    };
  }
  return {
    type: "CustomError",
    selector,
    reason: `Custom contract error with selector ${selector}`,
    rawBytes: rawHex
  };
}
function parseMethodCall(inputData) {
  if (!inputData || inputData === "0x" || inputData.length < 10) {
    return { selector: "0x", name: "Native Transfer / Simple Call" };
  }
  const selector = inputData.slice(0, 10).toLowerCase();
  const KNOWN_METHODS = {
    "0xa9059cbb": "transfer(address,uint256)",
    "0x23b872dd": "transferFrom(address,address,uint256)",
    "0x095ea7b3": "approve(address,uint256)",
    "0x70a08231": "balanceOf(address)",
    "0x4facba38": "crystallizeManagementFee()",
    "0x67bf9bac": "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
    "0x3ce95c61": "executeSwap(address,uint256,bytes)",
    "0x2f139e4f": "assertCondition(bytes)",
    "0x98269401": "depositLiquidity(uint256,uint256)",
    "0xccf50a51": "processVaultOrder(bytes)",
    "0xde5e0b9a": "commitState(bytes32)"
  };
  return {
    selector,
    name: KNOWN_METHODS[selector]
  };
}

// src/explanation.ts
function generateExplanation(category, decodedError, gas, evidence, network) {
  switch (category) {
    case "OUT_OF_GAS":
      return {
        summary: "Transaction failed because it ran out of gas before completing.",
        plainEnglishExplanation: `Your transaction requested an operation that consumed more computational work than the gas limit you specified (${gas.gasLimit.toLocaleString()} units). On EVM networks like Pharos, when a transaction exhausts its allocated gas, the network reverts all state changes to protect against infinite loops, but the fee used up to that point is consumed.`,
        technicalReason: `gasUsed (${gas.gasUsed}) equaled 100% of the gasLimit (${gas.gasLimit}). Receipt status is 0x0. No remaining gas was available to complete contract execution.`,
        actionableSteps: [
          `Increase the gas limit by 25% to 50% when re-submitting in your wallet (e.g. from ${gas.gasLimit.toLocaleString()} to ${Math.round(gas.gasLimit * 1.35).toLocaleString()}).`,
          `Check if the smart contract was trying to loop over too many items or complex batch processing.`,
          `Ensure the dApp is providing a dynamic gas estimate rather than a hardcoded gas limit.`
        ],
        preventativeAdvice: [
          `Always allow your Web3 wallet (MetaMask, Rabby) to calculate gas automatically rather than manually capping it.`,
          `If executing a batch transfer or multi-hop trade, split large operations into smaller batches.`
        ]
      };
    case "SLIPPAGE_EXCEEDED":
      return {
        summary: "Swap transaction failed due to price slippage protection.",
        plainEnglishExplanation: `Your token swap reverted because the market price moved unfavorably between the moment you confirmed the transaction and when the validator included it in a block. The decentralized exchange aborted the trade to protect you from receiving fewer tokens than your minimum acceptable threshold.`,
        technicalReason: `Execution reverted with error string: "${decodedError?.reason || "SLIPPAGE"}". Gas used (${gas.gasUsed.toLocaleString()} of ${gas.gasLimit.toLocaleString()} units) proves execution proceeded into the DEX router before aborting on the slippage check.`,
        actionableSteps: [
          `Open the dApp's settings modal and slightly increase your slippage tolerance (e.g., from 0.5% to 1.0% or 1.5%).`,
          `Wait a minute for high market volatility or liquidity pool fluctuations to stabilize, then retry.`,
          `Check whether the liquidity pool has sufficient token reserves for your order size.`
        ],
        preventativeAdvice: [
          `Avoid trading large volumes during major token launches or high-volatility news events.`,
          `Check route liquidity across multiple pools or use a DEX aggregator to minimize price impact.`
        ]
      };
    case "CONTRACT_REVERT_WITH_REASON":
      const reasonStr = decodedError?.reason || "Unknown requirement";
      return {
        summary: `Smart contract explicitly rejected the transaction: "${reasonStr}".`,
        plainEnglishExplanation: `The smart contract executed successfully up until a safety check (a "require" statement) that was not satisfied. The contract developer provided an explanation: "${reasonStr}". Your state changes were reverted safely and no tokens were lost (except the gas fee consumed).`,
        technicalReason: `Contract at ${evidence.to} reverted during eth_call replay with standard Error(string) selector 0x08c379a0. Decoded UTF-8 string: "${reasonStr}". Gas used: ${gas.gasUsed.toLocaleString()} / ${gas.gasLimit.toLocaleString()}.`,
        actionableSteps: [
          `Read the revert reason carefully: "${reasonStr}". It points directly to the contract condition that failed.`,
          `Ensure your account satisfies all permissions, deadlines, or precondition requirements expected by the contract.`,
          `If this was an auction, staking, or vault interaction, verify that the deposit window is open and your amount satisfies min/max limits.`
        ],
        preventativeAdvice: [
          `Verify contract state and deadlines on ${network.name} explorer before submitting.`,
          `Double-check your account role or whitelist status if calling restricted functions.`
        ]
      };
    case "CUSTOM_ERROR_REVERT":
      const customSelector = decodedError?.selector || "Custom Error";
      const customSig = decodedError?.signature || customSelector;
      const customExplanation = decodedError?.reason || "Protocol-specific custom error";
      return {
        summary: `Protocol reverted with custom error ${customSig}.`,
        plainEnglishExplanation: `Modern Solidity smart contracts use gas-efficient custom errors instead of error strings. The contract returned custom error code ${customSelector}. ${customExplanation}`,
        technicalReason: `Transaction reverted at block ${evidence.blockNumber}. Eth_call replay returned 4-byte custom error selector ${customSelector} (${customSig}). Raw bytes: ${decodedError?.rawBytes.slice(0, 34)}...`,
        actionableSteps: [
          `Review the custom error details: ${customExplanation}.`,
          `Check the parameter values supplied to method ${evidence.methodSelector}.`,
          `Ensure you have approved sufficient token allowances and hold adequate balance.`
        ],
        preventativeAdvice: [
          `Check the protocol's official documentation or ABI for ${customSig} requirements.`
        ]
      };
    case "INSUFFICIENT_BALANCE":
      return {
        summary: `Transaction failed due to insufficient native or token balance.`,
        plainEnglishExplanation: `The transaction required more funds than your wallet held at the time of execution. This can happen if you tried to send more native ${network.currency} than available, or if an ERC-20 transfer exceeded your token balance.`,
        technicalReason: `Transaction attempted to spend funds exceeding available balance. Value: ${evidence.valueNative} ${network.currency}. Gas used: ${gas.gasUsed}.`,
        actionableSteps: [
          `Check your wallet's current balance on ${network.name}.`,
          `Ensure you leave enough native ${network.currency} to cover future gas fees in addition to the transfer amount.`,
          `Acquire additional tokens or reduce the transaction amount before retrying.`
        ],
        preventativeAdvice: [
          `Always maintain a small reserve of ${network.currency} (e.g. 0.05-0.10) in your wallet for transaction fees.`
        ]
      };
    case "INSUFFICIENT_ALLOWANCE":
      return {
        summary: `Transaction failed because the contract does not have permission to transfer your tokens.`,
        plainEnglishExplanation: `Before a decentralized application (like a DEX or staking pool) can move ERC-20 tokens on your behalf, you must first submit an "Approve" transaction. The contract attempted to transfer tokens from your wallet, but the existing allowance was lower than the requested amount.`,
        technicalReason: `ERC-20 transferFrom failed due to allowance limit. Current approval is less than transaction requirement.`,
        actionableSteps: [
          `Submit an "Approve" transaction in the dApp to grant permission for the contract to spend your tokens.`,
          `Verify the approved amount covers your intended deposit or trade size.`,
          `Once the approval transaction is confirmed on ${network.name}, retry your original transaction.`
        ],
        preventativeAdvice: [
          `Check your active token allowances using a revoke tool or explorer before interacting with complex dApps.`
        ]
      };
    case "REVERTED_WITHOUT_REASON":
      return {
        summary: `Contract execution reverted without returning an error message.`,
        plainEnglishExplanation: `The smart contract stopped execution and reverted all changes, but did not provide an explanatory text message or custom error. This typically occurs when a developer wrote a simple "require(condition)" without a failure string, when a contract's fallback function rejected unexpected input, or when an internal assertion was triggered.`,
        technicalReason: `Receipt status is 0x0. Gas used was ${gas.gasUsed.toLocaleString()} of ${gas.gasLimit.toLocaleString()} (leaving ${((gas.gasLimit - gas.gasUsed) / gas.gasLimit * 100).toFixed(1)}% unused gas, confirming this was NOT an Out of Gas failure). EVM call replay returned empty data (0x).`,
        actionableSteps: [
          `Verify that the destination address (${evidence.to}) is the intended contract and not an outdated deployment.`,
          `Inspect the contract's verified source code on ${network.explorerUrl} to check requirements for method ${evidence.methodSelector}.`,
          `Ensure all parameters (dates, amounts, addresses) adhere strictly to the contract's expected format.`
        ],
        preventativeAdvice: [
          `Test unfamiliar contract interactions using small amounts first.`,
          `Contact the dApp team's support channel with the transaction hash for contract-specific guidance.`
        ],
        uncertaintyNotes: [
          `Because the contract author did not attach an error string or custom error data, the exact internal condition can only be identified by reviewing the contract's source code at block ${evidence.blockNumber}.`
        ]
      };
    case "CALL_TO_NON_CONTRACT":
      return {
        summary: `Transaction failed because the recipient address has no smart contract code deployed.`,
        plainEnglishExplanation: `Your transaction sent contract calldata to an address that does not contain a smart contract (it is an externally owned user wallet or an uninitialized address). The transaction cannot execute any contract logic.`,
        technicalReason: `Recipient ${evidence.to} bytecode length is 0 (get_code returned 0x). Calldata was sent to a non-contract address.`,
        actionableSteps: [
          `Double-check the contract address you are trying to interact with.`,
          `Verify you are connected to the correct network (${network.name}).`
        ],
        preventativeAdvice: [
          `Only copy contract addresses from verified project links and official documentation.`
        ]
      };
    case "SUCCESS":
      return {
        summary: `Transaction was successful!`,
        plainEnglishExplanation: `This transaction confirmed successfully on ${network.name}. All state changes were committed to the blockchain.`,
        technicalReason: `Receipt status is 0x1 (success). Block: ${evidence.blockNumber}. Cumulative gas used: ${gas.gasUsed.toLocaleString()}.`,
        actionableSteps: [
          `No troubleshooting is needed. Your transaction completed successfully.`
        ],
        preventativeAdvice: []
      };
    case "TRANSACTION_NOT_FOUND":
    default:
      return {
        summary: `Transaction could not be found or diagnosed.`,
        plainEnglishExplanation: `The transaction hash could not be retrieved from ${network.name}. It may be still pending in the mempool, dropped, or on a different chain.`,
        technicalReason: `Chain MCP get_transaction returned null or error for hash ${evidence.transactionHash}.`,
        actionableSteps: [
          `Verify that the transaction hash is correct and formatted with a 0x prefix followed by 64 hex characters.`,
          `Confirm whether the transaction was broadcast on ${network.name} (Chain ID ${network.chainId}) or a different network.`,
          `Wait a few seconds if you just submitted it, then try again.`
        ],
        preventativeAdvice: []
      };
  }
}

// src/diagnostics.ts
async function diagnoseTransaction(hash, networkId = "pacific", mcpClient) {
  const cleanHash = hash.trim();
  const network = getNetwork(networkId);
  const client = mcpClient || new ChainMcpClient();
  if (!/^0x[0-9a-fA-F]{64}$/.test(cleanHash)) {
    throw new Error(`Invalid transaction hash format. Expected 0x followed by 64 hex characters.`);
  }
  let txData;
  let receiptData;
  try {
    txData = await client.getTransaction(cleanHash);
    receiptData = await client.getTransactionReceipt(cleanHash);
  } catch (err) {
    throw new Error(`Chain MCP communication failure: ${err.message || String(err)}`);
  }
  if (!txData || typeof txData === "object" && txData.error || txData === "null") {
    return createNotFoundDiagnosis(cleanHash, network);
  }
  const blockNumber = txData.blockNumber ? parseInt(txData.blockNumber, 16) : 0;
  const blockHash = txData.blockHash || "";
  const from = (txData.from || "").toLowerCase();
  const to = txData.to ? txData.to.toLowerCase() : null;
  const valueWei = txData.value ? BigInt(txData.value).toString() : "0";
  const valueNative = (Number(valueWei) / 1e18).toFixed(6);
  const nonce = txData.nonce ? parseInt(txData.nonce, 16) : 0;
  const inputBytes = txData.input || "0x";
  const method = parseMethodCall(inputBytes);
  const gasLimit = txData.gas ? parseInt(txData.gas, 16) : 0;
  const gasPriceWei = txData.gasPrice ? BigInt(txData.gasPrice) : 0n;
  const gasPriceGwei = Number(gasPriceWei) / 1e9;
  if (!receiptData || receiptData === "null") {
    return createPendingDiagnosis(cleanHash, network, txData, from, to, valueWei, valueNative, nonce, inputBytes, method, gasLimit, gasPriceGwei);
  }
  const gasUsed = receiptData.gasUsed ? parseInt(receiptData.gasUsed, 16) : 0;
  const effectiveGasPriceWei = receiptData.effectiveGasPrice ? BigInt(receiptData.effectiveGasPrice) : gasPriceWei;
  const effectiveGasPriceGwei = Number(effectiveGasPriceWei) / 1e9;
  const gasRatio = gasLimit > 0 ? gasUsed / gasLimit : 0;
  const isOutOfGas = gasLimit > 0 && gasUsed === gasLimit || gasLimit > 0 && gasRatio >= 0.999;
  const totalFeeWei = BigInt(gasUsed) * effectiveGasPriceWei;
  const totalFeeNative = (Number(totalFeeWei) / 1e18).toFixed(8);
  const gasForensics = {
    gasLimit,
    gasUsed,
    gasPriceGwei,
    effectiveGasPriceGwei,
    gasRatio,
    isOutOfGas,
    totalFeeNative
  };
  const statusRaw = receiptData.status;
  const isSuccess = statusRaw === "0x1" || statusRaw === 1 || statusRaw === "1";
  let recipientIsContract = false;
  if (to) {
    try {
      const code = await client.getCode(to, blockNumber);
      if (typeof code === "string" && code !== "0x" && code.length > 2) {
        recipientIsContract = true;
      }
    } catch {
    }
  }
  let senderBalanceAtBlock;
  try {
    const bal = await client.getBalance(from, blockNumber);
    if (typeof bal === "string") {
      senderBalanceAtBlock = bal;
    } else if (bal && bal.balance) {
      senderBalanceAtBlock = bal.balance;
    }
  } catch {
  }
  if (isSuccess) {
    const evidence2 = {
      source: "Chain MCP",
      mcpToolUsed: "get_transaction, get_transaction_receipt",
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
      timestamp: txData.blockTimestamp ? new Date(parseInt(txData.blockTimestamp, 16) * 1e3).toISOString() : void 0
    };
    const resolution2 = generateExplanation("SUCCESS", void 0, gasForensics, evidence2, network);
    return {
      transactionHash: cleanHash,
      network,
      status: "SUCCESS",
      category: "SUCCESS",
      categoryLabel: "Transaction Confirmed Successfully",
      confidence: "HIGH",
      gas: gasForensics,
      evidence: evidence2,
      resolution: resolution2,
      explorerUrl: network.txUrlTemplate.replace("{hash}", cleanHash),
      diagnosedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  let category = "CONTRACT_REVERT_WITH_REASON";
  let categoryLabel = "Smart Contract Reverted";
  let decodedError;
  let rawRevertBytes = "0x";
  if (isOutOfGas) {
    category = "OUT_OF_GAS";
    categoryLabel = "Out of Gas (Gas Limit Exhausted)";
  } else {
    let replayResult;
    try {
      replayResult = await client.ethCall(
        {
          from,
          to,
          data: inputBytes,
          value: txData.value || "0x0",
          gas: txData.gas || "0x4c4b40"
        },
        blockNumber
      );
    } catch (e) {
      replayResult = { error: { message: e.message || String(e) } };
    }
    if (replayResult && typeof replayResult === "object") {
      if (replayResult.error) {
        const err = replayResult.error;
        rawRevertBytes = err.data || (typeof err.message === "string" && err.message.includes("0x") ? err.message.slice(err.message.indexOf("0x")) : "0x");
        if (!rawRevertBytes || rawRevertBytes === "0x") {
          const match = (err.message || "").match(/execution reverted:\s*([^\n,]+)/i);
          if (match && match[1].trim()) {
            decodedError = {
              type: "Error(string)",
              signature: "Error(string)",
              reason: match[1].trim(),
              rawBytes: "0x"
            };
          }
        }
      } else if (typeof replayResult === "string" && replayResult.startsWith("0x")) {
        rawRevertBytes = replayResult;
      }
    }
    if (!decodedError && rawRevertBytes && rawRevertBytes !== "0x") {
      decodedError = decodeRevertBytes(rawRevertBytes);
    }
    const errorText = ((decodedError?.reason || "") + " " + (decodedError?.signature || "")).toLowerCase();
    if (errorText.includes("slippage") || errorText.includes("spl0") || errorText.includes("too little received") || errorText.includes("maxslippage")) {
      category = "SLIPPAGE_EXCEEDED";
      categoryLabel = "Slippage Protection Exceeded";
    } else if (errorText.includes("insufficient balance") || decodedError?.selector === "0xe450d38c") {
      category = "INSUFFICIENT_BALANCE";
      categoryLabel = "Insufficient Balance";
    } else if (errorText.includes("insufficient allowance") || decodedError?.selector === "0xfb8f41b2") {
      category = "INSUFFICIENT_ALLOWANCE";
      categoryLabel = "Insufficient Token Allowance";
    } else if (decodedError && decodedError.type === "CustomError") {
      category = "CUSTOM_ERROR_REVERT";
      categoryLabel = `Custom Error Revert (${decodedError.signature || decodedError.selector})`;
    } else if (decodedError && decodedError.type === "Panic(uint256)") {
      category = "CONTRACT_REVERT_WITH_REASON";
      categoryLabel = `Solidity Panic (${decodedError.panicDescription})`;
    } else if (decodedError && decodedError.type === "Error(string)" && decodedError.reason) {
      category = "CONTRACT_REVERT_WITH_REASON";
      categoryLabel = `Contract Reverted: "${decodedError.reason}"`;
    } else {
      if (!recipientIsContract && to) {
        category = "CALL_TO_NON_CONTRACT";
        categoryLabel = "Call to Non-Contract Address";
      } else {
        category = "REVERTED_WITHOUT_REASON";
        categoryLabel = "Reverted Without Reason String";
      }
    }
  }
  const evidence = {
    source: "Chain MCP",
    mcpToolUsed: "get_transaction, get_transaction_receipt, eth_call",
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
    timestamp: txData.blockTimestamp ? new Date(parseInt(txData.blockTimestamp, 16) * 1e3).toISOString() : void 0
  };
  const resolution = generateExplanation(category, decodedError, gasForensics, evidence, network);
  return {
    transactionHash: cleanHash,
    network,
    status: "FAILED",
    category,
    categoryLabel,
    confidence: decodedError?.reason || isOutOfGas ? "HIGH" : "MEDIUM",
    gas: gasForensics,
    decodedError,
    evidence,
    resolution,
    explorerUrl: network.txUrlTemplate.replace("{hash}", cleanHash),
    diagnosedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function createNotFoundDiagnosis(hash, network) {
  const emptyGas = {
    gasLimit: 0,
    gasUsed: 0,
    gasPriceGwei: 0,
    effectiveGasPriceGwei: 0,
    gasRatio: 0,
    isOutOfGas: false,
    totalFeeNative: "0"
  };
  const evidence = {
    source: "Chain MCP",
    mcpToolUsed: "get_transaction",
    blockNumber: 0,
    blockHash: "",
    transactionHash: hash,
    from: "",
    to: null,
    valueWei: "0",
    valueNative: "0",
    nonce: 0,
    inputBytes: "0x",
    methodSelector: "0x",
    recipientIsContract: false
  };
  const resolution = generateExplanation("TRANSACTION_NOT_FOUND", void 0, emptyGas, evidence, network);
  return {
    transactionHash: hash,
    network,
    status: "NOT_FOUND",
    category: "TRANSACTION_NOT_FOUND",
    categoryLabel: "Transaction Not Found On-Chain",
    confidence: "HIGH",
    gas: emptyGas,
    evidence,
    resolution,
    explorerUrl: network.txUrlTemplate.replace("{hash}", hash),
    diagnosedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function createPendingDiagnosis(hash, network, txData, from, to, valueWei, valueNative, nonce, inputBytes, method, gasLimit, gasPriceGwei) {
  const gasForensics = {
    gasLimit,
    gasUsed: 0,
    gasPriceGwei,
    effectiveGasPriceGwei: gasPriceGwei,
    gasRatio: 0,
    isOutOfGas: false,
    totalFeeNative: "0"
  };
  const evidence = {
    source: "Chain MCP",
    mcpToolUsed: "get_transaction",
    blockNumber: txData.blockNumber ? parseInt(txData.blockNumber, 16) : 0,
    blockHash: txData.blockHash || "",
    transactionHash: hash,
    from,
    to,
    valueWei,
    valueNative,
    nonce,
    inputBytes,
    methodSelector: method.selector,
    decodedMethodName: method.name,
    recipientIsContract: false
  };
  return {
    transactionHash: hash,
    network,
    status: "PENDING",
    category: "INSUFFICIENT_EVIDENCE",
    categoryLabel: "Transaction Pending / In Mempool",
    confidence: "MEDIUM",
    gas: gasForensics,
    evidence,
    resolution: {
      summary: "Transaction is pending or awaiting block inclusion.",
      plainEnglishExplanation: "This transaction was found in the network mempool but has not yet been processed into a block receipt.",
      technicalReason: "get_transaction succeeded but get_transaction_receipt returned null.",
      actionableSteps: ["Wait 5-10 seconds for the block to confirm and re-diagnose."],
      preventativeAdvice: []
    },
    explorerUrl: network.txUrlTemplate.replace("{hash}", hash),
    diagnosedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/api/diagnose.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  try {
    let hash = "";
    let network = "pacific";
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      hash = body.hash || body.txHash || "";
      network = body.network || "pacific";
    } else {
      hash = req.query?.hash || req.query?.txHash || "";
      network = req.query?.network || "pacific";
    }
    if (!hash) {
      res.status(400).json({
        error: "Missing required parameter: hash",
        hint: "Provide a 0x-prefixed 32-byte transaction hash."
      });
      return;
    }
    const diagnosis = await diagnoseTransaction(hash, network);
    res.status(200).json(diagnosis);
  } catch (err) {
    res.status(500).json({
      error: err.message || "Internal diagnostic error",
      details: String(err)
    });
  }
}
export {
  handler as default
};
