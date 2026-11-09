import { vol } from "memfs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";
import type { AppConfig } from "./config";
import { defaults as configDefaults } from "./config";
import { AccessPolicyError } from "./errors";

vi.mock("node:fs/promises", () => ({ default: vol.promises }));

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: Parameters<typeof lookupMock>) => lookupMock(...args),
}));

import os from "node:os";
import { expandConfiguredRoot, ScraperAccessPolicy } from "./accessPolicy";
import { logger } from "./logger";

type SecurityOverrides = {
  network?: Partial<AppConfig["scraper"]["security"]["network"]>;
  fileAccess?: Partial<AppConfig["scraper"]["security"]["fileAccess"]>;
};

function createSecurityConfig(
  overrides: SecurityOverrides = {},
): AppConfig["scraper"]["security"] {
  const baseline = configDefaults.scraper.security;
  return {
    ...baseline,
    ...overrides,
    network: {
      ...baseline.network,
      ...overrides.network,
    },
    fileAccess: {
      ...baseline.fileAccess,
      ...overrides.fileAccess,
    },
  };
}

/** One network request checked against a policy built from `network`. */
type NetworkCase = {
  label: string;
  network?: SecurityOverrides["network"];
  url: string;
  /** The addresses DNS returns for the URL's hostname, if it is looked up. */
  resolvesTo?: string[];
  allowed: boolean;
};

/** Checks each case on a fresh policy, reporting every row that fails. */
async function expectNetworkDecisions(cases: NetworkCase[]): Promise<void> {
  for (const { label, network, url, resolvesTo, allowed } of cases) {
    lookupMock.mockReset();
    if (resolvesTo) {
      lookupMock.mockResolvedValue(resolvesTo.map((address) => ({ address, family: 4 })));
    }
    const policy = new ScraperAccessPolicy(createSecurityConfig({ network }));
    // Settled to a value, so a failing row is reported under its label.
    const outcome = await policy.assertNetworkUrlAllowed(url).then(
      () => "allowed",
      (error) => (error instanceof AccessPolicyError ? "blocked" : String(error)),
    );

    expect.soft(outcome, label).toBe(allowed ? "allowed" : "blocked");
  }
}

describe("ScraperAccessPolicy", () => {
  beforeEach(() => {
    vol.reset();
    lookupMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks loopback targets by default", async () => {
    await expectNetworkDecisions([
      { label: "IPv4 loopback", url: "http://127.0.0.1/test", allowed: false },
      { label: "bracketed IPv6 loopback", url: "http://[::1]/test", allowed: false },
    ]);
  });

  it("allows private targets that the open-mode allowlists name", async () => {
    await expectNetworkDecisions([
      {
        label: "allowlisted private hostname",
        network: { allowedHosts: ["docs.internal.example"] },
        url: "https://docs.internal.example/guide",
        resolvesTo: ["10.42.0.10"],
        allowed: true,
      },
      {
        // A host allowlist is bound to the hostname, not to the address it resolves to.
        label: "the IP behind an allowlisted hostname",
        network: { allowedHosts: ["docs.internal.example"] },
        url: "https://10.42.0.10/guide",
        allowed: false,
      },
      {
        label: "hostname resolving into an allowlisted CIDR",
        network: { allowedCidrs: ["10.42.0.0/16"] },
        url: "https://wiki.internal.example/guide",
        resolvesTo: ["10.42.0.10"],
        allowed: true,
      },
      {
        label: "glob pattern, one subdomain level",
        network: { allowedHosts: ["*.internal.example"] },
        url: "https://docs.internal.example/guide",
        resolvesTo: ["10.42.0.10"],
        allowed: true,
      },
      {
        label: "glob pattern, two subdomain levels",
        network: { allowedHosts: ["*.internal.example"] },
        url: "https://wiki.team.internal.example/page",
        resolvesTo: ["10.42.0.10"],
        allowed: true,
      },
      {
        // A leading wildcard does not match the bare apex.
        label: "glob pattern, bare apex",
        network: { allowedHosts: ["*.internal.example"] },
        url: "https://internal.example/",
        resolvesTo: ["10.42.0.10"],
        allowed: false,
      },
      {
        label: "regex pattern",
        network: { allowedHosts: ["/^docs\\d+\\.example\\.com$/"] },
        url: "https://docs42.example.com/path",
        resolvesTo: ["10.0.0.5"],
        allowed: true,
      },
    ]);
  });

  it("enables invalid TLS only for already-allowed https targets", () => {
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        network: {
          allowInvalidTls: true,
        },
      }),
    );

    expect(policy.shouldAllowInvalidTls("https://docs.internal.example")).toBe(true);
    expect(policy.shouldAllowInvalidTls("http://docs.internal.example")).toBe(false);
  });

  it("blocks hidden local paths by default", async () => {
    vol.fromJSON({
      "/docs/.hidden/file.md": "secret",
    });

    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: {
          mode: "unrestricted",
        },
      }),
    );

    await expect(
      policy.resolveFileAccess("file:///docs/.hidden/file.md"),
    ).rejects.toBeInstanceOf(AccessPolicyError);
  });

  it("permits access under an allowed root whose path contains a hidden ancestor", async () => {
    // Configuring `/srv/.config/docs` as an allowed root is an explicit opt-in,
    // so files inside that root must not be self-rejected by the hidden-segment
    // check just because `.config` appears in the root's absolute path.
    vol.fromJSON({
      "/srv/.config/docs/guide.md": "content",
    });

    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: {
          mode: "allowedRoots",
          allowedRoots: ["/srv/.config/docs"],
        },
      }),
    );

    const resolved = await policy.resolveFileAccess("file:///srv/.config/docs/guide.md");
    expect(resolved.accessPath).toBe("/srv/.config/docs/guide.md");
  });

  it("still blocks hidden segments below the allowed root and states the rule", async () => {
    vol.fromJSON({
      "/srv/.config/docs/.git/HEAD": "ref",
    });

    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: {
          mode: "allowedRoots",
          allowedRoots: ["/srv/.config/docs"],
        },
      }),
    );

    const attempt = policy.resolveFileAccess("file:///srv/.config/docs/.git/HEAD");
    await expect(attempt).rejects.toBeInstanceOf(AccessPolicyError);
    await expect(attempt).rejects.toThrow(/hidden path segment.*configuration\.md/s);
  });

  it("blocks symlink access by default and states the rule", async () => {
    vol.fromJSON({
      "/docs/real.md": "content",
    });
    await vol.promises.symlink("/docs/real.md", "/docs/link.md");

    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: {
          mode: "unrestricted",
        },
      }),
    );

    const attempt = policy.resolveFileAccess("file:///docs/link.md");
    await expect(attempt).rejects.toBeInstanceOf(AccessPolicyError);
    await expect(attempt).rejects.toThrow(
      /resolves through a symlink.*configuration\.md/s,
    );
  });

  it("blocks symlinked parent directories by default", async () => {
    vol.fromJSON({
      "/outside/secret.md": "secret",
    });
    await vol.promises.mkdir("/docs", { recursive: true });
    await vol.promises.symlink("/outside", "/docs/link");

    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: {
          mode: "allowedRoots",
          allowedRoots: ["/docs"],
        },
      }),
    );

    await expect(
      policy.resolveFileAccess("file:///docs/link/secret.md"),
    ).rejects.toBeInstanceOf(AccessPolicyError);
  });

  it("validates archive members against the backing archive path", async () => {
    vol.fromJSON({
      "/allowed/docs.zip": "archive-bytes",
    });

    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: {
          mode: "allowedRoots",
          allowedRoots: ["/allowed"],
        },
      }),
    );

    const resolved = await policy.resolveFileAccess(
      "file:///allowed/docs.zip/guide/intro.md",
    );

    expect(resolved.accessPath).toBe("/allowed/docs.zip");
    expect(resolved.virtualArchivePath).toBe("guide/intro.md");
  });

  it("permits only allowlisted targets in allowlist mode", async () => {
    await expectNetworkDecisions([
      // Real public IPs rather than special-use sentinels, so the
      // post-resolution rebinding check (which runs even for allowlisted
      // hostnames) does not reject the request on its own.
      {
        label: "allowlisted hostname",
        network: {
          mode: "allowlist",
          allowedHosts: ["docs.python.org", "*.rust-lang.org"],
        },
        url: "https://docs.python.org/3/",
        resolvesTo: ["8.8.8.8"],
        allowed: true,
      },
      {
        label: "hostname matching an allowlisted glob",
        network: {
          mode: "allowlist",
          allowedHosts: ["docs.python.org", "*.rust-lang.org"],
        },
        url: "https://docs.rust-lang.org/std/",
        resolvesTo: ["8.8.8.8"],
        allowed: true,
      },
      {
        label: "hostname not on the allowlist",
        network: {
          mode: "allowlist",
          allowedHosts: ["docs.python.org", "*.rust-lang.org"],
        },
        url: "https://news.ycombinator.com/",
        resolvesTo: ["8.8.8.8"],
        allowed: false,
      },
      {
        label: "direct IP inside an allowed CIDR",
        network: { mode: "allowlist", allowedCidrs: ["10.42.0.0/16"] },
        url: "https://10.42.7.1/",
        allowed: true,
      },
      {
        label: "direct IP outside the allowed CIDRs",
        network: { mode: "allowlist", allowedCidrs: ["10.42.0.0/16"] },
        url: "https://10.99.0.1/",
        allowed: false,
      },
      {
        label: "both lists empty",
        network: { mode: "allowlist" },
        url: "https://example.com/",
        allowed: false,
      },
      {
        label: "allowPrivateNetworks is ignored",
        network: { mode: "allowlist", allowPrivateNetworks: true },
        url: "https://10.0.0.1/",
        allowed: false,
      },
      {
        // `allowedHosts` is authoritative for the named host: adding a hostname
        // is an explicit trust decision in that name and its DNS answers, so we
        // do not also require the resolved IP to be in `allowedCidrs`. This
        // matches `open` mode behavior and lets operators add a single internal
        // hostname without also pinning its subnet.
        label: "allowlisted hostname resolving to a private IP",
        network: { mode: "allowlist", allowedHosts: ["docs.internal.example"] },
        url: "https://docs.internal.example/",
        resolvesTo: ["10.42.0.5"],
        allowed: true,
      },
      {
        label: "allowlisted hostname resolving into allowedCidrs",
        network: {
          mode: "allowlist",
          allowedHosts: ["docs.internal.example"],
          allowedCidrs: ["10.42.0.0/16"],
        },
        url: "https://docs.internal.example/",
        resolvesTo: ["10.42.0.5"],
        allowed: true,
      },
      {
        // DNS rebinding: a CIDR-authorized hostname must have every resolved
        // address inside allowedCidrs.
        label: "CIDR-authorized hostname with one address outside allowedCidrs",
        network: { mode: "allowlist", allowedCidrs: ["10.42.0.0/16"] },
        url: "https://wiki.internal.example/",
        resolvesTo: ["10.42.0.5", "10.99.0.5"],
        allowed: false,
      },
    ]);
  });

  it("never lets allowInvalidTls bypass the network rules", async () => {
    await expectNetworkDecisions([
      {
        label: "private hostname in open mode",
        network: { allowInvalidTls: true },
        url: "https://docs.internal.example/",
        resolvesTo: ["10.42.0.10"],
        allowed: false,
      },
      {
        label: "host not on the allowlist in allowlist mode",
        network: {
          mode: "allowlist",
          allowedHosts: ["docs.python.org"],
          allowInvalidTls: true,
        },
        url: "https://example.com/",
        allowed: false,
      },
    ]);
  });
});

describe("temp-archive bypass scoping", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("permits a downloaded archive temp file when its dir is supplied as a bypass root", async () => {
    vol.fromJSON({ "/tmp/dl/docs.zip": "archive-bytes" });
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: { mode: "allowedRoots", allowedRoots: ["/docs"] },
      }),
    );

    const resolved = await policy.resolveFileAccess(
      "file:///tmp/dl/docs.zip/guide/intro.md",
      ["/tmp/dl"],
    );

    expect(resolved.accessPath).toBe("/tmp/dl/docs.zip");
    expect(resolved.virtualArchivePath).toBe("guide/intro.md");
  });

  it("rejects unrelated temp files even when a temp bypass root is configured for an archive", async () => {
    vol.fromJSON({
      "/tmp/dl/docs.zip": "archive-bytes",
      "/tmp/other/secret.md": "secret",
    });
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: { mode: "allowedRoots", allowedRoots: ["/docs"] },
      }),
    );

    await expect(
      policy.resolveFileAccess("file:///tmp/other/secret.md", ["/tmp/dl"]),
    ).rejects.toBeInstanceOf(AccessPolicyError);
  });

  it("rejects archive virtual members whose entry path crosses into a hidden segment", async () => {
    vol.fromJSON({ "/tmp/dl/docs.zip": "archive-bytes" });
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: { mode: "allowedRoots", allowedRoots: ["/docs"] },
      }),
    );

    await expect(
      policy.resolveFileAccess("file:///tmp/dl/docs.zip/.hidden/notes.md", ["/tmp/dl"]),
    ).rejects.toBeInstanceOf(AccessPolicyError);
  });
});

describe("file access diagnostics", () => {
  // `test/setup-env.ts` auto-mocks the logger, so `logger.warn` is a single
  // shared mock whose call history outlives each test. Re-resolve and clear it
  // per test rather than spying: caching the reference or layering a spy makes
  // assertions depend on which mock instance the property currently holds.
  let warn: MockedFunction<typeof logger.warn>;

  beforeEach(() => {
    vol.reset();
    warn = vi.mocked(logger.warn);
    warn.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the unresolved root token and points at the docs", async () => {
    // The token goes in the error itself, not just a log line: WARN output is
    // suppressed on non-TTY runs (containers, MCP stdio), which is exactly
    // where an unresolvable $DOCUMENTS default bites. It is runtime state, not
    // a config key, so no rename can invalidate it.
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");
    vol.fromJSON({ "/srv/docs/readme.md": "hello" });
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: { mode: "allowedRoots", allowedRoots: ["$DOCUMENTS"] },
      }),
    );

    await expect(policy.resolveFileAccess("file:///srv/docs/readme.md")).rejects.toThrow(
      /\$DOCUMENTS did not resolve.*configuration\.md/s,
    );
  });

  it("never echoes a configured literal path, only tokens", async () => {
    // Literal roots always expand (`path.resolve`), so a mixed config keeps the
    // allowlist non-empty and the rejection is out-of-root. Either way the
    // configured path must not travel back to an MCP or web caller.
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");
    vol.fromJSON({ "/srv/docs/readme.md": "hello" });
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: {
          mode: "allowedRoots",
          allowedRoots: ["$DOCUMENTS", "/mnt/acme-secrets/docs"],
        },
      }),
    );

    await expect(
      policy.resolveFileAccess("file:///srv/docs/readme.md"),
    ).rejects.not.toThrow(/acme-secrets/);
  });

  it("reports an empty allowlist distinctly from unresolvable entries", async () => {
    vol.fromJSON({ "/srv/docs/readme.md": "hello" });
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: { mode: "allowedRoots", allowedRoots: [] },
      }),
    );

    await expect(policy.resolveFileAccess("file:///srv/docs/readme.md")).rejects.toThrow(
      /no roots are configured/,
    );
  });

  it("warns once per unresolvable root and that all local file access is blocked", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: { mode: "allowedRoots", allowedRoots: ["$DOCUMENTS", "$DOWNLOADS"] },
      }),
    );

    await expect(
      policy.resolveFileAccess("file:///srv/docs/readme.md"),
    ).rejects.toBeInstanceOf(AccessPolicyError);
    await expect(
      policy.resolveFileAccess("file:///srv/docs/other.md"),
    ).rejects.toBeInstanceOf(AccessPolicyError);

    const messages = warn.mock.calls.map(([message]) => message);
    const unresolvedWarnings = messages.filter((message) =>
      message.includes("Ignoring allowed file root"),
    );
    expect(unresolvedWarnings).toHaveLength(2);
    expect(unresolvedWarnings.join("\n")).toContain("$DOCUMENTS");
    expect(unresolvedWarnings.join("\n")).toContain("$DOWNLOADS");
    expect(
      messages.some((message) => message.includes("all file:// indexing is blocked")),
    ).toBe(true);
  });

  it("keeps allowed root paths out of the out-of-root error but logs them", async () => {
    vol.fromJSON({
      "/srv/allowed/readme.md": "hello",
      "/srv/other/secret.md": "secret",
    });
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: { mode: "allowedRoots", allowedRoots: ["/srv/allowed"] },
      }),
    );

    await expect(policy.resolveFileAccess("file:///srv/other/secret.md")).rejects.toThrow(
      /outside the configured allowed roots/,
    );
    await expect(
      policy.resolveFileAccess("file:///srv/other/secret.md"),
    ).rejects.not.toThrow(/\/srv\/allowed/);
    expect(warn.mock.calls.some(([message]) => message.includes("/srv/allowed"))).toBe(
      true,
    );
  });

  it("states the rule when file access is disabled", async () => {
    vol.fromJSON({ "/srv/docs/readme.md": "hello" });
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({ fileAccess: { mode: "disabled" } }),
    );

    await expect(policy.resolveFileAccess("file:///srv/docs/readme.md")).rejects.toThrow(
      /disabled by the scraper security policy.*configuration\.md/s,
    );
  });

  it("does not warn about internal bypass roots that do not resolve", async () => {
    vol.fromJSON({ "/srv/allowed/readme.md": "hello" });
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        fileAccess: { mode: "allowedRoots", allowedRoots: ["/srv/allowed"] },
      }),
    );

    await expect(
      policy.resolveFileAccess("file:///srv/allowed/readme.md", ["$DOWNLOADS"]),
    ).resolves.toMatchObject({ filePath: "/srv/allowed/readme.md" });
    expect(warn.mock.calls.some(([message]) => message.includes("$DOWNLOADS"))).toBe(
      false,
    );
  });
});

describe("expandConfiguredRoot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vol.reset();
  });

  it("expands a root token to its directory, or to null when that cannot resolve", async () => {
    const homedir = vi.spyOn(os, "homedir");
    const cases: Array<{
      token: string;
      home: string;
      files?: Record<string, string>;
      expected: string | null;
    }> = [
      { token: "$DOCUMENTS", home: "/missing-home", expected: null },
      {
        token: "$DOCUMENTS",
        home: "/home/tester",
        files: { "/home/tester/Documents/readme.md": "hello" },
        expected: "/home/tester/Documents",
      },
      // $HOME does not need to exist on the mock file system.
      { token: "$HOME", home: "/home/tester", expected: "/home/tester" },
      { token: "$HOME", home: "", expected: null },
      {
        token: "$DOWNLOADS",
        home: "/home/tester",
        files: { "/home/tester/Downloads/x.txt": "" },
        expected: "/home/tester/Downloads",
      },
      {
        token: "$DESKTOP",
        home: "/home/tester",
        files: { "/home/tester/Desktop/x.txt": "" },
        expected: "/home/tester/Desktop",
      },
      { token: "$DOWNLOADS", home: "/home/tester", expected: null },
      { token: "$CWD", home: "/home/tester", expected: process.cwd() },
    ];

    for (const { token, home, files = {}, expected } of cases) {
      vol.reset();
      vol.fromJSON(files);
      homedir.mockReturnValue(home);
      expect
        .soft(await expandConfiguredRoot(token), `${token} with home "${home}"`)
        .toBe(expected);
    }
  });
});
