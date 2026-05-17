## Context

The server intentionally supports arbitrary HTTP(S) and `file://` fetching across CLI, MCP, and web-triggered scraping flows. Today, fetcher selection and local file traversal are centralized enough to apply consistent controls, but there is no policy layer that limits outbound network targets, constrains local file roots, or handles hidden paths and symlink escapes. The project already has a strong configuration model with schema-backed defaults and environment/CLI overrides, so access controls should be introduced as configuration-driven behavior rather than interface-specific flags.

## Goals / Non-Goals

**Goals:**
- Add one shared outbound access policy that applies to `fetch_url` and scrape workflows regardless of entry point.
- Default-deny private, loopback, link-local, and similar special-use network targets unless explicitly configured.
- Add configurable local file access modes with allowed roots, `$DOCUMENTS` token expansion, and secure defaults for hidden paths and symlinks.
- Produce clear user-facing errors when policy blocks access.
- Preserve explicit opt-in paths for trusted local and self-hosted deployments.

**Non-Goals:**
- Add per-user or per-token authorization rules.
- Implement a sandbox or OS-level file isolation boundary.
- Detect every possible cloud metadata alias or enterprise-internal hostname pattern out of the box.
- Redesign the scrape tool surface or add new transport-level authentication features.

## Decisions

### Introduce a shared scraper security policy under configuration

Add a new `scraper.security` section to the typed config schema. This keeps policy close to the fetch/scrape subsystem and lets the existing precedence model handle config file, environment, and CLI overrides.

Alternative considered: a top-level `security` block. Rejected because the affected behavior is currently isolated to scraper-driven URL and file access, and placing the settings under `scraper` avoids broadening the configuration surface prematurely.

### Enforce policy centrally before network or file reads

Introduce a reusable access-policy helper that validates URLs and resolved file paths before `AutoDetectFetcher`, `HttpFetcher`, `FileFetcher`, and local crawl entry points perform I/O. DNS-resolved IP revalidation and redirect-target validation will be mandatory enforcement behavior, not optional configuration knobs. For archive-member URLs such as `file:///path/to/archive.zip/docs/readme.md`, policy evaluation will be based on the resolved backing archive file path plus the virtual entry path, not on the nonexistent combined filesystem path.

Alternative considered: only validating at the MCP tool boundary. Rejected because CLI and web-triggered scraping must behave consistently, and lower-level enforcement prevents bypass through internal call paths.

### Apply network policy to browser-initiated subrequests

Treat browser-based fetching as a series of outbound requests rather than a single navigation. The same network policy must apply to the initial page load, redirects, frames, iframes, scripts, stylesheets, images, XHR/fetch calls, and any other subresource request initiated during rendering so that a public page cannot pivot the renderer into private network access.

Alternative considered: only validating the initial browser navigation target. Rejected because it leaves a clear SSRF-style gap for render-time secondary requests.

### Network policy posture: `open` (default) vs `allowlist`

Model network protection as a two-mode firewall posture under `network.mode`, mirroring the same `mode` shape used by `fileAccess.mode`:

- `open` (default). Public internet targets are permitted. Private, loopback, link-local, and equivalent IPv6 special-use ranges are denied unless `allowPrivateNetworks` is `true` or the specific target matches `allowedHosts` or `allowedCidrs`. This covers the dominant use case of "allow all public docs, block local network."
- `allowlist`. A request is permitted only when its hostname matches `allowedHosts` or its target/resolved IP falls within `allowedCidrs`. Everything else is denied. `allowPrivateNetworks` is ignored in this mode — the explicit allowlist is the complete authorization surface, so adding `allowPrivateNetworks: true` would only confuse the policy semantics.

This choice deliberately follows the firewall "default policy + rules" convention used by AWS security groups, nftables, and similar tooling. The alternative of "presence of allowlist entries silently flips the mode" (the Kubernetes NetworkPolicy approach) is rejected because adding a single host exception should not silently transform every other authorization in the deployment.

`allowedHosts` and `allowedCidrs` serve different purposes in both modes:

- `allowedHosts` is hostname-bound. It permits requests whose hostname matches the configured pattern, including cases where that named host resolves to a private or special-use address. A request allowed via `allowedHosts` does not authorize a different hostname, a direct IP target, or a redirected hostname. This is an explicit trust decision in that hostname and its DNS answers, so operators should keep host entries narrow and prefer exact internal names over broad wildcards for sensitive deployments.
- `allowedCidrs` is address-bound. It permits direct IP targets and hostnames whose resolved connection addresses all fall inside the configured subnet set. Like host entries, it is evaluated independently for redirects and secondary requests.

The evaluation order is intentionally explicit:

1. Direct IP targets are decided by `allowedCidrs` / `allowPrivateNetworks`; `allowedHosts` never applies.
2. A hostname that matches `allowedHosts` is permitted for that exact hostname and short-circuits CIDR-based post-resolution checks.
3. A hostname that does not match `allowedHosts` is evaluated after DNS resolution. In `open` mode, every resolved address must remain outside blocked special-use ranges unless covered by `allowedCidrs`. In `allowlist` mode, every resolved address must fall inside `allowedCidrs`.

This means mixed public/private, mixed IPv4/IPv6, or otherwise multi-record DNS answers are denied unless every possible connection address is permitted by the active policy. Deployments that need a named internal service without pinning its subnet should allowlist that hostname explicitly and accept the trust boundary that comes with trusting its DNS.

`allowedHosts` entries reuse the project's existing pattern syntax (the same one used by scrape `--include-pattern` / `--exclude-pattern`):

- A bare entry like `docs.internal.example` is an exact-match.
- A minimatch glob like `*.example.com` or `docs.*` matches the bare hostname (case-insensitive).
- An entry wrapped in `/.../` is treated as a JavaScript regular expression for the rare cases globs cannot express.
- The match is run against the hostname only, never the scheme or path. CIDR-shaped entries continue to live in `allowedCidrs`.

Sharing one pattern syntax across all matching configuration was preferred over importing an external convention such as `NO_PROXY`'s `.example.com` form: users learning one syntax inside the project is more valuable than aligning with any single outside ecosystem, and reusing the existing matcher avoids a parallel implementation.

Example default-secure network configuration:

```yaml
scraper:
  security:
    network:
      mode: open
      allowPrivateNetworks: false
      allowedHosts: []
      allowedCidrs: []
```

Example selective internal exception (still in `open` mode):

```yaml
scraper:
  security:
    network:
      mode: open
      allowPrivateNetworks: false
      allowedHosts:
        - "*.internal.example"
      allowedCidrs:
        - 10.42.0.0/16
```

Example strict outbound allowlist for a shared deployment:

```yaml
scraper:
  security:
    network:
      mode: allowlist
      allowedHosts:
        - docs.python.org
        - "*.rust-lang.org"
        - /^docs\d+\.example\.com$/
      allowedCidrs: []
```

Alternative considered: permissive defaults with warnings only. Rejected because the objective of this change is meaningful hardening for exposed deployments, and warnings do not reduce actual risk.

Alternative considered: separate booleans such as `allowLoopback` and `allowLinkLocal`. Rejected because they create overlapping policy states and make it harder to explain how exceptions should be configured.

### Keep TLS verification secure by default with a single override

TLS certificate verification remains enabled by default for all HTTPS requests. Add `allowInvalidTls` as a single broad override for environments that need to reach services with self-signed or otherwise invalid certificates. TLS exceptions are evaluated only after the target has already been permitted by the network access policy.

Example invalid TLS override:

```yaml
scraper:
  security:
    network:
      allowPrivateNetworks: false
      allowedHosts:
        - docs.internal.example
      allowInvalidTls: true
```

Alternative considered: hostname-scoped invalid TLS exceptions. Rejected because they add disproportionate policy complexity and do not map cleanly onto browser-based fetching behavior. A future custom-certificate feature would be a better way to support scoped trust.

Alternative considered: placing TLS settings under `scraper.fetcher`. Rejected because certificate verification is a trust-boundary policy that must apply consistently across HTTP and browser-based fetch paths.

### Add file access modes with allowlisted roots and secure traversal defaults

Model local file access as `disabled`, `allowedRoots`, or `unrestricted`. In `allowedRoots` mode, expand configured tokens such as `$DOCUMENTS`, canonicalize paths, and require the effective target to remain inside an allowed root. Set `followSymlinks` and `includeHidden` to `false` by default. Hidden paths will be blocked even when explicitly named unless the user opts in.

When `fileAccess.mode` is `allowedRoots`, an empty `allowedRoots` list means all user-requested `file://` access is denied. This does not block internally managed temporary archive handoff for accepted web archive roots.

If `$DOCUMENTS` cannot be resolved on the current platform or runtime account, it will expand to no path and therefore grant no access by itself. Deployments that require local file access in containers or service accounts must configure explicit absolute paths.

Example default file policy:

```yaml
scraper:
  security:
    fileAccess:
      mode: allowedRoots
      allowedRoots:
        - $DOCUMENTS
      followSymlinks: false
      includeHidden: false
```

Example fully disabled local file access:

```yaml
scraper:
  security:
    fileAccess:
      mode: disabled
      allowedRoots: []
      followSymlinks: false
      includeHidden: false
```

Alternative considered: denylisting sensitive directories under `$HOME`. Rejected because denylisting is incomplete and easier to bypass than root allowlisting.

The default `$DOCUMENTS` root is intentionally a local-workstation convenience, not a claim that remotely reachable deployments should expose user documents broadly. Shared or internet-facing deployments are expected to narrow `allowedRoots` to an application-specific directory or disable file access entirely.

### Preserve internal temporary archive handoff

Treat temporary files created by the application itself for supported web archive scraping as internal implementation artifacts rather than user-requested `file://` access. Policy enforcement will still apply to the original network URL, but once a web archive root has been accepted and downloaded, the handoff into local archive processing must not be blocked merely because the temp file lives outside configured user roots such as `$DOCUMENTS`. This exception is limited to the downloaded archive artifact produced for that accepted request and virtual members read from that archive during the same processing flow.

Alternative considered: requiring the temp directory to be added to default allowed roots. Rejected because it couples user-facing file policy to OS temp locations and would either over-broaden local access or break existing archive behavior.

### Support a small set of user-directory tokens

Allowed-root entries may be either literal absolute paths or one of the following tokens. Tokens are expanded during policy evaluation; access is enforced against the concrete absolute path returned by expansion, so enforcement logic never depends on platform-specific home-directory conventions:

- `$HOME` — the user's home directory. Broad: includes dotfiles such as `.ssh`, `.aws`, and `.config`. Provided as an opt-in for users who explicitly want it; documented as such so it is not selected by accident.
- `$DOCUMENTS` — the platform's documents directory. The default allowed root.
- `$DOWNLOADS` — the platform's downloads directory. Useful because many users drop docs there.
- `$DESKTOP` — the platform's desktop directory.
- `$CWD` — the process working directory. Useful for CLI use where a user has `cd`'d into a project.

`$HOME` and `$CWD` resolve to a concrete path even when that path is empty or unusual; the other tokens probe for the conventional `<home>/<Folder>` location and resolve to `null` if it does not exist on the current platform or account, so the token denies rather than silently granting an unexpected path.

Alternative considered: using `$HOME` as the default root. Rejected because it is too broad and includes common secret locations such as `.ssh`, `.aws`, and dot-config directories. `$HOME` remains available as an explicit opt-in.

## Risks / Trade-offs

- [Behavior break for existing internal-doc users] -> Provide explicit `allowedHosts` and `allowedCidrs` overrides and document migration clearly.
- [Regression in supported web archive scraping] -> Exempt internally managed temp archive handoff from user file-root checks while preserving network policy on the original URL.
- [DNS resolution and redirect validation complexity] -> Keep the first implementation limited to HTTP(S) plus redirect revalidation and well-defined CIDR checks, covered by focused tests.
- [Browser subrequest enforcement complexity] -> Intercept all Playwright requests centrally and apply the same resolver/policy helper used by non-browser fetchers.
- [Invalid TLS override broadens trust for all HTTPS targets] -> Keep TLS verification enabled by default and require explicit opt-in only when deployments accept the wider trust boundary.
- [Platform-specific `$DOCUMENTS` resolution differences] -> Fall back to explicit paths when the token cannot be resolved reliably.
- [Confusion around hidden path semantics] -> Treat `includeHidden: false` as a hard deny for both direct fetch and traversal, and document this explicitly.
- [Symlink handling may surprise users with linked doc folders] -> Keep an opt-in `followSymlinks` flag and validate the resolved target stays within an allowed root.

## Migration Plan

1. Add the new config schema and defaults.
2. Implement shared access-policy utilities and wire them into fetchers and local file traversal.
3. Preserve archive workflows by validating virtual archive paths against the concrete archive file and by exempting internal temp archive handoff from user file-root checks.
4. Update tests to cover blocked and allowed cases for top-level and browser-initiated network requests, hidden paths, symlinks, and archive workflows.
5. Update user-facing documentation to explain defaults, array/env encoding, token expansion, and override patterns.
6. Release with changelog notes highlighting that private-network access is now blocked by default and file access is restricted by policy.

Rollback consists of removing the policy enforcement layer and reverting to the previous permissive defaults, but the preferred operational mitigation is to loosen the new config values rather than removing the feature.

## Open Questions

- Do we want CLI flags for temporary overrides in addition to config and environment variables, or is config-only sufficient for the first iteration?
