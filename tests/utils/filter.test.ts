import { describe, expect, it } from 'vitest';
import { shouldIncludeRepo } from '../../src/utils/filter.js';

describe('shouldIncludeRepo', () => {
  it('includes everything when no filters are set', () => {
    expect(shouldIncludeRepo('widget', 'my-org/widget', {})).toBe(true);
  });

  it('excludes repos matching an exclude glob', () => {
    expect(
      shouldIncludeRepo('widget-archive', 'my-org/widget-archive', { exclude: ['*-archive'] }),
    ).toBe(false);
  });

  it('only includes repos matching an include glob', () => {
    const options = { include: ['api-*'] };
    expect(shouldIncludeRepo('api-gateway', 'my-org/api-gateway', options)).toBe(true);
    expect(shouldIncludeRepo('widget', 'my-org/widget', options)).toBe(false);
  });

  it('lets exclude win over include', () => {
    const options = { include: ['api-*'], exclude: ['api-legacy'] };
    expect(shouldIncludeRepo('api-legacy', 'my-org/api-legacy', options)).toBe(false);
  });

  it('matches against owner/name as well as the bare name', () => {
    expect(shouldIncludeRepo('widget', 'my-org/widget', { include: ['my-org/*'] })).toBe(true);
  });
});
