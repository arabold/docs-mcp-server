## Why

The product intentionally fetches arbitrary web and local content, but today it does so without configurable network or file access restrictions. That is acceptable for trusted local workflows, yet it leaves shared or internet-exposed deployments without a first-class way to reduce SSRF-style risk, sensitive local file access, or accidental access to hidden content.

## What Changes

- Add configurable outbound access controls for HTTP(S) fetches used by `fetch_url` and scraping workflows, with two postures: `open` (current behavior — public allowed, private blocked with exceptions) and `allowlist` (only configured hosts/CIDRs permitted).
- Default-deny access to private, loopback, link-local, and other special-use network targets in `open` mode unless explicitly allowed via host or CIDR allowlists.
- Accept host allowlist entries as either literal hostnames, minimatch glob patterns, or `/.../`-wrapped regular expressions, sharing the same pattern syntax as scraper include/exclude lists.
- Add configurable TLS verification controls for environments that need to allow invalid or self-signed HTTPS certificates, scoped strictly to targets already permitted by the network policy.
- Add configurable local file access modes with allowed root directories, user-directory token expansion (`$HOME`, `$DOCUMENTS`, `$DOWNLOADS`, `$DESKTOP`, `$CWD`), and secure defaults for symlinks and hidden paths.
- Preserve supported archive workflows by distinguishing user-requested local file access from internally managed temporary files and archive member resolution.
- Enforce the same access policy across CLI, MCP, and web-triggered fetch/scrape operations.
- Return clear validation errors when a URL or file path is blocked by policy, including guidance for enabling access.

## Capabilities

### New Capabilities
- `outbound-access-control`: Define and enforce configurable network and local file access restrictions for one-shot fetches and scraping workflows.

### Modified Capabilities
- `configuration`: Add scraper security configuration for network restrictions, file access modes, allowed roots, symlink handling, and hidden path handling.

## Impact

- Affected code: scraper config schema and defaults, URL/file fetcher entry points, local file traversal, archive handoff paths, fetch and scrape tools, and related tests.
- Affected interfaces: CLI, MCP, and web-backed scraping behavior will share the same enforcement rules.
- Documentation impact: configuration and security docs will need updates to explain the new defaults and opt-in overrides.
