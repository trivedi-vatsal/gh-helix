import { execa } from 'execa';

/** Result of a successfully or unsuccessfully executed CLI command. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Shape execa's thrown error takes at runtime; used defensively via `unknown`. */
interface ExecaLikeError {
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: unknown;
  message?: unknown;
}

function toStringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Error thrown when a wrapped CLI command exits with a non-zero code. */
export class CommandError extends Error {
  readonly command: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | undefined;

  constructor(command: string, cause: unknown) {
    const info = (cause ?? {}) as ExecaLikeError;
    const stderr = toStringField(info.stderr);
    const stdout = toStringField(info.stdout);
    const fallbackMessage = typeof info.message === 'string' ? info.message : '';
    super(
      `Command failed: ${command}${stderr ? `\n${stderr.trim()}` : fallbackMessage ? `\n${fallbackMessage}` : ''}`,
    );
    this.name = 'CommandError';
    this.command = command;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = typeof info.exitCode === 'number' ? info.exitCode : undefined;
  }
}

/** Options for {@link runCommand}. */
export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * Runs an external CLI command and returns its output.
 * Throws {@link CommandError} on non-zero exit so callers can catch a single error type.
 */
export async function runCommand(
  file: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  try {
    const result = await execa(file, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      reject: true,
      windowsHide: true,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
    };
  } catch (error) {
    const commandLabel = `${file} ${args.join(' ')}`;
    throw new CommandError(commandLabel, error);
  }
}

/** Runs a `gh` CLI command, targeting GH_HOST when GitHub Enterprise is configured. */
export async function runGh(
  args: string[],
  options: RunOptions & { ghHost?: string } = {},
): Promise<CommandResult> {
  const { ghHost, ...rest } = options;
  const env = ghHost ? { ...process.env, ...options.env, GH_HOST: ghHost } : options.env;
  return runCommand('gh', args, { ...rest, env });
}

/** Runs a `git` CLI command. */
export async function runGit(args: string[], options: RunOptions = {}): Promise<CommandResult> {
  return runCommand('git', args, options);
}
