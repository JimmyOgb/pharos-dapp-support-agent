import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRevertBytes, parseMethodCall } from '../../src/decoder.ts';

describe('ABI Error Decoder Unit Tests', () => {
  test('decodes Error(string) selector 0x08c379a0 correctly', () => {
    // 0x08c379a0 + offset 32 + length 8 + "SLIPPAGE"
    const hex = '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000008534c495050414745000000000000000000000000000000000000000000000000';
    const res = decodeRevertBytes(hex);
    assert.equal(res.type, 'Error(string)');
    assert.equal(res.reason, 'SLIPPAGE');
    assert.equal(res.selector, '0x08c379a0');
  });

  test('decodes Error(string) with "succeeded to fail"', () => {
    const hex = '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001173756363656564656420746f206661696c000000000000000000000000000000';
    const res = decodeRevertBytes(hex);
    assert.equal(res.type, 'Error(string)');
    assert.equal(res.reason, 'succeeded to fail');
  });

  test('decodes Panic(uint256) selector 0x4e487b71', () => {
    // Panic code 0x01 = Assert evaluated to false
    const hex = '0x4e487b710000000000000000000000000000000000000000000000000000000000000001';
    const res = decodeRevertBytes(hex);
    assert.equal(res.type, 'Panic(uint256)');
    assert.equal(res.panicCode, 1);
    assert.match(res.panicDescription || '', /Assertion failed/);
  });

  test('decodes Panic(uint256) for arithmetic overflow (0x11)', () => {
    const hex = '0x4e487b710000000000000000000000000000000000000000000000000000000000000011';
    const res = decodeRevertBytes(hex);
    assert.equal(res.type, 'Panic(uint256)');
    assert.equal(res.panicCode, 17);
    assert.match(res.panicDescription || '', /underflow or overflow/);
  });

  test('decodes known custom error 0xe450d38c (ERC20InsufficientBalance)', () => {
    const hex = '0xe450d38c00000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000001bc16d674ec800000';
    const res = decodeRevertBytes(hex);
    assert.equal(res.type, 'CustomError');
    assert.equal(res.selector, '0xe450d38c');
    assert.equal(res.signature, 'ERC20InsufficientBalance(address,uint256,uint256)');
    assert.equal(res.params?.length, 3);
  });

  test('handles empty revert data cleanly', () => {
    const res = decodeRevertBytes('0x');
    assert.equal(res.type, 'Empty');
    assert.equal(res.rawBytes, '0x');
  });

  test('parses known method signatures from calldata', () => {
    const method1 = parseMethodCall('0xa9059cbb000000000000000000000000');
    assert.equal(method1.selector, '0xa9059cbb');
    assert.equal(method1.name, 'transfer(address,uint256)');

    const method2 = parseMethodCall('0x67bf9bac000000000000000000000000');
    assert.equal(method2.selector, '0x67bf9bac');
    assert.match(method2.name || '', /swapExactTokensForTokens/);
  });
});
