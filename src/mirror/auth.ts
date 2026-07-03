/**
 * Environment vars that stop Git from ever falling back to an interactive
 * credential prompt -- terminal-based, or a GUI dialog via a platform
 * credential helper (e.g. Git Credential Manager on Windows). Without this,
 * a bad/expired/wrongly-formatted token doesn't just fail: Git treats the
 * resulting 401 as "go collect credentials the normal way" and pops a login
 * dialog nothing is present to click through in an unattended run -- and
 * since several repos are processed concurrently, every one of them queues
 * up behind its own invisible dialog, so the whole run appears to hang.
 * Applied unconditionally (even for the no-token SSH fallback) so an
 * unattended run never blocks on any kind of credential prompt.
 */
const NO_INTERACTIVE_PROMPT_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
};

/**
 * Builds an ephemeral environment override for a single Git invocation:
 * injects a PAT via `http.extraHeader` using Git's `GIT_CONFIG_COUNT`
 * mechanism (Git 2.31+), which keeps the token out of argv (visible to
 * `ps`/Task Manager) and out of the repo's persisted `.git/config`.
 *
 * GitHub's git-over-HTTPS endpoints only accept HTTP **Basic** auth --
 * `Authorization: Bearer <token>` / `Authorization: token <token>` are
 * silently rejected there (Bearer is only valid against `api.github.com`,
 * not the git smart-HTTP endpoints), so the token is sent as
 * `Basic base64(x-access-token:<token>)`, matching what GitHub's own tooling
 * (e.g. Actions' checkout) sends for scripted git access with a PAT.
 *
 * Also disables any configured `credential.helper` for the invocation, so
 * Git never tries one as a fallback if the header is somehow rejected.
 */
export function buildGitAuthEnv(token: string | undefined): NodeJS.ProcessEnv {
  if (!token) return { ...NO_INTERACTIVE_PROMPT_ENV };
  const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    ...NO_INTERACTIVE_PROMPT_ENV,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'http.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${encoded}`,
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
  };
}

/** Picks the clone URL to use: HTTPS when a token is available, SSH otherwise. */
export function selectCloneUrl(
  repo: { sshUrl: string; cloneUrl: string },
  token: string | undefined,
): string {
  return token ? repo.cloneUrl : repo.sshUrl;
}
