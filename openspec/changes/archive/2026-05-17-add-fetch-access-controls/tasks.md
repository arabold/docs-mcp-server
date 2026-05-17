## 1. Configuration Model

- [x] 1.1 Add `scraper.security` to the typed config schema and defaults, including network restrictions and file access settings.
- [x] 1.2 Implement config parsing for `network.mode`, `network.allowedHosts`, `network.allowedCidrs`, `network.allowInvalidTls`, `fileAccess.mode`, `allowedRoots`, `followSymlinks`, and `includeHidden`, including JSON/YAML-style array env values and user-directory token support.
- [x] 1.3 Extend configuration tests to cover default values, nested environment variable overrides, array env parsing, invalid-TLS settings, and unresolvable user-directory token behavior.
- [x] 1.4 Make `loadConfig` resilient to a structurally invalid saved config (fall back to defaults and overwrite) so users do not get stuck after an upgrade.
- [x] 1.5 Fix `deepMerge` to treat arrays as scalars (source replaces target) so list-shaped config values survive a write/read round-trip.

## 2. Shared Access Policy

- [x] 2.1 Add a shared URL and file access policy helper that evaluates HTTP(S) targets, CIDR/host allowlists, and file path containment.
- [x] 2.2 Enforce the shared policy in `AutoDetectFetcher` and HTTP fetch flows, including mandatory redirect-target and DNS-resolved IP revalidation.
- [x] 2.3 Enforce the shared policy in local file fetch and local scrape entry points before any file system reads occur, including virtual archive paths.
- [x] 2.4 Preserve supported web archive root processing by allowing internally managed temp archive handoff after the original network URL has passed policy checks.
- [x] 2.5 Define and implement hostname-bound `allowedHosts` exceptions and address-bound `allowedCidrs` exceptions, including redirect handling for new targets.
- [x] 2.6 Define and implement TLS verification policy with secure defaults and broad `allowInvalidTls` override behavior.
- [x] 2.7 Ensure TLS exceptions are evaluated only after network policy allows the target.
- [x] 2.8 Implement `network.mode` with `open` (current behavior) and `allowlist` (only configured hosts/CIDRs permitted; `allowPrivateNetworks` ignored) postures.
- [x] 2.9 Match `allowedHosts` entries via the shared scraper pattern syntax (literal, minimatch glob, or `/.../` regex), against the bare hostname only.
- [x] 2.10 Expand user-directory tokens `$HOME`, `$DOCUMENTS`, `$DOWNLOADS`, `$DESKTOP`, and `$CWD` for file-access allowed roots, returning null when a token cannot be resolved.

## 3. Browser Enforcement

- [x] 3.1 Enforce the shared outbound policy on all Playwright-initiated requests, including frames, iframes, scripts, stylesheets, images, and fetch/XHR calls.
- [x] 3.2 Ensure browser subrequests apply the same hostname-bound `allowedHosts`, address-bound `allowedCidrs`, and broad invalid-TLS semantics as non-browser HTTP fetches.

## 4. Local File Traversal Hardening

- [x] 4.1 Update local file traversal to block or skip hidden files and directories when `includeHidden` is disabled.
- [x] 4.2 Update local file traversal to reject symlinks by default and allow them only when `followSymlinks` is enabled and the resolved target remains inside an allowed root.
- [x] 4.3 Ensure direct `file://` fetches use the same hidden-path and symlink rules as directory crawling.
- [x] 4.4 Validate archive-member `file://` paths against the concrete archive file path instead of the nonexistent combined virtual path.
- [x] 4.5 Limit the internal temp-archive exception to the accepted downloaded archive artifact and its virtual members.

## 5. Verification

- [x] 5.1 Add tests for blocked loopback, private-network, and redirect-to-private HTTP(S) requests.
- [x] 5.2 Add tests for allowed internal targets when hosts or CIDRs are explicitly configured while `allowPrivateNetworks` remains disabled.
- [x] 5.3 Add tests for hostname-bound host allowlists, CIDR-based IP allowlists, and redirects or direct-IP requests that must remain blocked unless separately allowed.
- [x] 5.4 Add tests for invalid TLS rejection by default and broad invalid-TLS override behavior.
- [x] 5.5 Add tests proving invalid-TLS override does not bypass network allowlists.
- [x] 5.6 Add tests for browser-based blocked subrequests and allowed browser subrequests under explicit allowlists, including invalid-TLS behavior.
- [x] 5.7 Add tests for allowed-root file access, blocked outside-root access, hidden path blocking, and symlink containment.
- [x] 5.8 Add tests for supported web archive root scraping via temp files, virtual archive-member paths within allowed roots, and unrelated temp-file rejection.
- [x] 5.9 Add tests for `network.mode` allowlist semantics: hostname glob matches, regex matches, CIDR-only direct-IP matches, empty-list deny-all, and that `allowPrivateNetworks` is ignored.
- [x] 5.10 Add tests for the additional user-directory tokens (`$HOME`, `$DOWNLOADS`, `$DESKTOP`, `$CWD`), including the case where the underlying directory is absent.
- [x] 5.11 Add tests confirming that an allowlisted hostname is trusted for its DNS answers (resolves to a private IP without `allowedCidrs` still succeeds) and that for non-allowlisted hostnames in allowlist mode every resolved address must lie inside `allowedCidrs`.
- [x] 5.12 Add tests confirming that the hidden-segment check only applies to segments below the matched allowed root: a root whose absolute path contains a hidden ancestor (e.g. `/srv/.config/docs`) permits its contents, while hidden segments inside the root (e.g. `.git`) remain blocked.

## 6. Documentation

- [x] 6.1 Update user-facing configuration documentation to describe the new security defaults and override mechanisms.
- [x] 6.2 Update security/authentication documentation to explain the trust model, private-network defaults, and local file restrictions.
- [x] 6.3 Add a dedicated `docs/infrastructure/security.md` document covering trust boundaries, deployment hardening, outbound access controls, and local file access policy.
- [x] 6.4 Document sample security configurations, environment-variable array encoding, empty network/file allowlist behavior, and counterintuitive semantics such as broad access from `allowPrivateNetworks: true`, broad TLS trust from `allowInvalidTls: true`, and unresolved `$DOCUMENTS` tokens.
- [x] 6.5 Document that invalid-TLS override does not bypass network allowlists.
