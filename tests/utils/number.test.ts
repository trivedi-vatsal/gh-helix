import { describe, expect, it } from 'vitest';
import { parsePositiveInt } from '../../src/utils/number.js';
import { ConfigError } from '../../src/utils/errors.js';

describe('parsePositiveInt', () => {
  it('returns the fallback when value is undefined', () => {
    expect(parsePositiveInt(undefined, 5)).toBe(5);
  });

  it('parses a valid string', () => {
    expect(parsePositiveInt('8', 5)).toBe(8);
  });

  it('accepts a number directly', () => {
    expect(parsePositiveInt(8, 5)).toBe(8);
  });

  it('throws ConfigError for non-numeric input instead of returning NaN', () => {
    expect(() => parsePositiveInt('abc', 5)).toThrow(ConfigError);
  });

  it('throws ConfigError for zero or negative values', () => {
    expect(() => parsePositiveInt('0', 5)).toThrow(ConfigError);
    expect(() => parsePositiveInt('-3', 5)).toThrow(ConfigError);
  });

  it('includes the provided label in the error message', () => {
    expect(() => parsePositiveInt('abc', 5, '--retries')).toThrow(/--retries/);
  });
});
