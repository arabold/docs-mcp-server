/**
 * Per-host pause for servers that ask the scraper to slow down.
 *
 * A crawl runs several requests at once. When one of them is throttled, the
 * others would go on requesting the same host at full speed, so a throttle
 * pauses the host rather than the one request that met it.
 */

import { CancellationError } from "../../pipeline/errors";

/**
 * The longest a host is paused for, whatever the server asks. A server asking
 * for an hour would otherwise park the crawl; capped, the request is retried
 * and fails if the server still refuses it.
 */
export const MAX_THROTTLE_DELAY_MS = 60_000;

/**
 * Caps the doubling. Beyond this the pause is at its maximum anyway, and the
 * cap keeps a base delay of zero from multiplying into NaN.
 */
const MAX_BACKOFF_EXPONENT = 16;

/** The pause state of one host. */
interface HostState {
  /** Epoch milliseconds before which no request is sent to the host. */
  resumeAt: number;
  /** Throttled responses since the host last answered a request normally. */
  strikes: number;
  /** Epoch milliseconds of the most recent throttled response. */
  throttledAt: number;
}

/**
 * Parses a `Retry-After` header into a delay.
 *
 * Accepts both forms RFC 9110 allows: delta-seconds (`120`) and an HTTP-date
 * (`Wed, 21 Oct 2015 07:28:00 GMT`). A date in the past means no delay.
 *
 * @param value The header value as the response carried it.
 * @param now The current time in epoch milliseconds.
 * @returns The delay in milliseconds, or undefined when the header is missing
 * or unreadable.
 */
export function parseRetryAfter(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  // Every HTTP-date form names the month. Without that check `Date.parse`
  // would read values such as "-5" or "1.5" as dates.
  const date = /[a-z]/i.test(trimmed) ? Date.parse(trimmed) : Number.NaN;
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/**
 * Pauses every request to a host after the host throttles one of them.
 *
 * Shared by the fetchers of one crawl, so all of its workers wait out the same
 * pause. The pause doubles with each throttled response in a row and resets
 * once the host answers a request sent after the last throttle.
 */
export class HostBackoff {
  private readonly hosts = new Map<string, HostState>();

  /**
   * Waits until requests to the host of `url` may resume.
   *
   * @param url The URL about to be requested.
   * @param signal Aborts the wait.
   * @throws {CancellationError} When the signal aborts.
   */
  async wait(url: string, signal?: AbortSignal): Promise<void> {
    const host = hostOf(url);
    // Re-read after each sleep: another request may have extended the pause.
    for (
      let state = this.hosts.get(host);
      state && state.resumeAt > Date.now();
      state = this.hosts.get(host)
    ) {
      await sleep(state.resumeAt - Date.now(), signal);
    }
  }

  /**
   * Records a throttled response and pauses its host.
   *
   * Without a `Retry-After`, the pause starts at `baseDelayMs` and doubles with
   * each throttle in a row, and is jittered down by up to half so the requests
   * of separate crawls do not retry in step.
   *
   * @param url The URL that was throttled.
   * @param baseDelayMs The pause after the first throttle, before jitter.
   * @param retryAfterMs The pause the server asked for, if it named one.
   * @returns How long the host is paused from now, in milliseconds.
   */
  throttle(url: string, baseDelayMs: number, retryAfterMs?: number): number {
    const host = hostOf(url);
    const now = Date.now();
    const state = this.hosts.get(host) ?? { resumeAt: 0, strikes: 0, throttledAt: 0 };
    state.strikes++;
    state.throttledAt = now;

    let delay: number;
    if (retryAfterMs !== undefined) {
      delay = Math.min(retryAfterMs, MAX_THROTTLE_DELAY_MS);
    } else {
      const exponent = Math.min(state.strikes - 1, MAX_BACKOFF_EXPONENT);
      const nominal = Math.min(baseDelayMs * 2 ** exponent, MAX_THROTTLE_DELAY_MS);
      delay = nominal / 2 + (Math.random() * nominal) / 2;
    }

    state.resumeAt = Math.max(state.resumeAt, now + Math.round(delay));
    this.hosts.set(host, state);
    return state.resumeAt - now;
  }

  /**
   * Records a normal answer from the host, which ends its backoff.
   *
   * Only a request sent after the last throttle counts: one that was already
   * in flight says nothing about whether the host has recovered.
   *
   * @param url The URL that was answered.
   * @param sentAt When the request was sent, in epoch milliseconds.
   */
  recover(url: string, sentAt: number): void {
    const host = hostOf(url);
    const state = this.hosts.get(host);
    if (state && sentAt > state.throttledAt) {
      this.hosts.delete(host);
    }
  }
}

/**
 * Returns the key a URL's pause is stored under.
 *
 * @param url An absolute URL.
 * @returns The URL's host, including any port.
 */
function hostOf(url: string): string {
  return new URL(url).host;
}

/**
 * Resolves after `ms` milliseconds, or rejects as soon as the signal aborts.
 *
 * @param ms The delay in milliseconds.
 * @param signal Aborts the delay.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancellationError("Wait for a throttled host cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
