import { describe, expect, it } from 'vitest';
import { formatElapsed } from '../../src/utils/time.js';

describe('formatElapsed', () => {
  it('formats seconds only', () => {
    expect(formatElapsed(45_000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatElapsed(83_000)).toBe('1m 23s');
  });

  it('formats hours, minutes, and seconds', () => {
    expect(formatElapsed(3_723_000)).toBe('1h 2m 3s');
  });

  it('clamps negative durations to zero', () => {
    expect(formatElapsed(-500)).toBe('0s');
  });
});
