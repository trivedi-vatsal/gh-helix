import { Octokit } from '@octokit/rest';
import { resolveTokenHint } from '../config/config.js';
import type { LoadConfigOptions } from '../config/config.js';
import { AuthenticationError } from '../utils/errors.js';
import { runGh } from '../utils/exec.js';

export type AuthMode = 'auto' | 'token' | 'gh';

export function parseAuthMode(value: string | undefined): AuthMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'auto') return 'auto';
  if (normalized === 'token') return 'token';
  if (normalized === 'gh') return 'gh';
  throw new AuthenticationError(`Invalid auth mode "${value}". Use one of: auto, token, gh.`);
}

async function resolveGhToken(ghHost?: string): Promise<string | undefined> {
  try {
    const result = await runGh(['auth', 'token'], { ghHost });
    const token = result.stdout.trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves a GitHub token using the documented priority order:
 * 1. `GITHUB_TOKEN` (env, then `.env`, then `config.json`)
 * 2. `GH_TOKEN` (env, then `.env`, then `config.json`)
 * 3. `gh auth token` (only if neither of the above is set)
 */
export async function resolveToken(
  configOptions: LoadConfigOptions = {},
  ghHost?: string,
  mode: AuthMode = 'auto',
): Promise<string> {
  if (mode !== 'gh') {
    const hint = resolveTokenHint(configOptions);
    if (hint) return hint;
  }

  if (mode !== 'token') {
    const token = await resolveGhToken(ghHost);
    if (token) return token;
  }

  if (mode === 'gh') {
    throw new AuthenticationError(
      'No GitHub CLI token found. Run "gh auth login" and retry, or use --auth token with GITHUB_TOKEN/GH_TOKEN.',
    );
  }

  if (mode === 'token') {
    throw new AuthenticationError(
      'No GitHub token found in GITHUB_TOKEN/GH_TOKEN (env, .env, or config.json).',
    );
  }

  throw new AuthenticationError(
    'No GitHub token found. Set GITHUB_TOKEN or GH_TOKEN (env, .env, or config.json), ' +
      'or authenticate with "gh auth login" so "gh auth token" can be used as a fallback.',
  );
}

/** No-op logger passed to Octokit: its bundled request-log plugin otherwise writes
 * raw "METHOD URL - STATUS" lines straight to the console, bypassing our own logger. */
const silentLog = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * Creates an authenticated Octokit REST client. `githubApiUrl` targets GitHub
 * Enterprise Server (e.g. https://github.company.com/api/v3); when unset, Octokit's
 * own default (https://api.github.com) is used -- never hardcoded here.
 */
export function createClient(token: string, githubApiUrl?: string): Octokit {
  return new Octokit({
    auth: token,
    ...(githubApiUrl ? { baseUrl: githubApiUrl } : {}),
    log: silentLog,
  });
}

/**
 * Verifies the token can authenticate and has access to the configured organization.
 * Used as the up-front auth check for commands that operate on a specific org.
 */
export async function verifyApiAccess(client: Octokit, org: string): Promise<void> {
  try {
    await client.rest.orgs.get({ org });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AuthenticationError(
      `Could not authenticate to GitHub or access organization "${org}".\n${message}`,
    );
  }
}

/** Result of a lightweight API connectivity probe, used by the `health` command. */
export interface ApiConnectivityResult {
  ok: boolean;
  message: string;
}

/** Checks basic API reachability/auth without requiring access to any specific organization. */
export async function checkApiConnectivity(client: Octokit): Promise<ApiConnectivityResult> {
  try {
    const response = await client.rest.rateLimit.get();
    const remaining = response.data.rate.remaining;
    const limit = response.data.rate.limit;
    return { ok: true, message: `Connected (rate limit: ${remaining}/${limit})` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
}
