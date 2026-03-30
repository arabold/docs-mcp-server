# Infrastructure Security

## Overview

The Docs MCP Server intentionally fetches remote URLs and local files. That capability is useful for documentation indexing, but it also creates trust-boundary decisions for deployments that are shared, internet-exposed, or connected to sensitive internal networks.

This document describes the security model for scraper-driven access and the deployment controls that matter most in practice.

## Trust Boundaries

The server has three independent security surfaces:

1. Inbound access to MCP, web, and API endpoints.
2. Outbound network access performed by URL fetching and browser-based scraping.
3. Local file access performed by direct `file://` fetches and local crawling.

OAuth2 protects inbound MCP and HTTP usage. Scraper security settings protect outbound access and local file reads. These concerns are related but separate.

## Deployment Hardening

Use the following defaults for any shared or remotely reachable deployment:

- Enable authentication for exposed MCP and web endpoints.
- Keep the server behind TLS termination.
- Restrict worker and internal API networking at the infrastructure layer.
- Leave `scraper.security.network.allowPrivateNetworks` disabled unless you have an explicit internal use case.
- Keep `scraper.security.fileAccess.mode` at `allowedRoots` or `disabled` unless the host is fully trusted.
- Do not rely on broad local home-directory access for service accounts or containers.

## Outbound Network Access Policy

By default, scraper-driven HTTP and browser requests may reach public internet targets but may not reach private or special-use network targets.

Blocked by default:

- Loopback addresses
- RFC1918 private IPv4 ranges
- Link-local ranges
- Other special-use IPv4 and IPv6 ranges covered by the shared policy

Allowed by default:

- Public internet HTTP and HTTPS targets

Override options:

- `allowedHosts`: hostname-bound exceptions for explicitly targeted internal hosts
- `allowedCidrs`: address-bound exceptions for resolved or direct IP targets
- `allowPrivateNetworks: true`: broad opt-in for private and special-use network access

Important semantics:

- `allowedHosts` does not allow direct IP access to the same service.
- `allowedCidrs` allows by resolved or direct address, not by hostname label alone.
- Redirect targets are revalidated independently.
- Browser subrequests use the same policy as non-browser HTTP fetches.

## TLS Verification Policy

HTTPS certificate validation stays enabled by default.

`allowInvalidTls: true` is a broad override that allows invalid or self-signed certificates for HTTPS requests that are already permitted by the network policy.

Important semantics:

- It does not bypass `allowedHosts`, `allowedCidrs`, or private-network restrictions.
- It applies broadly, so treat it as an environment-level trust decision.
- If you need narrower trust, prefer proper certificates or a future custom-certificate workflow rather than enabling broad invalid TLS trust.

## Local File Access Policy

Local file access defaults to `allowedRoots` mode with `$DOCUMENTS` as the only configured root.

Modes:

- `disabled`: all user-requested `file://` access is blocked
- `allowedRoots`: only configured roots are allowed
- `unrestricted`: local file access is fully trusted

Traversal defaults:

- Hidden files and hidden directories are blocked by default
- Symlinks are blocked by default
- Archive-member paths are validated against the real archive file, not the synthetic combined virtual path

Important semantics:

- `allowedRoots: []` in `allowedRoots` mode means no user-requested local file access is allowed.
- `$DOCUMENTS` is only a convenience token. If it cannot be resolved for the runtime account, it grants no access.
- Hidden paths remain blocked even when explicitly requested unless `includeHidden` is enabled.

## Archive Workflows

Supported web archive scraping downloads an accepted remote archive to a temporary file and then processes it through the local file path.

That handoff remains allowed without requiring the temp directory to be added to user-configured roots. The exception is intentionally narrow:

- It applies only after the original network URL passes the network policy.
- It applies only to the downloaded archive artifact and its virtual members.
- Unrelated temp files remain subject to the normal local file policy.

## Example Configurations

Conservative shared deployment:

```yaml
scraper:
  security:
    network:
      allowPrivateNetworks: false
      allowedHosts: []
      allowedCidrs: []
      allowInvalidTls: false
    fileAccess:
      mode: allowedRoots
      allowedRoots:
        - $DOCUMENTS
      followSymlinks: false
      includeHidden: false
```

Selective internal docs deployment:

```yaml
scraper:
  security:
    network:
      allowPrivateNetworks: false
      allowedHosts:
        - docs.internal.example
      allowedCidrs:
        - 10.42.0.0/16
      allowInvalidTls: true
    fileAccess:
      mode: allowedRoots
      allowedRoots:
        - /srv/docs
      followSymlinks: false
      includeHidden: false
```

Fully trusted local workstation:

```yaml
scraper:
  security:
    network:
      allowPrivateNetworks: true
      allowInvalidTls: false
    fileAccess:
      mode: unrestricted
      allowedRoots: []
      followSymlinks: true
      includeHidden: true
```

## Operational Guidance

- Start with the defaults and add the smallest explicit exception that satisfies the use case.
- Prefer `allowedHosts` and `allowedCidrs` over `allowPrivateNetworks: true`.
- Prefer valid certificates over `allowInvalidTls: true`.
- Prefer narrow `allowedRoots` over `unrestricted` file access.
- Review these settings when moving from local development to shared infrastructure.
