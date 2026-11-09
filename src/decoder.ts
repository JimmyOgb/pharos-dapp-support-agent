import type { DecodedError } from './types.ts';

// Standard EVM Error Selectors
export const SELECTOR_ERROR_STRING = '0x08c379a0'; // Error(string)
export const SELECTOR_PANIC = '0x4e487b71';        // Panic(uint256)

// Solidity Panic Code Mapping
export const PANIC_CODES: Record<number, string> = {
  0x00: 'Generic compiler panic',
  0x01: 'Assertion failed (assert statement evaluated to false)',
  0x11: 'Arithmetic underflow or overflow outside unchecked block',
  0x12: 'Division or modulo by zero',
  0x21: 'Enum conversion out of bounds',
  0x22: 'Access to incorrectly encoded storage byte array',
  0x31: 'Called .pop() on an empty array',
  0x32: 'Array index out of bounds',
  0x41: 'Out of memory / allocation limit reached',
  0x51: 'Called zero-initialized internal function pointer',
};

// Known Custom Error Signatures
export const KNOWN_CUSTOM_ERRORS: Record<string, { signature: string; reason: string; paramTypes?: string[] }> = {
  // OpenZeppelin ERC20
  '0xe450d38c': {
    signature: 'ERC20InsufficientBalance(address,uint256,uint256)',
    reason: 'The sender does not hold enough token balance to fulfill this transfer.',
    paramTypes: ['address', 'uint256', 'uint256'],
  },
  '0xfb8f41b2': {
    signature: 'ERC20InsufficientAllowance(address,uint256,uint256)',
    reason: 'The spender allowance is lower than the amount requested to transferFrom.',
    paramTypes: ['address', 'uint256', 'uint256'],
  },
  '0xec447034': {
    signature: 'ERC20InvalidSender(address)',
    reason: 'Invalid token sender address (e.g. zero address).',
    paramTypes: ['address'],
  },
  '0x94280d62': {
    signature: 'ERC20InvalidReceiver(address)',
    reason: 'Invalid token recipient address (e.g. zero address).',
    paramTypes: ['address'],
  },
  '0x118cdaa7': {
    signature: 'OwnableUnauthorizedAccount(address)',
    reason: 'Caller is not the contract owner or authorized admin.',
    paramTypes: ['address'],
  },
  '0xd92e233d': {
    signature: 'EnforcedPause()',
    reason: 'The contract is currently paused by protocol admins for emergency or maintenance.',
    paramTypes: [],
  },
  '0x8baa579f': {
    signature: 'AddressInsufficientBalance(address)',
    reason: 'The contract or account has insufficient native balance to perform the call.',
    paramTypes: ['address'],
  },
  '0x5734e94a': {
    signature: 'FailedInnerCall()',
    reason: 'A low-level contract call (call/delegatecall) failed during execution.',
    paramTypes: [],
  },
  // DeFi & Swaps
  '0x2c19b8b8': {
    signature: 'InsufficientAmount(uint256,uint256)',
    reason: 'Available balance or reserve amount is less than the required amount.',
    paramTypes: ['uint256', 'uint256'],
  },
  '0x90b8ec18': {
    signature: 'PoolRequirementFailed()',
    reason: 'Internal pool invariant or liquidity check was not satisfied.',
    paramTypes: [],
  },
  '0xd7815800': {
    signature: 'UnauthorizedOrExpired()',
    reason: 'Execution expired or caller signature failed authentication verification.',
    paramTypes: [],
  },
  '0x22611167': {
    signature: 'CommitPeriodExpired()',
    reason: 'The transaction commit or dispute window has closed or state is locked.',
    paramTypes: [],
  },
  '0x718a7051': {
    signature: 'MaxSlippageExceeded()',
    reason: 'The actual swap price exceeded the maximum allowed slippage tolerance.',
    paramTypes: [],
  },
};

/**
 * Decodes raw revert bytes returned by eth_call replay or RPC error data
 */
export function decodeRevertBytes(rawHex: string | null | undefined): DecodedError {
  if (!rawHex || rawHex === '0x' || rawHex === '') {
    return {
      type: 'Empty',
      rawBytes: rawHex || '0x',
      reason: 'No error data returned (reverted without reason string)',
    };
  }

  const cleanHex = rawHex.startsWith('0x') ? rawHex.slice(2) : rawHex;

  if (cleanHex.length < 8) {
    return {
      type: 'Unknown',
      rawBytes: rawHex,
      reason: `Truncated return data (${cleanHex.length / 2} bytes)`,
    };
  }

  const selector = '0x' + cleanHex.slice(0, 8).toLowerCase();

  // 1. Standard Error(string): 0x08c379a0
  if (selector === SELECTOR_ERROR_STRING.toLowerCase()) {
    try {
      // Structure:
      // [0..8]: selector
      // [8..72]: offset of string (usually 0x20 = 32)
      // [72..136]: length of string in bytes
      // [136..]: utf8 bytes
      if (cleanHex.length >= 136) {
        const lengthHex = cleanHex.slice(72, 136);
        const length = parseInt(lengthHex, 16);
        const stringHex = cleanHex.slice(136, 136 + length * 2);
        const buffer = Buffer.from(stringHex, 'hex');
        const reason = buffer.toString('utf-8');

        return {
          type: 'Error(string)',
          selector,
          signature: 'Error(string)',
          reason,
          rawBytes: rawHex,
        };
      }
    } catch {
      // fallback if decoding fails
    }
  }

  // 2. Solidity Panic(uint256): 0x4e487b71
  if (selector === SELECTOR_PANIC.toLowerCase()) {
    try {
      if (cleanHex.length >= 72) {
        const codeHex = cleanHex.slice(8, 72);
        const panicCode = parseInt(codeHex, 16);
        const panicDescription = PANIC_CODES[panicCode] || `Unknown panic code (0x${panicCode.toString(16)})`;

        return {
          type: 'Panic(uint256)',
          selector,
          signature: 'Panic(uint256)',
          panicCode,
          panicDescription,
          reason: `Solidity Panic: ${panicDescription}`,
          rawBytes: rawHex,
        };
      }
    } catch {
      // fallback
    }
  }

  // 3. Known Custom Errors
  if (KNOWN_CUSTOM_ERRORS[selector]) {
    const errorDef = KNOWN_CUSTOM_ERRORS[selector];
    const params: Array<{ name?: string; value: string; type?: string }> = [];

    // Extract parameters if 32-byte chunks exist
    if (cleanHex.length > 8 && errorDef.paramTypes) {
      let offset = 8;
      for (const pType of errorDef.paramTypes) {
        if (offset + 64 <= cleanHex.length) {
          const chunk = cleanHex.slice(offset, offset + 64);
          if (pType === 'address') {
            params.push({ type: pType, value: '0x' + chunk.slice(24) });
          } else if (pType === 'uint256') {
            const valBig = BigInt('0x' + chunk);
            params.push({ type: pType, value: valBig.toString() });
          } else {
            params.push({ type: pType, value: '0x' + chunk });
          }
          offset += 64;
        }
      }
    }

    return {
      type: 'CustomError',
      selector,
      signature: errorDef.signature,
      reason: errorDef.reason,
      params,
      rawBytes: rawHex,
    };
  }

  // 4. Unknown Custom 4-byte selector
  return {
    type: 'CustomError',
    selector,
    reason: `Custom contract error with selector ${selector}`,
    rawBytes: rawHex,
  };
}

/**
 * Extracts method selector and friendly name if recognizable
 */
export function parseMethodCall(inputData: string): { selector: string; name?: string } {
  if (!inputData || inputData === '0x' || inputData.length < 10) {
    return { selector: '0x', name: 'Native Transfer / Simple Call' };
  }
  const selector = inputData.slice(0, 10).toLowerCase();

  const KNOWN_METHODS: Record<string, string> = {
    '0xa9059cbb': 'transfer(address,uint256)',
    '0x23b872dd': 'transferFrom(address,address,uint256)',
    '0x095ea7b3': 'approve(address,uint256)',
    '0x70a08231': 'balanceOf(address)',
    '0x4facba38': 'crystallizeManagementFee()',
    '0x67bf9bac': 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
    '0x3ce95c61': 'executeSwap(address,uint256,bytes)',
    '0x2f139e4f': 'assertCondition(bytes)',
    '0x98269401': 'depositLiquidity(uint256,uint256)',
    '0xccf50a51': 'processVaultOrder(bytes)',
    '0xde5e0b9a': 'commitState(bytes32)',
  };

  return {
    selector,
    name: KNOWN_METHODS[selector],
  };
}
