/** Process exit codes used across every command so the CLI is safe to run from schedulers. */
export enum ExitCode {
  Success = 0,
  PartialFailure = 1,
  AuthError = 2,
  ConfigError = 3,
  FatalError = 4,
}

/** Raised when `.env` is missing required values or contains invalid ones. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Raised when `gh auth status` reports the user is not authenticated. */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
