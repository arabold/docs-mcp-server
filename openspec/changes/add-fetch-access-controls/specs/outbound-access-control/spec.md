## ADDED Requirements

### Requirement: Outbound Network Targets Must Respect Access Policy
The system SHALL enforce a shared outbound network access policy for one-shot URL fetches and scrape workflows before establishing HTTP(S) connections. Redirect-target validation and DNS-resolved IP validation SHALL always be applied during HTTP(S) access.

The network policy SHALL operate in one of two modes selected by `scraper.security.network.mode`:

- `open` (default): public internet targets are permitted; private, loopback, link-local, and other special-use network targets are denied unless `allowPrivateNetworks` is `true` or the target matches `allowedHosts` or `allowedCidrs`.
- `allowlist`: a request is permitted only when its hostname matches `allowedHosts` or its target/resolved IP falls within `allowedCidrs`. In allowlist mode `allowPrivateNetworks` SHALL be ignored.

Hostname matching SHALL use the same pattern syntax as scraper include/exclude patterns: a literal hostname is an exact-match entry; glob wildcards such as `*.example.com` and `docs.*` are supported via minimatch; an entry wrapped in `/.../` is treated as a JavaScript regular expression. Hostname matching SHALL be case-insensitive. Glob and regex patterns SHALL be matched against the bare hostname only, without scheme or path. CIDR allowlist entries SHALL be matched against the connecting IP, not against patterns.

#### Scenario: Block loopback target by default
- **WHEN** a user attempts to fetch `http://127.0.0.1:9999/test`
- **THEN** the system SHALL reject the request before performing the fetch
- **AND** the error SHALL state that the target is blocked by security policy

#### Scenario: Block private network target by default
- **WHEN** a user attempts to fetch a URL whose resolved address is within a private network range
- **THEN** the system SHALL reject the request before performing the fetch
- **AND** the error SHALL identify that private network access is disabled

#### Scenario: Block loopback and special-use targets by default
- **WHEN** a user attempts to fetch a URL whose resolved address is loopback, link-local, or another blocked special-use address
- **THEN** the system SHALL reject the request before performing the fetch
- **AND** the error SHALL identify that the target is blocked by network security policy

#### Scenario: Allow configured internal target
- **GIVEN** the configuration explicitly allows the target hostname or CIDR range
- **WHEN** a user fetches an internal documentation URL within that allowlist
- **THEN** the system SHALL permit the request

#### Scenario: Allowlist exception while private networks remain disabled
- **GIVEN** `allowPrivateNetworks` is `false`
- **AND** the target matches `allowedHosts` or `allowedCidrs`
- **WHEN** a user fetches that internal URL
- **THEN** the system SHALL permit the request
- **AND** other private or special-use targets SHALL remain blocked unless they also match the allowlist

#### Scenario: Empty network allowlists deny all private targets
- **GIVEN** `allowPrivateNetworks` is `false`
- **AND** `allowedHosts` and `allowedCidrs` are both empty
- **WHEN** a user fetches a private or special-use network target
- **THEN** the system SHALL reject the request
- **AND** public internet targets SHALL remain eligible for access

#### Scenario: Host allowlist grants a hostname-bound exception
- **GIVEN** `allowPrivateNetworks` is `false`
- **AND** `allowedHosts` contains `docs.internal.example`
- **WHEN** a user fetches `https://docs.internal.example/guide`
- **THEN** the system SHALL permit the request even if the host resolves to a private or special-use address
- **AND** that authorization SHALL apply only to the requested hostname, not to its direct IPs or any other hostname that resolves to the same service

#### Scenario: Host allowlist does not permit direct IP access
- **GIVEN** `allowPrivateNetworks` is `false`
- **AND** `allowedHosts` contains `docs.internal.example`
- **WHEN** a user fetches the direct IP address of that service
- **THEN** the system SHALL reject the request unless the resolved target is also permitted by `allowedCidrs` or `allowPrivateNetworks`

#### Scenario: Host allowlist does not permit redirected hostname by default
- **GIVEN** `allowPrivateNetworks` is `false`
- **AND** `allowedHosts` contains `docs.internal.example`
- **WHEN** the request redirects to `wiki.internal.example`
- **THEN** the redirected request SHALL be rejected unless the new target also matches `allowedHosts`, `allowedCidrs`, or `allowPrivateNetworks`

#### Scenario: Glob host pattern matches subdomains
- **GIVEN** `allowedHosts` contains `*.internal.example`
- **WHEN** a user fetches `https://docs.internal.example/guide` or `https://wiki.team.internal.example/page`
- **THEN** the system SHALL permit both requests
- **AND** a request to the bare apex `https://internal.example/` SHALL not match the leading-wildcard pattern

#### Scenario: Regex host pattern matches by anchored pattern
- **GIVEN** `allowedHosts` contains `/^docs\d+\.example\.com$/`
- **WHEN** a user fetches `https://docs42.example.com/path`
- **THEN** the system SHALL permit the request

#### Scenario: Allowlist mode requires explicit match for every target
- **GIVEN** `network.mode` is `allowlist`
- **AND** `allowedHosts` contains `docs.python.org` and `*.rust-lang.org`
- **WHEN** a user fetches `https://docs.python.org/3/` or `https://docs.rust-lang.org/std/`
- **THEN** the system SHALL permit both requests
- **AND** a request to `https://news.ycombinator.com/` SHALL be rejected

#### Scenario: Allowlist mode permits direct IPs only via CIDR
- **GIVEN** `network.mode` is `allowlist`
- **AND** `allowedCidrs` contains `10.42.0.0/16`
- **WHEN** a user fetches `https://10.42.7.1/`
- **THEN** the system SHALL permit the request
- **AND** a request to `https://10.99.0.1/` SHALL be rejected

#### Scenario: Allowlist mode denies all traffic when both lists are empty
- **GIVEN** `network.mode` is `allowlist`
- **AND** `allowedHosts` and `allowedCidrs` are both empty
- **WHEN** a user fetches any HTTP(S) URL
- **THEN** the system SHALL reject the request

#### Scenario: Allowlist mode ignores allowPrivateNetworks
- **GIVEN** `network.mode` is `allowlist`
- **AND** `allowPrivateNetworks` is `true`
- **WHEN** a user fetches a private or special-use target that does not match `allowedHosts` or `allowedCidrs`
- **THEN** the system SHALL reject the request

#### Scenario: Mixed DNS answers are rejected for non-allowlisted hostnames in open mode
- **GIVEN** `network.mode` is `open`
- **AND** `allowPrivateNetworks` is `false`
- **AND** a hostname does not match `allowedHosts`
- **AND** DNS returns both public and private or special-use addresses for that hostname
- **WHEN** the system evaluates the access policy
- **THEN** the system SHALL reject the request unless every blocked special-use address is also covered by `allowedCidrs`

#### Scenario: CIDR-authorized hostname in allowlist mode requires every resolved address to be allowed
- **GIVEN** `network.mode` is `allowlist`
- **AND** a hostname does not match `allowedHosts`
- **AND** DNS returns multiple addresses for that hostname
- **WHEN** any resolved address falls outside `allowedCidrs`
- **THEN** the system SHALL reject the request even if another resolved address is inside `allowedCidrs`

### Requirement: TLS Verification Must Respect Network Security Policy
The system SHALL verify TLS certificates for HTTPS requests by default across HTTP and browser-based fetch paths. TLS exception policy SHALL only affect certificate validation after the target has already been permitted by the outbound network access policy.

#### Scenario: Reject invalid TLS certificate by default
- **GIVEN** no TLS override is configured
- **WHEN** a user fetches an HTTPS URL whose certificate is invalid or self-signed
- **THEN** the system SHALL reject the request because TLS verification failed

#### Scenario: Broad invalid TLS override enables all HTTPS targets
- **GIVEN** `allowInvalidTls` is `true`
- **AND** the target is already permitted by the outbound network access policy
- **WHEN** a user fetches an HTTPS URL with an invalid certificate
- **THEN** the system SHALL permit the request to proceed without rejecting the certificate

#### Scenario: Invalid TLS override does not bypass the network allowlist
- **GIVEN** `allowInvalidTls` is `true`
- **AND** the target is not permitted by the outbound network access policy (because of private-network defaults or allowlist mode)
- **WHEN** a user fetches that HTTPS URL
- **THEN** the system SHALL reject the request based on network policy without consulting the TLS override

### Requirement: Browser-Initiated Requests Must Respect Network Policy
The system SHALL apply the same outbound network access policy to every HTTP(S) request initiated by browser-based fetching during rendering or page evaluation.

#### Scenario: Block iframe request to private target during browser rendering
- **GIVEN** browser-based fetching is used for a public page
- **WHEN** the page attempts to load an iframe from a blocked private or special-use target
- **THEN** the system SHALL block that request
- **AND** the private target SHALL not receive the request

#### Scenario: Block subresource request to private target during browser rendering
- **GIVEN** browser-based fetching is used for a public page
- **WHEN** the page attempts to load a script, stylesheet, image, or fetch/XHR request from a blocked private or special-use target
- **THEN** the system SHALL block that request
- **AND** the private target SHALL not receive the request

#### Scenario: Apply allowlist exception to browser subrequest
- **GIVEN** browser-based fetching is used
- **AND** `allowPrivateNetworks` is `false`
- **AND** the browser subrequest target matches `allowedHosts` or `allowedCidrs`
- **WHEN** the page requests that internal resource
- **THEN** the system SHALL permit the subrequest

#### Scenario: Browser subrequest host allowlist remains hostname-bound
- **GIVEN** browser-based fetching is used
- **AND** `allowPrivateNetworks` is `false`
- **AND** `allowedHosts` contains `docs.internal.example`
- **WHEN** the page requests a subresource from the direct IP address of that service
- **THEN** the system SHALL reject the subrequest unless the address is also permitted by `allowedCidrs` or `allowPrivateNetworks`

#### Scenario: Browser subrequest respects broad invalid TLS override
- **GIVEN** browser-based fetching is used
- **AND** `allowInvalidTls` is `true`
- **WHEN** the page requests an HTTPS subresource with an invalid certificate
- **THEN** the system SHALL permit the subrequest to proceed without rejecting the certificate

#### Scenario: Block redirect to restricted network target
- **WHEN** a public URL redirects to a target blocked by the outbound access policy
- **THEN** the system SHALL reject the redirect target
- **AND** the final request SHALL not be sent to the blocked target

### Requirement: Local File Access Must Respect Configured File Policy
The system SHALL enforce one shared local file access policy for direct `file://` fetches and local scraping workflows.

#### Scenario: Reject file access when disabled
- **GIVEN** file access mode is `disabled`
- **WHEN** a user attempts to fetch or scrape a `file://` URL
- **THEN** the system SHALL reject the request before reading the file system

#### Scenario: Allow file access within configured root
- **GIVEN** file access mode is `allowedRoots`
- **AND** the target file resolves within a configured allowed root
- **WHEN** a user fetches or scrapes that `file://` URL
- **THEN** the system SHALL permit the request

#### Scenario: Reject file access outside configured root
- **GIVEN** file access mode is `allowedRoots`
- **AND** the target file resolves outside all configured allowed roots
- **WHEN** a user fetches or scrapes that `file://` URL
- **THEN** the system SHALL reject the request before reading the file contents

#### Scenario: Validate archive member against backing archive path
- **GIVEN** file access mode is `allowedRoots`
- **AND** a user requests a virtual archive member path such as `file:///allowed/docs.zip/guide/intro.md`
- **WHEN** the access policy is evaluated
- **THEN** the system SHALL resolve containment against the concrete archive file path `file:///allowed/docs.zip`
- **AND** it SHALL not reject the request solely because the virtual member path does not exist on the physical file system

#### Scenario: Expand documents token for allowed root
- **GIVEN** file access mode is `allowedRoots`
- **AND** an allowed root is configured as `$DOCUMENTS`
- **WHEN** the access policy is evaluated
- **THEN** the system SHALL resolve `$DOCUMENTS` to the platform-specific documents directory before checking path containment

#### Scenario: Expand additional user-directory tokens for allowed roots
- **GIVEN** an allowed root is configured as one of `$HOME`, `$DOWNLOADS`, `$DESKTOP`, or `$CWD`
- **WHEN** the access policy is evaluated
- **THEN** `$HOME` SHALL resolve to the user's home directory
- **AND** `$DOWNLOADS` SHALL resolve to the platform-specific downloads directory when that directory exists, otherwise grant no access
- **AND** `$DESKTOP` SHALL resolve to the platform-specific desktop directory when that directory exists, otherwise grant no access
- **AND** `$CWD` SHALL resolve to the process working directory

#### Scenario: Empty file root allowlist denies user-requested file access
- **GIVEN** file access mode is `allowedRoots`
- **AND** `allowedRoots` is empty
- **WHEN** a user attempts to fetch or scrape a `file://` URL
- **THEN** the system SHALL reject the request before reading the file system

#### Scenario: Permit internally managed temp archive handoff
- **GIVEN** a supported web archive root URL has passed outbound network policy checks
- **WHEN** the system downloads the archive to an internal temporary file for processing
- **THEN** the handoff into local archive processing SHALL be permitted even if the temp file is outside configured user file roots
- **AND** this exception SHALL apply only to application-managed temporary files created for that accepted archive workflow

#### Scenario: Temp archive exception does not permit unrelated temp files
- **GIVEN** file access mode is `allowedRoots`
- **AND** a temporary file was not created as the accepted archive artifact for the current web archive workflow
- **WHEN** local file policy is evaluated for that temp file
- **THEN** the normal file access policy SHALL apply

### Requirement: Hidden Paths and Symlinks Must Be Explicitly Opted In
The system SHALL treat hidden paths and symlink traversal as restricted by default for local file access.

#### Scenario: Block hidden file by default
- **GIVEN** hidden path access is disabled
- **WHEN** a user attempts to fetch or scrape a hidden file or a path inside a hidden directory below the matched allowed root
- **THEN** the system SHALL reject or skip the path according to the calling workflow

#### Scenario: Permit access under an allowed root whose absolute path contains a hidden ancestor
- **GIVEN** an allowed root such as `/srv/.config/docs` is configured
- **AND** hidden path access is disabled
- **WHEN** a user fetches or scrapes a non-hidden file inside that root (for example `/srv/.config/docs/guide.md`)
- **THEN** the system SHALL permit the request
- **AND** the hidden-segment check SHALL only apply to segments strictly below the matched root
- **AND** hidden segments inside the root (for example `.git`) SHALL still be blocked unless `includeHidden` is enabled

#### Scenario: Skip hidden entries during directory traversal by default
- **GIVEN** hidden path access is disabled
- **WHEN** the system enumerates entries inside an allowed local directory
- **THEN** hidden files and hidden directories SHALL not be added to the crawl queue

#### Scenario: Block symlink traversal by default
- **GIVEN** symlink following is disabled
- **WHEN** a requested file or enumerated directory entry is a symlink
- **THEN** the system SHALL reject or skip the symlinked path according to the calling workflow

#### Scenario: Allow symlink when enabled and contained
- **GIVEN** symlink following is enabled
- **AND** the symlink target resolves within a configured allowed root
- **WHEN** a user fetches or scrapes the symlinked path
- **THEN** the system SHALL permit access to the resolved target
