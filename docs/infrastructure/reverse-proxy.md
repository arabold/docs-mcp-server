# Reverse Proxy Deployment

The Docs MCP Server can run behind a reverse proxy, at the root of its own host (`https://docs.example.com`) or under a path of a shared host (`https://example.com/docs`).

## Tell the Server Where It Lives

Set `server.publicUrl` to the URL clients use:

```bash
npx @arabold/docs-mcp-server@latest --host 127.0.0.1 --public-url https://example.com/docs
```

Every URL the server advertises derives from it: the MCP endpoint in startup output and the web UI, the authentication metadata, and the URLs the web UI calls. Without it, the server can only describe its bind address, which clients behind a proxy can't reach. On a loopback bind it also refuses API requests from the public host's pages, because it can't know that host is its own.

The server answers every route both with the path prefix and without it. So it works whether the proxy strips `/docs` before forwarding (the common nginx and Traefik setup) or passes it through. The path's first segment must not be one of the server's own routes (`mcp`, `api`, `assets`, `.well-known`).

Open the web UI under the path, e.g. `https://example.com/docs/`. With a base path configured, the UI doesn't load at unprefixed URLs.

## What the Proxy Must Pass Through

- **Streaming responses, unbuffered.** MCP responses may be event streams. The server marks them `X-Accel-Buffering: no`, and turning buffering off for the location makes sure.
- **WebSocket upgrades** on `<path>/api`, for the web UI's live updates.
- **The original `Host` header**, or an upstream address the server answers to. The server refuses host names it doesn't know (see [Host Names the Server Answers To](../setup/configuration.md#host-names-the-server-answers-to)). nginx with `proxy_set_header Host $host` and Traefik's default both send the public host.
- **The host-root metadata location**, when authentication is enabled and the server lives under a path. RFC 9728 places the metadata at `/.well-known/oauth-protected-resource/docs/mcp` on the host root, outside `/docs/`. MCP clients use the URL from the server's `401` challenge first, which lives under `/docs/`. The extra rule is for clients that skip it.

## nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name example.com;
    # ssl_certificate ...;

    location = /docs {
        return 301 /docs/;
    }

    # Everything under /docs/: prefix stripped by the trailing slash on proxy_pass
    location /docs/ {
        proxy_pass http://127.0.0.1:6280/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }

    # RFC 9728 metadata at the host root (only needed with authentication)
    location = /.well-known/oauth-protected-resource/docs/mcp {
        proxy_pass http://127.0.0.1:6280;
    }
}
```

Keep the trailing slash on `proxy_pass http://127.0.0.1:6280/;`: it strips `/docs`. Without it nginx forwards the prefix, which also works, since the server accepts both.

## Traefik

File provider (dynamic configuration):

```yaml
http:
  routers:
    docs:
      rule: "Host(`example.com`) && (Path(`/docs`) || PathPrefix(`/docs/`))"
      middlewares: [docs-strip]
      service: docs
    docs-metadata: # only needed with authentication
      rule: "Host(`example.com`) && Path(`/.well-known/oauth-protected-resource/docs/mcp`)"
      service: docs
  middlewares:
    docs-strip:
      stripPrefix:
        prefixes: ["/docs"]
  services:
    docs:
      loadBalancer:
        servers:
          - url: "http://docs-mcp:6280"
```

Traefik streams responses and upgrades WebSockets without extra settings. To pass the prefix through instead of stripping it, drop the `docs-strip` middleware.

With Docker labels, the same routers and middleware become `traefik.http.routers.docs.rule`, `traefik.http.middlewares.docs-strip.stripprefix.prefixes=/docs`, and so on. The container runs with `--host 0.0.0.0 --public-url https://example.com/docs`.

## Protecting the Web UI and API

The server's own authentication covers the MCP endpoint only; see [Authentication](./authentication.md). Put the web UI and `/api` behind your proxy's sign-in, for example OAuth2-Proxy, Authelia, Traefik `forwardAuth`, nginx `auth_request`, or Cloudflare Access.

Exclude the MCP endpoint and its metadata from that sign-in (`/docs/mcp`, `/docs/.well-known/`, and the host-root metadata location). MCP clients authenticate there with bearer tokens and can't complete a browser sign-in.

## Browser-Based MCP Clients

The MCP endpoint accepts browser requests from loopback origins, from the public URL's origin, and from origins listed in `server.allowedOrigins`. A hosted browser-based client, such as a web app calling the server directly, must be listed there:

```bash
DOCS_MCP_SERVER_ALLOWED_ORIGINS='["https://inspector.example.com"]'
```

The server answers CORS preflights for allowed origins itself, so the proxy needs no CORS configuration.
