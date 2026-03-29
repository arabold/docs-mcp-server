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

### Default-deny special network ranges while keeping explicit opt-in overrides

Model network protection with one main switch, `allowPrivateNetworks`, that defaults to `false` and covers loopback, RFC1918 private ranges, link-local addresses, and equivalent IPv6 special-use ranges. Add `allowedHosts` and `allowedCidrs` so trusted deployments can permit only the specific internal targets they need while the broad default-deny behavior remains in place.

When `allowPrivateNetworks` is `false`, an empty `allowedHosts` and `allowedCidrs` configuration means no private or special-use network targets are allowed. Public internet targets remain allowed unless blocked by some other rule. When `allowPrivateNetworks` is `true`, all network targets become eligible for access, subject to the same redirect and DNS resolution checks.

`allowedHosts` and `allowedCidrs` serve different purposes. `allowedHosts` grants a hostname-bound exception for requests explicitly targeting that host, even when it resolves to private or special-use addresses. `allowedCidrs` grants an address-bound exception for direct IP targets or any hostname whose resolved connection address falls within an allowed subnet. Redirects and secondary requests are evaluated independently against the same rules, so a request allowed via `allowedHosts` does not automatically authorize a different hostname or a direct IP target unless that new target is also allowed.

Example default-secure network configuration:

```yaml
scraper:
  security:
    network:
      allowPrivateNetworks: false
      allowedHosts: []
      allowedCidrs: []
```

Example selective internal allowlist:

```yaml
scraper:
  security:
    network:
      allowPrivateNetworks: false
      allowedHosts:
        - docs.internal.example
      allowedCidrs:
        - 10.42.0.0/16
```

Alternative considered: permissive defaults with warnings only. Rejected because the objective of this change is meaningful hardening for exposed deployments, and warnings do not reduce actual risk.

Alternative considered: separate booleans such as `allowLoopback` and `allowLinkLocal`. Rejected because they create overlapping policy states and make it harder to explain how exceptions should be configured.

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

### Preserve internal temporary archive handoff

Treat temporary files created by the application itself for supported web archive scraping as internal implementation artifacts rather than user-requested `file://` access. Policy enforcement will still apply to the original network URL, but once a web archive root has been accepted and downloaded, the handoff into local archive processing must not be blocked merely because the temp file lives outside configured user roots such as `$DOCUMENTS`. This exception is limited to the downloaded archive artifact produced for that accepted request and virtual members read from that archive during the same processing flow.

Alternative considered: requiring the temp directory to be added to default allowed roots. Rejected because it couples user-facing file policy to OS temp locations and would either over-broaden local access or break existing archive behavior.

### Use `$DOCUMENTS` as a convenience token, not a policy special case

Support `$DOCUMENTS` expansion during config resolution or policy evaluation, but enforce access against concrete absolute paths after expansion. This keeps the user experience simple without coupling enforcement logic to platform-specific home-directory conventions.

Alternative considered: using `$HOME` as a default root. Rejected because it is too broad and includes common secret locations such as `.ssh`, `.aws`, and dot-config directories.

## Risks / Trade-offs

- [Behavior break for existing internal-doc users] -> Provide explicit `allowedHosts` and `allowedCidrs` overrides and document migration clearly.
- [Regression in supported web archive scraping] -> Exempt internally managed temp archive handoff from user file-root checks while preserving network policy on the original URL.
- [DNS resolution and redirect validation complexity] -> Keep the first implementation limited to HTTP(S) plus redirect revalidation and well-defined CIDR checks, covered by focused tests.
- [Browser subrequest enforcement complexity] -> Intercept all Playwright requests centrally and apply the same resolver/policy helper used by non-browser fetchers.
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
