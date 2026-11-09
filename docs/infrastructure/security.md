# Infrastructure Security

The server fetches remote URLs and reads local files on request. That gives it three security surfaces, each with its own controls:

1. Inbound requests to the MCP endpoint, the web UI and the API, guarded by host and origin checks and by authentication on the MCP endpoint.
2. Outbound requests the scraper makes, over plain HTTP or in a browser, governed by `scraper.security.network`.
3. Local files the scraper reads through `file://` URLs, governed by `scraper.security.fileAccess`.

Authentication decides who may call MCP tools. It does not limit where the scraper connects or which files it reads. [Configuration](../setup/configuration.md#scraper-security-scrapersecurity) lists every scraper security setting with its default.

## Deployment Checklist

For a deployment that other people or other machines can reach:

- Enable [authentication](./authentication.md) on the MCP endpoint.
- Put the web UI and the API behind a reverse proxy's sign-in, or keep them on a private network. Authentication does not cover them. See [Protecting the Web UI and API](./reverse-proxy.md#protecting-the-web-ui-and-api).
- Keep a separate worker and the coordinators' `--server-url` link on a private network. That link has no authentication.
- Terminate TLS at a reverse proxy. The server itself speaks plain HTTP.
- Leave `allowPrivateNetworks` off. Name the internal hosts or ranges the scraper needs in `allowedHosts` or `allowedCidrs`.
- Limit file access to a directory that holds only documentation, or turn it off.
- Use valid certificates rather than `allowInvalidTls`.

## Inbound Requests

Every request and WebSocket upgrade passes a host check. The server refuses (`403`) a `Host` header that names a host it doesn't know, which stops DNS rebinding: a page on an attacker's domain that resolves to this server still names that domain as its host. [Host Names the Server Answers To](../setup/configuration.md#host-names-the-server-answers-to) lists the names it accepts.

The MCP endpoint also checks the browser `Origin` header. It accepts loopback origins, the public URL's origin and the origins in `server.allowedOrigins`, and refuses others with `403`. A request without an `Origin` header comes from a client that is not a browser and passes. The server answers CORS preflights from allowed origins itself. [Browser-Based MCP Clients](./reverse-proxy.md#browser-based-mcp-clients) shows how to allow a hosted client.

The API at `/api` and its WebSocket apply the same origin check when the server binds a loopback address, where no proxy stands between the server and a local browser. On other binds they rely on the reverse proxy or the private network in front of the server.

[What Authentication Protects](./authentication.md#what-authentication-protects) lists each surface and how to protect the ones authentication does not cover. `createHostPolicy` and `createOriginPolicy` in [src/app/originPolicy.ts](../../src/app/originPolicy.ts) implement both checks.

## Outbound Network Access

`scraper.security.network` applies to every request the scraper makes: plain HTTP fetches, browser navigations, and the requests a page makes while it renders in the browser. The target of each redirect is checked again as a new request, so a host that passed does not vouch for the host it redirects to.

In `open` mode, the default, the scraper reaches public addresses and no private or special-use ones: loopback, the RFC 1918 private ranges, link-local, shared address space, multicast, and the other reserved IPv4 and IPv6 ranges listed in [src/utils/accessPolicy.ts](../../src/utils/accessPolicy.ts). `allowPrivateNetworks: true` opens all of them at once. `allowedHosts` and `allowedCidrs` open single hosts and ranges instead.

In `allowlist` mode, the scraper reaches only what `allowedHosts` and `allowedCidrs` name. `allowPrivateNetworks` has no effect there.

A request is decided by its target:

- An IP address is checked by address alone. `allowedHosts` never matches it, so allowing a host name does not allow its IP. In `open` mode the address passes unless it is special-use and outside `allowedCidrs`. In `allowlist` mode it must lie inside `allowedCidrs`.
- A host name that matches `allowedHosts` passes, together with its DNS answers, even when they point to private addresses. Listing a host trusts that name and its DNS.
- Any other host name is resolved first. In `open` mode, every special-use address among the answers must lie inside `allowedCidrs`. In `allowlist` mode, every answer must.

`allowedHosts` entries are literal host names, globs such as `*.example.com` or `docs.*`, or regular expressions wrapped in `/.../`. They match the bare host name, which is compared in lower case. `*.example.com` matches subdomains but not `example.com` itself, so list both when both are needed. A regular expression matches anywhere in the name unless it is anchored, as in `/^docs\d+\.example\.com$/`.

## TLS Verification

The scraper verifies HTTPS certificates. `allowInvalidTls: true` turns verification off for every HTTPS request the network policy already allows, in plain fetches and in the browser. It never makes another target reachable. Because it applies to every host, it trusts any certificate the network path presents.

## Local File Access

`scraper.security.fileAccess.mode` is one of:

- `allowedRoots`, the default: the scraper reads files only inside the directories in `allowedRoots`, which defaults to `$DOCUMENTS`.
- `disabled`: the scraper reads no `file://` URL a user asks for.
- `unrestricted`: no directory limit.

In every mode:

- A path with a symlink anywhere along it is refused. `followSymlinks: true` follows symlinks instead. In `allowedRoots` mode the resolved path must still lie inside an allowed root; in `unrestricted` mode a symlink may resolve anywhere.
- A file or directory whose name starts with a dot is refused when it lies below the allowed root, and so is a hidden entry inside an archive. A root may itself sit under a hidden directory, such as `~/.config/docs`. In `unrestricted` mode the whole path is checked. `includeHidden: true` lifts this rule.
- A file inside an archive (`.zip`, `.tar`, `.gz`, `.tgz`) is checked by the path of the archive file.

Roots are absolute paths or tokens. `$HOME` grants the whole home directory, and only the hidden-file rule keeps directories such as `.ssh` and `.aws` out. `$CWD` grants the working directory. `$DOCUMENTS`, `$DOWNLOADS` and `$DESKTOP` stand for `Documents`, `Downloads` and `Desktop` in the home directory and grant nothing when that folder does not exist. Containers and headless hosts often have none of them, so the default blocks all local files there: set `allowedRoots` to the directory to index, such as `/srv/docs`. An empty `allowedRoots` list blocks all local files. The server logs a warning for each root that does not resolve.

A refused path gets an error that names the requested URL and the rule that blocked it, and links to the configuration documentation. The error reaches MCP clients and the web UI, so it leaves out the configured roots and what they resolve to; those go to the server log instead.

When a web scrape accepts a remote archive, it downloads the archive to a temporary file and reads it through the local file path. That file and its members are readable without a configured root. The exception covers only the downloaded archive, and only after its URL passed the network policy.

## Example

A hosted MCP deployment that indexes a fixed set of public sites and no local files:

```yaml
scraper:
  security:
    network:
      mode: allowlist
      allowedHosts:
        - docs.python.org
        - "*.rust-lang.org"
    fileAccess:
      mode: disabled
```

[Security Examples](../setup/configuration.md#security-examples) has more configurations.
