## 1. Configuration Model

- [ ] 1.1 Add `scraper.security` to the typed config schema and defaults, including network restrictions and file access settings.
- [ ] 1.2 Implement config parsing for `network.allowedHosts`, `network.allowedCidrs`, `fileAccess.mode`, `allowedRoots`, `followSymlinks`, and `includeHidden`, including JSON/YAML-style array env values and `$DOCUMENTS` token support.
- [ ] 1.3 Extend configuration tests to cover default values, nested environment variable overrides, array env parsing, and unresolvable `$DOCUMENTS` behavior.

## 2. Shared Access Policy

- [ ] 2.1 Add a shared URL and file access policy helper that evaluates HTTP(S) targets, CIDR/host allowlists, and file path containment.
- [ ] 2.2 Enforce the shared policy in `AutoDetectFetcher` and HTTP fetch flows, including mandatory redirect-target and DNS-resolved IP revalidation.
- [ ] 2.3 Enforce the shared policy in local file fetch and local scrape entry points before any file system reads occur, including virtual archive paths.
- [ ] 2.4 Preserve supported web archive root processing by allowing internally managed temp archive handoff after the original network URL has passed policy checks.
- [ ] 2.5 Define and implement hostname-bound `allowedHosts` exceptions and address-bound `allowedCidrs` exceptions, including redirect handling for new targets.

## 3. Browser Enforcement

- [ ] 3.1 Enforce the shared outbound policy on all Playwright-initiated requests, including frames, iframes, scripts, stylesheets, images, and fetch/XHR calls.
- [ ] 3.2 Ensure browser subrequests apply the same hostname-bound `allowedHosts` and address-bound `allowedCidrs` semantics as non-browser HTTP fetches.

## 4. Local File Traversal Hardening

- [ ] 4.1 Update local file traversal to block or skip hidden files and directories when `includeHidden` is disabled.
- [ ] 4.2 Update local file traversal to reject symlinks by default and allow them only when `followSymlinks` is enabled and the resolved target remains inside an allowed root.
- [ ] 4.3 Ensure direct `file://` fetches use the same hidden-path and symlink rules as directory crawling.
- [ ] 4.4 Validate archive-member `file://` paths against the concrete archive file path instead of the nonexistent combined virtual path.
- [ ] 4.5 Limit the internal temp-archive exception to the accepted downloaded archive artifact and its virtual members.

## 5. Verification

- [ ] 5.1 Add tests for blocked loopback, private-network, and redirect-to-private HTTP(S) requests.
- [ ] 5.2 Add tests for allowed internal targets when hosts or CIDRs are explicitly configured while `allowPrivateNetworks` remains disabled.
- [ ] 5.3 Add tests for hostname-bound host allowlists, CIDR-based IP allowlists, and redirects or direct-IP requests that must remain blocked unless separately allowed.
- [ ] 5.4 Add tests for browser-based blocked subrequests and allowed browser subrequests under explicit allowlists.
- [ ] 5.5 Add tests for allowed-root file access, blocked outside-root access, hidden path blocking, and symlink containment.
- [ ] 5.6 Add tests for supported web archive root scraping via temp files, virtual archive-member paths within allowed roots, and unrelated temp-file rejection.

## 6. Documentation

- [ ] 6.1 Update user-facing configuration documentation to describe the new security defaults and override mechanisms.
- [ ] 6.2 Update security/authentication documentation to explain the trust model, private-network defaults, and local file restrictions.
- [ ] 6.3 Add a dedicated `docs/infrastructure/security.md` document covering trust boundaries, deployment hardening, outbound access controls, and local file access policy.
- [ ] 6.4 Document sample security configurations, environment-variable array encoding, empty network/file allowlist behavior, and counterintuitive semantics such as broad access from `allowPrivateNetworks: true` and unresolved `$DOCUMENTS` tokens.
