## ADDED Requirements

### Requirement: GitHub Private Repository Authentication

The system SHALL support authentication for private GitHub repositories through a cascading fallback mechanism.

#### Scenario: Explicit Authorization Header

- **WHEN** user provides an `Authorization` header in scraper options
- **THEN** the system MUST use this header for all GitHub API requests
- **AND** the system MUST NOT attempt other authentication methods

#### Scenario: GITHUB_TOKEN Environment Variable

- **WHEN** no explicit Authorization header is provided
- **AND** the `GITHUB_TOKEN` environment variable is set
- **THEN** the system MUST use this token as a Bearer token for GitHub API requests

#### Scenario: GH_TOKEN Environment Variable Fallback

- **WHEN** no explicit Authorization header is provided
- **AND** `GITHUB_TOKEN` is not set
- **AND** `GH_TOKEN` environment variable is set
- **THEN** the system MUST use this token as a Bearer token for GitHub API requests

#### Scenario: Local gh CLI Authentication

- **WHEN** no explicit Authorization header is provided
- **AND** no GitHub token environment variables are set
- **AND** the `gh` CLI is installed and authenticated
- **THEN** the system MUST attempt to retrieve a token via `gh auth token`
- **AND** the system MUST use this token for GitHub API requests

#### Scenario: No Authentication Available

- **WHEN** no authentication method is available
- **THEN** the system MUST proceed without authentication
- **AND** the system MUST NOT throw an error (public repos remain accessible)

### Requirement: User-Friendly Error Messages for Inaccessible Repositories

The system SHALL provide actionable, user-friendly error messages when a GitHub repository cannot be accessed. These errors MUST propagate through the pipeline and be visible in the web UI.

#### Scenario: Repository Not Found or Not Accessible

- **WHEN** the GitHub API returns a 404 response for a repository tree request
- **THEN** the system MUST throw a `ScraperError` with a user-friendly message indicating the repository was not found or is not accessible
- **AND** the message MUST suggest setting the `GITHUB_TOKEN` environment variable for private repositories
- **AND** this error MUST be visible in the web UI job queue

#### Scenario: Insufficient Permissions

- **WHEN** the GitHub API returns a 403 response for a repository request
- **THEN** the system MUST throw a `ScraperError` indicating the token lacks required permissions
- **AND** this error MUST be visible in the web UI job queue

#### Scenario: Malformed API Response

- **WHEN** the GitHub API returns a response that cannot be parsed as JSON
- **THEN** the system MUST throw a `ScraperError` with actionable context about the failure
- **AND** the system MUST NOT expose a raw `SyntaxError` to the user
- **AND** this error MUST be visible in the web UI job queue
