import { appendFile } from 'node:fs/promises';
import pc from 'picocolors';

/** Symbols used to prefix log lines, matching the style requested for CLI output. */
const SYMBOLS = {
  success: '✓', // ✓
  warn: '⚠', // ⚠
  error: '✗', // ✗
  info: 'ℹ', // ℹ
} as const;

/**
 * Colored console logger with optional plain-text mirroring to a log file.
 * File output strips ANSI colors so log files stay readable in any viewer.
 */
export class Logger {
  private logFilePath: string | undefined;
  private pending: Promise<void> = Promise.resolve();

  /** Enables mirroring every logged line to the given file (created/appended to). */
  setLogFile(filePath: string | undefined): void {
    this.logFilePath = filePath;
  }

  success(message: string): void {
    this.emit(pc.green(`${SYMBOLS.success} ${message}`), `[OK] ${message}`);
  }

  warn(message: string): void {
    this.emit(pc.yellow(`${SYMBOLS.warn} ${message}`), `[WARN] ${message}`);
  }

  error(message: string): void {
    this.emit(pc.red(`${SYMBOLS.error} ${message}`), `[ERROR] ${message}`);
  }

  info(message: string): void {
    this.emit(pc.cyan(`${SYMBOLS.info} ${message}`), `[INFO] ${message}`);
  }

  plain(message: string): void {
    this.emit(message, message);
  }

  heading(message: string): void {
    this.emit(pc.bold(pc.underline(message)), `== ${message} ==`);
  }

  private emit(consoleLine: string, fileLine: string): void {
    console.log(consoleLine);
    if (this.logFilePath) {
      const target = this.logFilePath;
      const line = `${new Date().toISOString()} ${fileLine}\n`;
      this.pending = this.pending.then(() =>
        appendFile(target, line, 'utf8').catch(() => {
          /* logging failures must never crash the CLI */
        }),
      );
    }
  }

  /** Resolves once every queued log-file write has completed. Call before process exit. */
  async flush(): Promise<void> {
    await this.pending;
  }
}

/** Shared logger instance used across the CLI. */
export const logger = new Logger();
