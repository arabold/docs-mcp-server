/**
 * Waits for an operation, rejecting if it takes longer than the given time.
 * The operation itself keeps running; only the wait is bounded.
 *
 * @param operation - The promise to wait for.
 * @param timeoutMs - How long to wait, in milliseconds.
 * @param description - Names the operation in the timeout error.
 * @returns The operation's result.
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${description} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
