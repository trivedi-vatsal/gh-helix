import { describe, expect, it } from 'vitest';
import { formatBytes } from '../../src/utils/fs.js';

describe('formatBytes', () => {
  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes below 1KB without decimals', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes with two decimals', () => {
    expect(formatBytes(2048)).toBe('2.00 KB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.00 GB');
  });
});
