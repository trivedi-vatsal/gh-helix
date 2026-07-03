import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { ConfigError } from '../utils/errors.js';
import { parsePositiveInt } from '../utils/number.js';
import type { AppConfig, FileConfig } from './types.js';

const DEFAULT_CONFIG_FILE_NAME = 'config.json';

/** Parses a boolean-ish value (`true`/`false`, `1`/`0`, case-insensitive) from env or JSON. */
function parseBoolean(value: string | boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new ConfigError(`Invalid boolean value "${value}". Use true or false.`);
}

function parseAuthMode(value: string | undefined): 'auto' | 'token' | 'gh' {
  if (!value) return 'auto';
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return 'auto';
  if (normalized === 'token') return 'token';
  if (normalized === 'gh') return 'gh';
  throw new ConfigError(`Invalid AUTH_MODE value "${value}". Use auto, token, or gh.`);
}

/** Reads and parses `config.json`. Returns an empty object if the file does not exist. */
function readFileConfig(configFilePath: string): FileConfig {
  if (!existsSync(configFilePath)) return {};
  try {
    return JSON.parse(readFileSync(configFilePath, 'utf8')) as FileConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to parse config file at "${configFilePath}": ${message}`);
  }
}

/**
 * Resolves a setting from, in priority order: the process environment (which
 * includes anything loaded from `.env`), then `config.json`, then undefined.
 */
function resolveString(envKey: keyof FileConfig, fileConfig: FileConfig): string | undefined {
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = fileConfig[envKey];
  return typeof fromFile === 'string' && fromFile.trim() ? fromFile.trim() : undefined;
}

/** Options for {@link loadConfig}. */
export interface LoadConfigOptions {
  /** Explicit path to a `.env` file. Defaults to `.env` in the current directory. */
  envFilePath?: string;
  /** Explicit path to a `config.json` file. Defaults to `config.json` in the current directory. */
  configFilePath?: string;
}

/**
 * Loads and validates configuration. Supports both `.env` and `config.json`;
 * when a setting is present in both, the environment (and therefore `.env`,
 * since dotenv never overrides variables already set) always wins.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  loadDotenv(options.envFilePath ? { path: options.envFilePath } : {});

  const configFilePath = path.resolve(options.configFilePath ?? DEFAULT_CONFIG_FILE_NAME);
  const fileConfig = readFileConfig(configFilePath);

  const githubOrg = resolveString('GITHUB_ORG', fileConfig);
  if (!githubOrg) {
    throw new ConfigError(
      'GITHUB_ORG is not set. Add GITHUB_ORG=<your-org> to your .env or config.json (see .env.example).',
    );
  }

  const rawBackupDirectory = resolveString('BACKUP_DIRECTORY', fileConfig);
  if (!rawBackupDirectory) {
    throw new ConfigError(
      'BACKUP_DIRECTORY is not set. Add BACKUP_DIRECTORY=<path> to your .env or config.json (see .env.example).',
    );
  }

  const backupDirectory = path.resolve(rawBackupDirectory);
  const maxParallel = parsePositiveInt(
    process.env['MAX_PARALLEL'] ?? fileConfig.MAX_PARALLEL,
    5,
    'MAX_PARALLEL',
  );
  const fetchLfs = parseBoolean(process.env['FETCH_LFS'] ?? fileConfig.FETCH_LFS, true);
  const checkoutCode = parseBoolean(process.env['CHECKOUT_CODE'] ?? fileConfig.CHECKOUT_CODE, true);
  const ghHost = resolveString('GH_HOST', fileConfig);
  const githubApiUrl = resolveString('GITHUB_API_URL', fileConfig);
  const authMode = parseAuthMode(resolveString('AUTH_MODE', fileConfig));

  return {
    githubOrg,
    backupDirectory,
    maxParallel,
    fetchLfs,
    checkoutCode,
    ghHost,
    githubApiUrl,
    authMode,
  };
}

/**
 * Resolves a GitHub token from `GITHUB_TOKEN`, then `GH_TOKEN`, checking the
 * process environment before `config.json`. Does not fall back to `gh auth token`
 * -- that is an async operation handled separately by the API client.
 */
export function resolveTokenHint(options: LoadConfigOptions = {}): string | undefined {
  const configFilePath = path.resolve(options.configFilePath ?? DEFAULT_CONFIG_FILE_NAME);
  const fileConfig = readFileConfig(configFilePath);
  return resolveString('GITHUB_TOKEN', fileConfig) ?? resolveString('GH_TOKEN', fileConfig);
}
