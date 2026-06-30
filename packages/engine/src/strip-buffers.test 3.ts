import { describe, it, expect } from 'vitest';
import { stripBuffers } from './strip-buffers.js';

describe('stripBuffers', () => {
  it('replaces a top-level Buffer with "[binary]"', () => {
    expect(stripBuffers(Buffer.from('hello'))).toBe('[binary]');
  });

  it('replaces a nested Buffer with "[binary]"', () => {
    const result = stripBuffers({ data: { name: 'Test' }, pdf: Buffer.from('%PDF') });
    expect(result).toEqual({ data: { name: 'Test' }, pdf: '[binary]' });
  });

  it('leaves primitives unchanged', () => {
    expect(stripBuffers('text')).toBe('text');
    expect(stripBuffers(42)).toBe(42);
    expect(stripBuffers(null)).toBeNull();
    expect(stripBuffers(true)).toBe(true);
  });

  it('strips Buffers inside arrays', () => {
    const result = stripBuffers([1, Buffer.from('x'), 'str']);
    expect(result).toEqual([1, '[binary]', 'str']);
  });

  it('handles deeply nested objects', () => {
    const result = stripBuffers({ a: { b: { c: Buffer.from('deep') } } });
    expect(result).toEqual({ a: { b: { c: '[binary]' } } });
  });

  it('passes through plain objects with no Buffers unchanged', () => {
    const obj = { name: 'Ivy Tax', stats: [{ label: 'Founded', value: '2005' }] };
    expect(stripBuffers(obj)).toEqual(obj);
  });
});
