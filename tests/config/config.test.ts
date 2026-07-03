import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resolveTokenHint } from '../../src/config/config.js';
import { ConfigError } from '../../src/utils/errors.js';

const MANAGED_KEYS = [
  'GITHUB_ORG',
  'BACKUP_DIRECTORY',
  'MAX_PARALLEL',
  'FETCH_LFS',
  'GH_HOST',
  'GITHUB_API_URL',
  'GITHUB_TOKEN',
  'GH_TOKEN',
] as const;

describe('config/config', () => {
  let tmpDir: string;
  let missingEnvFile: string;
  const originalValues = new Map<string, string | undefined>();

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-config-test-'));
    missingEnvFile = path.join(tmpDir, 'does-not-exist.env');
    for (const key of MANAGED_KEYS) {
      originalValues.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const key of MANAGED_KEYS) {
      const value = originalValues.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('throws ConfigError when GITHUB_ORG is missing everywhere', () => {
    expect(() =>
      loadConfig({
        envFilePath: missingEnvFile,
        configFilePath: path.join(tmpDir, 'config.json'),
      }),
    ).toThrow(ConfigError);
  });

  it('reads settings from config.json when the environment is unset', async () => {
    const configFilePath = path.join(tmpDir, 'config.json');
    await writeFile(
      configFilePath,
      JSON.stringify({
        GITHUB_ORG: 'file-org',
        BACKUP_DIRECTORY: path.join(tmpDir, 'backups'),
        MAX_PARALLEL: 8,
        FETCH_LFS: false,
      }),
      'utf8',
    );

    const config = loadConfig({ envFilePath: missingEnvFile, configFilePath });
    expect(config.githubOrg).toBe('file-org');
    expect(config.maxParallel).toBe(8);
    expect(config.fetchLfs).toBe(false);
  });

  it('lets a real environment variable override config.json', async () => {
    const configFilePath = path.join(tmpDir, 'config.json');
    await writeFile(
      configFilePath,
      JSON.stringify({
        GITHUB_ORG: 'file-org',
        BACKUP_DIRECTORY: path.join(tmpDir, 'backups'),
      }),
      'utf8',
    );
    process.env['GITHUB_ORG'] = 'env-org';

    const config = loadConfig({ envFilePath: missingEnvFile, configFilePath });
    expect(config.githubOrg).toBe('env-org');
  });

  it('resolves a token hint from GITHUB_TOKEN before GH_TOKEN', () => {
    process.env['GITHUB_TOKEN'] = 'from-github-token';
    process.env['GH_TOKEN'] = 'from-gh-token';
    expect(resolveTokenHint({ configFilePath: path.join(tmpDir, 'config.json') })).toBe(
      'from-github-token',
    );
  });

  it('falls back to config.json for a token hint when env is unset', async () => {
    const configFilePath = path.join(tmpDir, 'config.json');
    await writeFile(configFilePath, JSON.stringify({ GH_TOKEN: 'from-file' }), 'utf8');
    expect(resolveTokenHint({ configFilePath })).toBe('from-file');
  });
});
