export type Task<T> = () => Promise<T>;

/**
 * Bounded-concurrency runner. Returns a `run` function: call it with a task,
 * it queues the task if `maxConcurrent` are already in flight.
 */
export function createConcurrencyLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function release() {
    active--;
    const next = queue.shift();
    if (next) {
      active++;
      next();
    }
  }

  return function run<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const attempt = () => {
        task().then(resolve, reject).finally(release);
      };
      if (active < maxConcurrent) {
        active++;
        attempt();
      } else {
        queue.push(attempt);
      }
    });
  };
}

/** Full-jitter exponential backoff, capped at `maxMs`. */
export function backoffDelayMs(attempt: number, baseMs = 300, maxMs = 8000): number {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.random() * cap;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  retries: number;
  baseMs?: number;
  maxMs?: number;
}

/** Retries `task` with exponential backoff + jitter; rethrows the last error. */
export async function withRetry<T>(task: Task<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      if (attempt < options.retries) {
        await sleep(backoffDelayMs(attempt, options.baseMs, options.maxMs));
      }
    }
  }
  throw lastError;
}
