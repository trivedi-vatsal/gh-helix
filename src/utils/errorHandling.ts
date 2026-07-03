import { logger } from '../logger/logger.js';
import { AuthenticationError, ConfigError, ExitCode } from './errors.js';

/**
 * Logs an error thrown by a command in a user-friendly way and returns the
 * process exit code that should be used, matching the "schedule-friendly"
 * exit code contract (distinct codes for config vs. auth vs. generic failure).
 */
export function handleCommandError(error: unknown): ExitCode {
  if (error instanceof ConfigError) {
    logger.error(error.message);
    return ExitCode.ConfigError;
  }
  if (error instanceof AuthenticationError) {
    logger.error(error.message);
    return ExitCode.AuthError;
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message);
  return ExitCode.FatalError;
}
