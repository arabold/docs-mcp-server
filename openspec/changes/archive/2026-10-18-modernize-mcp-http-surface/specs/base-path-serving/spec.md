# Spec Delta

## Purpose

Lets the server run under a path of a shared host, such as `https://example.com/docs` behind a reverse proxy, with every route, asset and advertised URL placed under that path.

## ADDED Requirements

### Requirement: Routes answer under the public URL's path

When the public URL has a path, the server SHALL answer every route both with that path as a prefix and without it:

- the MCP endpoint,
- protected resource metadata,
- the web UI and its assets,
- the HTTP API at `/api` and its WebSocket.

This lets it work both behind proxies that forward the prefix and behind proxies that strip it. When the public URL has no path, routes SHALL be served at the root.

#### Scenario: Proxy forwards the prefix

- **WHEN** the public URL is `https://example.com/docs`
- **AND** a request arrives for `/docs/mcp`
- **THEN** it SHALL be served by the MCP endpoint

#### Scenario: Proxy strips the prefix

- **WHEN** the public URL is `https://example.com/docs`
- **AND** a request arrives for `/mcp`
- **THEN** it SHALL be served by the MCP endpoint

#### Scenario: API and live updates under the prefix

- **WHEN** the public URL is `https://example.com/docs`
- **THEN** an API request to `/docs/api` SHALL be served by the API
- **AND** a WebSocket upgrade at `/docs/api` SHALL establish a subscription connection

### Requirement: The web UI works under the public URL's path

When the public URL has a path, the web UI SHALL load its assets, call the API, open its live-update connection, and navigate, all within that path. A browser opening a deep link below the path SHALL get the UI at that route. The web UI is opened under the public URL's path; opening it at an unprefixed path is not supported.

#### Scenario: Shell references resolve under the path

- **WHEN** the public URL is `https://example.com/docs`
- **AND** a browser loads `https://example.com/docs/`
- **THEN** every script, stylesheet and icon the page references SHALL resolve to a URL under `https://example.com/docs/`

#### Scenario: Deep link

- **WHEN** the public URL is `https://example.com/docs`
- **AND** a browser opens `https://example.com/docs/libraries/react` directly
- **THEN** the web UI SHALL show that library's page
- **AND** every asset and API request the page makes SHALL target a URL under `https://example.com/docs/`

#### Scenario: API and live-update connection

- **WHEN** the public URL is `https://example.com/docs`
- **AND** the web UI is loaded
- **THEN** its API requests SHALL go to `https://example.com/docs/api`
- **AND** its live-update WebSocket SHALL connect to `wss://example.com/docs/api`

#### Scenario: Navigation stays under the path

- **WHEN** the public URL is `https://example.com/docs`
- **AND** a user selects Jobs in the web UI
- **THEN** the browser's address SHALL become `https://example.com/docs/jobs`

### Requirement: The worker link works under a path

A coordinator (`web` or `mcp` with a worker URL) SHALL reach the worker's HTTP API and its event WebSocket at the configured worker URL, path included. The WebSocket URL SHALL be the worker URL with `http`/`https` replaced by `ws`/`wss`, so a reverse proxy that serves the worker under a path reaches both.

#### Scenario: Worker served under a path

- **WHEN** a coordinator's worker URL is `https://example.com/docs/api`
- **THEN** its API calls SHALL go to `https://example.com/docs/api`
- **AND** its event WebSocket SHALL connect to `wss://example.com/docs/api`
- **AND** events the worker emits SHALL reach the coordinator
