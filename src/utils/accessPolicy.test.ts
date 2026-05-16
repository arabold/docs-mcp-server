import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("ScraperAccessPolicy", () => {
  beforeEach(() => {
    vol.reset();
    lookupMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks loopback targets by default", async () => {
    const policy = new ScraperAccessPolicy(createSecurityConfig());

    await expect(
      policy.assertNetworkUrlAllowed("http://127.0.0.1/test"),
    ).rejects.toBeInstanceOf(AccessPolicyError);
  });

  it("blocks bracketed IPv6 loopback targets by default", async () => {
    const policy = new ScraperAccessPolicy(createSecurityConfig());

    await expect(
      policy.assertNetworkUrlAllowed("http://[::1]/test"),
    ).rejects.toBeInstanceOf(AccessPolicyError);
  });

  it("allows explicitly allowlisted private hostname targets", async () => {
    lookupMock.mockResolvedValue([{ address: "10.42.0.10", family: 4 }]);
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        network: {
          allowedHosts: ["docs.internal.example"],
        },
      }),
    );

    await expect(
      policy.assertNetworkUrlAllowed("https://docs.internal.example/guide"),
    ).resolves.toBeUndefined();
  });

  it("keeps host allowlists hostname-bound", async () => {
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        network: {
          allowedHosts: ["docs.internal.example"],
        },
      }),
    );

    await expect(
      policy.assertNetworkUrlAllowed("https://10.42.0.10/guide"),
    ).rejects.toBeInstanceOf(AccessPolicyError);
  });

  it("allows explicitly allowlisted CIDR targets", async () => {
    lookupMock.mockResolvedValue([{ address: "10.42.0.10", family: 4 }]);
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        network: {
          allowedCidrs: ["10.42.0.0/16"],
        },
      }),
    );

    await expect(
      policy.assertNetworkUrlAllowed("https://wiki.internal.example/guide"),
    ).resolves.toBeUndefined();
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

  it("still blocks hidden segments below the allowed root", async () => {
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

    await expect(
      policy.resolveFileAccess("file:///srv/.config/docs/.git/HEAD"),
    ).rejects.toBeInstanceOf(AccessPolicyError);
  });

  it("blocks symlink access by default", async () => {
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

    await expect(policy.resolveFileAccess("file:///docs/link.md")).rejects.toBeInstanceOf(
      AccessPolicyError,
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

  it("matches host allowlist entries by glob across subdomains", async () => {
    lookupMock.mockResolvedValue([{ address: "10.42.0.10", family: 4 }]);
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        network: {
          allowedHosts: ["*.internal.example"],
        },
      }),
    );

    await expect(
      policy.assertNetworkUrlAllowed("https://docs.internal.example/guide"),
    ).resolves.toBeUndefined();
    await expect(
      policy.assertNetworkUrlAllowed("https://wiki.team.internal.example/page"),
    ).resolves.toBeUndefined();
  });

  it("does not match the bare apex against a leading-wildcard host pattern", async () => {
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        network: {
          allowedHosts: ["*.internal.example"],
        },
      }),
    );

    lookupMock.mockResolvedValue([{ address: "10.42.0.10", family: 4 }]);
    await expect(
      policy.assertNetworkUrlAllowed("https://internal.example/"),
    ).rejects.toBeInstanceOf(AccessPolicyError);
  });

  it("supports regex host allowlist entries", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const policy = new ScraperAccessPolicy(
      createSecurityConfig({
        network: {
          allowedHosts: ["/^docs\\d+\\.example\\.com$/"],
        },
      }),
    );

    await expect(
      policy.assertNetworkUrlAllowed("https://docs42.example.com/path"),
    ).resolves.toBeUndefined();
  });

  describe("allowlist mode", () => {
    it("permits only hostnames that match the allowlist", async () => {
      // Use a real public IP rather than a special-use sentinel so the
      // post-resolution rebinding check (which now runs even for allowlisted
      // hostnames) doesn't reject the request on its own.
      lookupMock.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
      const policy = new ScraperAccessPolicy(
        createSecurityConfig({
          network: {
            mode: "allowlist",
            allowedHosts: ["docs.python.org", "*.rust-lang.org"],
          },
        }),
      );

      await expect(
        policy.assertNetworkUrlAllowed("https://docs.python.org/3/"),
      ).resolves.toBeUndefined();
      await expect(
        policy.assertNetworkUrlAllowed("https://docs.rust-lang.org/std/"),
      ).resolves.toBeUndefined();
      await expect(
        policy.assertNetworkUrlAllowed("https://news.ycombinator.com/"),
      ).rejects.toBeInstanceOf(AccessPolicyError);
    });

    it("permits direct IP targets only when inside an allowed CIDR", async () => {
      const policy = new ScraperAccessPolicy(
        createSecurityConfig({
          network: {
            mode: "allowlist",
            allowedCidrs: ["10.42.0.0/16"],
          },
        }),
      );

      await expect(
        policy.assertNetworkUrlAllowed("https://10.42.7.1/"),
      ).resolves.toBeUndefined();
      await expect(
        policy.assertNetworkUrlAllowed("https://10.99.0.1/"),
      ).rejects.toBeInstanceOf(AccessPolicyError);
    });

    it("denies everything when both lists are empty", async () => {
      const policy = new ScraperAccessPolicy(
        createSecurityConfig({
          network: { mode: "allowlist" },
        }),
      );

      await expect(
        policy.assertNetworkUrlAllowed("https://example.com/"),
      ).rejects.toBeInstanceOf(AccessPolicyError);
    });

    it("ignores allowPrivateNetworks in allowlist mode", async () => {
      const policy = new ScraperAccessPolicy(
        createSecurityConfig({
          network: {
            mode: "allowlist",
            allowPrivateNetworks: true,
          },
        }),
      );

      await expect(
        policy.assertNetworkUrlAllowed("https://10.0.0.1/"),
      ).rejects.toBeInstanceOf(AccessPolicyError);
    });

    it("trusts an allowlisted hostname even when DNS resolves it to a private IP", async () => {
      // `allowedHosts` is authoritative for the named host: adding a hostname
      // is an explicit trust decision in that name and its DNS answers, so we
      // do not also require the resolved IP to be in `allowedCidrs`. This
      // matches `open` mode behavior and lets operators add a single internal
      // hostname without also pinning its subnet.
      lookupMock.mockResolvedValue([{ address: "10.42.0.5", family: 4 }]);
      const policy = new ScraperAccessPolicy(
        createSecurityConfig({
          network: {
            mode: "allowlist",
            allowedHosts: ["docs.internal.example"],
          },
        }),
      );

      await expect(
        policy.assertNetworkUrlAllowed("https://docs.internal.example/"),
      ).resolves.toBeUndefined();
    });

    it("permits an allowlisted hostname when its resolved IP is covered by allowedCidrs", async () => {
      lookupMock.mockResolvedValue([{ address: "10.42.0.5", family: 4 }]);
      const policy = new ScraperAccessPolicy(
        createSecurityConfig({
          network: {
            mode: "allowlist",
            allowedHosts: ["docs.internal.example"],
            allowedCidrs: ["10.42.0.0/16"],
          },
        }),
      );

      await expect(
        policy.assertNetworkUrlAllowed("https://docs.internal.example/"),
      ).resolves.toBeUndefined();
    });

    it("rejects CIDR-authorized hostnames when any resolved address falls outside allowedCidrs", async () => {
      lookupMock.mockResolvedValue([
        { address: "10.42.0.5", family: 4 },
        { address: "10.99.0.5", family: 4 },
      ]);
      const policy = new ScraperAccessPolicy(
        createSecurityConfig({
          network: {
            mode: "allowlist",
            allowedCidrs: ["10.42.0.0/16"],
          },
        }),
      );

      await expect(
        policy.assertNetworkUrlAllowed("https://wiki.internal.example/"),
      ).rejects.toBeInstanceOf(AccessPolicyError);
    });
  });

  describe("invalid-TLS does not bypass network allowlists", () => {
    it("rejects a private hostname even when allowInvalidTls is true", async () => {
      lookupMock.mockResolvedValue([{ address: "10.42.0.10", family: 4 }]);
      const policy = new ScraperAccessPolicy(
        createSecurityConfig({
          network: { allowInvalidTls: true },
        }),
      );

      await expect(
        policy.assertNetworkUrlAllowed("https://docs.internal.example/"),
      ).rejects.toBeInstanceOf(AccessPolicyError);
    });

    it("rejects a non-allowlisted host in allowlist mode even when allowInvalidTls is true", async () => {
      const policy = new ScraperAccessPolicy(
        createSecurityConfig({
          network: {
            mode: "allowlist",
            allowedHosts: ["docs.python.org"],
            allowInvalidTls: true,
          },
        }),
      );

      await expect(
        policy.assertNetworkUrlAllowed("https://example.com/"),
      ).rejects.toBeInstanceOf(AccessPolicyError);
    });
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

describe("expandConfiguredRoot", () => {
  const realCwd = process.cwd();

  afterEach(() => {
    vi.restoreAllMocks();
    vol.reset();
  });

  it("returns null when $DOCUMENTS cannot be resolved", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/missing-home");
    const result = await expandConfiguredRoot("$DOCUMENTS");
    expect(result).toBeNull();
  });

  it("resolves $DOCUMENTS when the directory exists", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");
    vol.fromJSON({
      "/home/tester/Documents/readme.md": "hello",
    });

    const result = await expandConfiguredRoot("$DOCUMENTS");
    expect(result).toBe("/home/tester/Documents");
  });

  it("resolves $HOME without requiring the directory to exist on the mock fs", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");
    const result = await expandConfiguredRoot("$HOME");
    expect(result).toBe("/home/tester");
  });

  it("returns null for $HOME when homedir is empty", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("");
    const result = await expandConfiguredRoot("$HOME");
    expect(result).toBeNull();
  });

  it("resolves $DOWNLOADS to <home>/Downloads when present", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");
    vol.fromJSON({ "/home/tester/Downloads/x.txt": "" });
    const result = await expandConfiguredRoot("$DOWNLOADS");
    expect(result).toBe("/home/tester/Downloads");
  });

  it("resolves $DESKTOP to <home>/Desktop when present", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");
    vol.fromJSON({ "/home/tester/Desktop/x.txt": "" });
    const result = await expandConfiguredRoot("$DESKTOP");
    expect(result).toBe("/home/tester/Desktop");
  });

  it("returns null for $DOWNLOADS when the directory is missing", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/tester");
    const result = await expandConfiguredRoot("$DOWNLOADS");
    expect(result).toBeNull();
  });

  it("resolves $CWD to the process working directory", async () => {
    const result = await expandConfiguredRoot("$CWD");
    expect(result).toBe(realCwd);
  });
});
