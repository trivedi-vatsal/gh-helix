import { describe, expect, it, vi } from 'vitest';
import { retry } from '../../src/utils/retry.js';

describe('retry', () => {
  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success within the attempt budget', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('ok');
    await expect(retry(fn, { retries: 3, minTimeoutMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error once attempts are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent'));
    await expect(retry(fn, { retries: 2, minTimeoutMs: 1 })).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
