import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseTransaction } from '../../src/diagnostics.ts';
import { ChainMcpClient } from '../../src/mcp-client.ts';

describe('Live Chain MCP Integration Tests (Zero-Simulation)', { timeout: 240000 }, () => {
  const client = new ChainMcpClient();

  test('Chain MCP connects, initializes and returns valid Pharos chain info', async () => {
    const chainInfo = await client.getChainInfo();
    assert.ok(chainInfo, 'chainInfo must exist');
    assert.equal(chainInfo.name, 'Pharos');
    assert.equal(chainInfo.chainId, 1672);
  });

  test('Diagnoses Live Transaction 1: Genuine Slippage Revert ("SLIPPAGE")', async () => {
    const hash = '0x0b476df1d26079224c1d37e64d7f9506c906f70671525cbed317a4816e785d4e';
    const res = await diagnoseTransaction(hash, 'pacific', client);

    assert.equal(res.status, 'FAILED');
    assert.equal(res.category, 'SLIPPAGE_EXCEEDED');
    assert.equal(res.decodedError?.reason, 'SLIPPAGE');
    assert.match(res.resolution.plainEnglishExplanation, /price moved unfavorably/);
    assert.equal(res.evidence.source, 'Chain MCP');
  });

  test('Diagnoses Live Transaction 2: Genuine Contract Invariant Revert ("succeeded to fail")', async () => {
    const hash = '0x40cf7e708148a3e75f98a77138b6a9560258d91c96ced246cfb4dbfd01338c52';
    const res = await diagnoseTransaction(hash, 'pacific', client);

    assert.equal(res.status, 'FAILED');
    assert.equal(res.category, 'CONTRACT_REVERT_WITH_REASON');
    assert.equal(res.decodedError?.reason, 'succeeded to fail');
    assert.match(res.resolution.summary, /succeeded to fail/);
  });

  test('Diagnoses Live Transaction 3: Genuine Custom Error Revert (0x2c19b8b8)', async () => {
    const hash = '0x8ebbdfaf1ce0b3a498936ba1c73307d6b157264571111a803e69947ae219a349';
    const res = await diagnoseTransaction(hash, 'pacific', client);

    assert.equal(res.status, 'FAILED');
    assert.equal(res.category, 'CUSTOM_ERROR_REVERT');
    assert.equal(res.decodedError?.selector, '0x2c19b8b8');
  });

  test('Diagnoses Live Transaction 4: Non-Contract Call Revert (CALL_TO_NON_CONTRACT)', async () => {
    const hash = '0xb32c2408a85fdb64453c682fe7e76cc27f0cc481308ca1b673878550e48abd6e';
    const res = await diagnoseTransaction(hash, 'pacific', client);

    assert.equal(res.status, 'FAILED');
    assert.equal(res.category, 'CALL_TO_NON_CONTRACT');
    assert.equal(res.gas.isOutOfGas, false);
    assert.match(res.resolution.summary, /contract code deployed/i);
  });

  test('Diagnoses Live Successful Transaction (status 0x1)', async () => {
    const hash = '0x430f6728555f50f405a0a0351965a0550cae597da9dcf2612ea6725e18dc43d6';
    const res = await diagnoseTransaction(hash, 'pacific', client);

    assert.equal(res.status, 'SUCCESS');
    assert.equal(res.category, 'SUCCESS');
    assert.match(res.resolution.summary, /successful/i);
  });
});
