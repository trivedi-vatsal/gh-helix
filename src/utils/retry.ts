/** Options controlling {@link retry}'s backoff behavior. */
export interface RetryOptions {
  /** Maximum number of attempts, including the first. Default: 3. */
  retries?: number;
  /** Base delay in milliseconds before the first retry. Default: 500. */
  minTimeoutMs?: number;
  /** Multiplier applied to the delay after each failed attempt. Default: 2. */
  factor?: number;
  /** Called before each retry attempt with the error and attempt number. */
  onRetry?: (error: unknown, attempt: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an async operation with exponential backoff.
 * Useful for transient network failures during clone/fetch/update operations.
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, minTimeoutMs = 500, factor = 2, onRetry } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      onRetry?.(error, attempt);
      await sleep(minTimeoutMs * Math.pow(factor, attempt - 1));
    }
  }

  throw lastError;
}
