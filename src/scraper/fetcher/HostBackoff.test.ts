import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancellationError } from "../../pipeline/errors";
import { HostBackoff, MAX_THROTTLE_DELAY_MS, parseRetryAfter } from "./HostBackoff";

const PAGE_URL = "https://example.com/page";

/**
 * Tracks whether a wait has finished, so a test can step the clock and check
 * it without awaiting a promise that may never settle.
 */
function track(promise: Promise<void>) {
  const state = { settled: false, error: undefined as unknown };
  promise.then(
    () => {
      state.settled = true;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");

  it("reads delta-seconds", () => {
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter(" 0 ", now)).toBe(0);
  });

  it("reads an HTTP-date as the time until that date", () => {
    expect(parseRetryAfter("Sun, 25 Oct 2026 12:00:30 GMT", now)).toBe(30_000);
  });

  it("reads an HTTP-date in the past as no delay", () => {
    expect(parseRetryAfter("Sun, 25 Oct 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("ignores a missing or unreadable header", () => {
    for (const value of [undefined, "", "soon", "-5", "1.5", ["10"]]) {
      expect.soft(parseRetryAfter(value, now), String(value)).toBeUndefined();
    }
  });
});

describe("HostBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("lets a request to a host that was never throttled through at once", async () => {
    const wait = track(new HostBackoff().wait(PAGE_URL));

    await vi.advanceTimersByTimeAsync(0);

    expect(wait.settled).toBe(true);
  });

  it("holds every request to a throttled host until the pause ends", async () => {
    const backoff = new HostBackoff();
    backoff.throttle(PAGE_URL, 1000, 10_000);

    const sameHost = track(backoff.wait("https://example.com/other"));
    const otherHost = track(backoff.wait("https://example.org/page"));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(sameHost.settled).toBe(false);
    expect(otherHost.settled).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(sameHost.settled).toBe(true);
  });

  it("holds a waiting request for a pause extended while it waits", async () => {
    const backoff = new HostBackoff();
    backoff.throttle(PAGE_URL, 1000, 5_000);
    const wait = track(backoff.wait(PAGE_URL));

    await vi.advanceTimersByTimeAsync(4_000);
    backoff.throttle(PAGE_URL, 1000, 5_000);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(wait.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(wait.settled).toBe(true);
  });

  it("pauses for the Retry-After delay, capped at the maximum", () => {
    const backoff = new HostBackoff();

    expect(backoff.throttle("https://a.example/", 1000, 30_000)).toBe(30_000);
    expect(backoff.throttle("https://b.example/", 1000, 3_600_000)).toBe(
      MAX_THROTTLE_DELAY_MS,
    );
  });

  it("doubles the pause with each throttle in a row and jitters it down by up to half", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(1);
    const backoff = new HostBackoff();

    const pauses = [1, 2, 3].map(() => {
      const pause = backoff.throttle(PAGE_URL, 5_000);
      // Let the pause run out, so each throttle reports its own length.
      vi.advanceTimersByTime(pause);
      return pause;
    });
    random.mockReturnValue(0);
    const jittered = backoff.throttle(PAGE_URL, 5_000);

    expect(pauses).toEqual([5_000, 10_000, 20_000]);
    expect(jittered).toBe(20_000);
  });

  it("never pauses for longer than the maximum", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const backoff = new HostBackoff();

    let pause = 0;
    for (let strike = 0; strike < 40; strike++) {
      pause = backoff.throttle(PAGE_URL, 5_000);
      vi.advanceTimersByTime(pause);
    }

    expect(pause).toBe(MAX_THROTTLE_DELAY_MS);
  });

  it("starts over once a request sent after the last throttle is answered", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const backoff = new HostBackoff();
    vi.advanceTimersByTime(backoff.throttle(PAGE_URL, 5_000));
    vi.advanceTimersByTime(backoff.throttle(PAGE_URL, 5_000));

    backoff.recover(PAGE_URL, Date.now());

    expect(backoff.throttle(PAGE_URL, 5_000)).toBe(5_000);
  });

  it("keeps escalating when only a request sent before the throttle is answered", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const backoff = new HostBackoff();
    const inFlightSince = Date.now();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(backoff.throttle(PAGE_URL, 5_000));

    backoff.recover(PAGE_URL, inFlightSince);

    expect(backoff.throttle(PAGE_URL, 5_000)).toBe(10_000);
  });

  it("stops waiting with a CancellationError when the signal aborts", async () => {
    const backoff = new HostBackoff();
    backoff.throttle(PAGE_URL, 1000, 30_000);
    const controller = new AbortController();
    const wait = track(backoff.wait(PAGE_URL, controller.signal));

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(wait.settled).toBe(true);
    expect(wait.error).toBeInstanceOf(CancellationError);
  });
});
