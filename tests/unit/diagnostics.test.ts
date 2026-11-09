import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseTransaction } from '../../src/diagnostics.ts';
import { ChainMcpClient } from '../../src/mcp-client.ts';

describe('Diagnostic Engine Unit Tests', () => {
  test('rejects invalid transaction hash formats immediately', async () => {
    await assert.rejects(
      async () => {
        await diagnoseTransaction('0xinvalid');
      },
      { message: /Invalid transaction hash format/ }
    );
  });

  test('identifies OUT_OF_GAS when gasUsed equals gasLimit', async () => {
    const mockMcp = {
      getTransaction: async () => ({
        hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        blockNumber: '0x100',
        from: '0xaaaa',
        to: '0xbbbb',
        gas: '0x186a0', // 100,000
        gasPrice: '0x3b9aca00',
        value: '0x0',
        input: '0x1234',
      }),
      getTransactionReceipt: async () => ({
        status: '0x0',
        gasUsed: '0x186a0', // 100,000 (100% of gasLimit)
        effectiveGasPrice: '0x3b9aca00',
      }),
      getCode: async () => '0x60806040',
      getBalance: async () => '1000000000000000000',
      ethCall: async () => ({ error: { message: 'out of gas' } }),
    } as unknown as ChainMcpClient;

    const res = await diagnoseTransaction(
      '0x1111111111111111111111111111111111111111111111111111111111111111',
      'pacific',
      mockMcp
    );

    assert.equal(res.status, 'FAILED');
    assert.equal(res.category, 'OUT_OF_GAS');
    assert.equal(res.gas.isOutOfGas, true);
    assert.match(res.resolution.summary, /ran out of gas/);
  });

  test('identifies SLIPPAGE_EXCEEDED from eth_call revert data', async () => {
    const mockMcp = {
      getTransaction: async () => ({
        hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        blockNumber: '0x100',
        from: '0xaaaa',
        to: '0xbbbb',
        gas: '0x7a120', // 500,000
        gasPrice: '0x3b9aca00',
        value: '0x0',
        input: '0x67bf9bac',
      }),
      getTransactionReceipt: async () => ({
        status: '0x0',
        gasUsed: '0x30d40', // 200,000 (40% of limit)
        effectiveGasPrice: '0x3b9aca00',
      }),
      getCode: async () => '0x60806040',
      getBalance: async () => '1000000000000000000',
      ethCall: async () => ({
        error: {
          code: 3,
          message: 'execution reverted: SLIPPAGE',
          data: '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000008534c495050414745000000000000000000000000000000000000000000000000',
        },
      }),
    } as unknown as ChainMcpClient;

    const res = await diagnoseTransaction(
      '0x2222222222222222222222222222222222222222222222222222222222222222',
      'pacific',
      mockMcp
    );

    assert.equal(res.status, 'FAILED');
    assert.equal(res.category, 'SLIPPAGE_EXCEEDED');
    assert.match(res.resolution.plainEnglishExplanation, /price moved unfavorably/);
  });

  test('identifies SUCCESS correctly on 0x1 status', async () => {
    const mockMcp = {
      getTransaction: async () => ({
        hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
        blockNumber: '0x100',
        from: '0xaaaa',
        to: '0xbbbb',
        gas: '0x5208',
        gasPrice: '0x3b9aca00',
        value: '0xde0b6b3a7640000',
        input: '0x',
      }),
      getTransactionReceipt: async () => ({
        status: '0x1',
        gasUsed: '0x5208',
        effectiveGasPrice: '0x3b9aca00',
      }),
      getCode: async () => '0x',
      getBalance: async () => '5000000000000000000',
    } as unknown as ChainMcpClient;

    const res = await diagnoseTransaction(
      '0x3333333333333333333333333333333333333333333333333333333333333333',
      'pacific',
      mockMcp
    );

    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.category, 'SUCCESS');
  });
});
