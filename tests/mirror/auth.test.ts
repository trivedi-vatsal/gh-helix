import { describe, expect, it } from 'vitest';
import { buildGitAuthEnv, selectCloneUrl } from '../../src/mirror/auth.js';

describe('buildGitAuthEnv', () => {
  it('disables interactive credential prompting even when no token is given', () => {
    expect(buildGitAuthEnv(undefined)).toEqual({
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    });
  });

  it('injects a Basic-auth Authorization header and disables credential-helper fallback when a token is given', () => {
    const env = buildGitAuthEnv('secret-token');
    const expectedHeader = `Authorization: Basic ${Buffer.from('x-access-token:secret-token').toString('base64')}`;

    expect(env).toEqual({
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'http.extraheader',
      GIT_CONFIG_VALUE_0: expectedHeader,
      GIT_CONFIG_KEY_1: 'credential.helper',
      GIT_CONFIG_VALUE_1: '',
    });
  });

  it('uses HTTP Basic auth, not Bearer/token schemes -- GitHub rejects those for git-over-HTTPS', () => {
    const env = buildGitAuthEnv('secret-token');
    expect(env.GIT_CONFIG_VALUE_0).toMatch(/^Authorization: Basic /);
    expect(env.GIT_CONFIG_VALUE_0).not.toMatch(/bearer/i);
    expect(env.GIT_CONFIG_VALUE_0).not.toMatch(/^Authorization: token/i);
  });

  it('never returns undefined, so callers can never accidentally skip the anti-prompt env vars', () => {
    expect(buildGitAuthEnv(undefined)).not.toBeUndefined();
    expect(buildGitAuthEnv('token')).not.toBeUndefined();
  });
});

describe('selectCloneUrl', () => {
  const repo = {
    sshUrl: 'git@github.com:org/widget.git',
    cloneUrl: 'https://github.com/org/widget.git',
  };

  it('prefers the HTTPS clone URL when a token is available', () => {
    expect(selectCloneUrl(repo, 'secret-token')).toBe(repo.cloneUrl);
  });

  it('falls back to the SSH URL when no token is available', () => {
    expect(selectCloneUrl(repo, undefined)).toBe(repo.sshUrl);
  });
});
