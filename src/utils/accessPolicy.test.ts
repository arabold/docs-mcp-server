import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./config";
import { loadConfig } from "./config";
import { AccessPolicyError } from "./errors";

vi.mock("node:fs/promises", () => ({ default: vol.promises }));

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: Parameters<typeof lookupMock>) => lookupMock(...args),
}));

import * as os from "node:os";
import { expandConfiguredRoot, ScraperAccessPolicy } from "./accessPolicy";

type SecurityOverrides = {
  network?: Partial<AppConfig["scraper"]["security"]["network"]>;
  fileAccess?: Partial<AppConfig["scraper"]["security"]["fileAccess"]>;
};

function createSecurityConfig(
  overrides: SecurityOverrides = {},
): AppConfig["scraper"]["security"] {
  const defaults = loadConfig().scraper.security;
  return {
    ...defaults,
    ...overrides,
    network: {
      ...defaults.network,
      ...overrides.network,
    },
    fileAccess: {
      ...defaults.fileAccess,
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
});

describe("expandConfiguredRoot", () => {
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
});
