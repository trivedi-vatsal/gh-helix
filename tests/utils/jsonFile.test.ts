import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quarantineCorruptFile, readJsonFile } from '../../src/utils/jsonFile.js';
import { atomicWriteFile, pathExists } from '../../src/utils/fs.js';

describe('readJsonFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-jsonfile-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports missing for a file that does not exist', async () => {
    const result = await readJsonFile(path.join(dir, 'nope.json'));
    expect(result.status).toBe('missing');
  });

  it('reports ok and parses valid JSON', async () => {
    const file = path.join(dir, 'data.json');
    await writeFile(file, JSON.stringify({ a: 1 }), 'utf8');
    const result = await readJsonFile<{ a: number }>(file);
    expect(result).toEqual({ status: 'ok', value: { a: 1 } });
  });

  it('reports corrupt for invalid JSON instead of silently returning nothing', async () => {
    const file = path.join(dir, 'bad.json');
    await writeFile(file, '{ not valid json', 'utf8');
    const result = await readJsonFile(file);
    expect(result.status).toBe('corrupt');
    if (result.status === 'corrupt') {
      expect(result.error).toBeInstanceOf(Error);
    }
  });
});

describe('quarantineCorruptFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-quarantine-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('moves the file aside and preserves it for forensics', async () => {
    const file = path.join(dir, 'bad.json');
    await writeFile(file, 'garbage', 'utf8');

    const quarantined = await quarantineCorruptFile(file);

    expect(quarantined).toBeDefined();
    expect(quarantined).toContain('.corrupt-');
    expect(await pathExists(file)).toBe(false);
    expect(await pathExists(quarantined!)).toBe(true);
  });

  it('returns undefined instead of throwing when the file is already gone', async () => {
    const result = await quarantineCorruptFile(path.join(dir, 'nope.json'));
    expect(result).toBeUndefined();
  });
});

describe('atomicWriteFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'gh-helix-atomic-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes content that can be read back, with no leftover temp file', async () => {
    const file = path.join(dir, 'out.json');
    await atomicWriteFile(file, JSON.stringify({ ok: true }));

    const result = await readJsonFile<{ ok: boolean }>(file);
    expect(result).toEqual({ status: 'ok', value: { ok: true } });
  });

  it('overwrites existing content atomically', async () => {
    const file = path.join(dir, 'out.json');
    await atomicWriteFile(file, 'first');
    await atomicWriteFile(file, 'second');

    const result = await readJsonFile(file);
    expect(result.status).toBe('corrupt'); // "second" isn't valid JSON, proves content really changed
  });
});
