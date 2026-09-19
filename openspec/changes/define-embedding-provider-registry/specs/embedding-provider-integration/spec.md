## ADDED Requirements

### Requirement: Provider Registry
The system SHALL describe each supported embedding provider in a single registry entry. An entry SHALL declare the provider's name, the environment variables it reads, whether its credentials can reach the provider SDK without appearing in those variables, and how to construct its embedding client.

The registry SHALL be the only place a provider is described. Credential evaluation and client construction SHALL read from it rather than maintaining their own per-provider branches.

#### Scenario: Registry covers every supported provider
- **WHEN** the set of supported providers is enumerated
- **THEN** every member SHALL have exactly one registry entry

#### Scenario: Adding a provider requires one declaration
- **WHEN** a provider is added to the supported-provider set without a registry entry
- **THEN** the build SHALL fail

### Requirement: Credential Preflight
Before constructing an embedding client, the system SHALL evaluate whether the configuration is provably unusable, using the provider's registry entry:

1. If every required environment variable is present, the system SHALL proceed to construction.
2. If a required environment variable is absent and the provider's credentials may be ambient, the system SHALL proceed to construction. Absence proves nothing, and the live dimension-detection request determines whether the provider works.
3. If a required environment variable is absent and the provider's credentials may not be ambient, the configuration is conclusively unusable and the system SHALL report it.

The system SHALL NOT treat absence of an environment variable as conclusive for a provider whose credentials may be ambient. Ambient sources include AWS instance and task roles, AWS SSO and web identity, Google Application Default Credentials, and OpenAI-compatible endpoints that require no authentication.

What the system does when a configuration is conclusively unusable is governed by **Embedding Failure Policy** below.

#### Scenario: All required credentials present
- **WHEN** the provider is `gemini` and `GOOGLE_API_KEY` is set
- **THEN** the system SHALL proceed to construct the client

#### Scenario: Absent credentials that may be ambient
- **WHEN** the provider is `aws` and neither `AWS_PROFILE` nor `AWS_ACCESS_KEY_ID` is set
- **AND** the `aws` entry declares that credentials may be ambient
- **THEN** the system SHALL proceed to construct the client
- **AND** the system SHALL NOT report missing credentials
- **AND** whether the provider works SHALL be determined by the dimension-detection request

#### Scenario: Absent credentials that may not be ambient
- **WHEN** the provider is `gemini` and `GOOGLE_API_KEY` is not set
- **THEN** the system SHALL report the configuration as conclusively unusable
- **AND** the report SHALL name the environment variables the provider requires

#### Scenario: OpenAI without a key and without a custom endpoint
- **WHEN** the provider is `openai`, `OPENAI_API_KEY` is not set, and `OPENAI_API_BASE` is not set
- **THEN** the system SHALL report the configuration as conclusively unusable
- **AND** the report SHALL state that `api.openai.com` requires an API key

#### Scenario: OpenAI without a key but with a custom endpoint
- **WHEN** the provider is `openai`, `OPENAI_API_KEY` is not set, and `OPENAI_API_BASE` is set
- **THEN** the system SHALL proceed to construct the client
- **AND** the system SHALL NOT report missing credentials
- **AND** a local endpoint requiring no authentication SHALL work without a placeholder key

### Requirement: Embedding Failure Policy
When an embedding model is configured but cannot be used, the system SHALL report the failure prominently and continue in full-text-only mode. The system SHALL NOT refuse to start because embeddings are unavailable — full-text search remains available for every indexed document, and refusing to start would deny it.

This policy SHALL apply uniformly to every reason embeddings cannot be used: credentials conclusively absent, credentials present but rejected, the model unavailable at the provider, the endpoint unreachable, and dimension detection timing out. The system SHALL NOT treat one of these as fatal and another as recoverable.

The report SHALL name the provider, state the specific reason, and state that documents indexed while vector search is disabled are stored without embeddings and require re-indexing once the problem is resolved.

When no embedding model is configured, the absence is a deliberate opt-out. The system SHALL proceed in full-text-only mode without reporting a failure.

This requirement does not govern `EmbeddingModelChangedError`, which signals that stored vectors would be invalidated rather than that embeddings are unavailable. Its handling is specified by the `embedding-model-change-safety` capability and is unchanged.

#### Scenario: Credentials conclusively absent
- **WHEN** the provider is `gemini`, `GOOGLE_API_KEY` is not set, and `gemini` credentials may not be ambient
- **THEN** the system SHALL report the failure prominently
- **AND** the system SHALL start in full-text-only mode

#### Scenario: Credentials present but rejected
- **WHEN** an embedding model is configured with credentials the provider rejects
- **THEN** the system SHALL report the authentication failure prominently
- **AND** the system SHALL start in full-text-only mode
- **AND** the system SHALL NOT abort startup

#### Scenario: Endpoint unreachable
- **WHEN** `OPENAI_API_BASE` points at a local server that is not running
- **THEN** the system SHALL report the connection failure prominently
- **AND** the system SHALL start in full-text-only mode

#### Scenario: Ambient credentials resolve successfully
- **WHEN** the provider is `aws`, no credential environment variables are set, and an instance role supplies credentials
- **THEN** the dimension-detection request SHALL succeed
- **AND** the system SHALL enable vector search
- **AND** the system SHALL NOT report a failure

#### Scenario: No embedding model configured
- **WHEN** no embedding model is configured
- **THEN** the system SHALL proceed in full-text-only mode
- **AND** the system SHALL NOT report a failure

#### Scenario: Report names the re-indexing consequence
- **WHEN** the system reports that embeddings are unavailable
- **THEN** the report SHALL state that documents indexed while vector search is disabled will not have embeddings
- **AND** the report SHALL state that those documents require re-indexing once embeddings are working

### Requirement: Client Construction Invariants
Each registry entry SHALL construct its provider's client such that the following hold. These invariants are specified because violating any of them produces incorrect behavior without an error.

- **Float encoding.** Clients for OpenAI-compatible endpoints SHALL request plain float arrays rather than accepting the SDK default. The OpenAI SDK otherwise requests base64 and unconditionally decodes the response; OpenAI-compatible servers that ignore the parameter return JSON floats, which the decoder converts into a vector a quarter of the expected length with every element zero.
- **Azure deployment mapping.** For `microsoft`, the resolved model name SHALL be used as the Azure deployment name.
- **Truncation wrapping.** `gemini` SHALL be wrapped so that oversized vectors are truncated to the configured dimension, which is valid for its Matryoshka Representation Learning models. No other provider SHALL be wrapped with truncation allowed.
- **Custom endpoint.** For `openai`, when `OPENAI_API_BASE` is set, the client SHALL direct requests to that endpoint.
- **AWS region precedence.** For `aws`, `BEDROCK_AWS_REGION` SHALL take precedence over `AWS_REGION`.

Batch sizes, request timeouts, and newline handling are tuning parameters, not requirements, and may change without a specification update.

#### Scenario: OpenAI-compatible client requests float encoding
- **WHEN** a client is constructed for the `openai` provider
- **THEN** the client SHALL be configured to request float-encoded embeddings

#### Scenario: Azure uses the model name as the deployment name
- **WHEN** the model specification is `microsoft:my-deployment`
- **THEN** the constructed client SHALL target the Azure deployment `my-deployment`

#### Scenario: Gemini is wrapped with truncation allowed
- **WHEN** a client is constructed for the `gemini` provider
- **THEN** the client SHALL truncate oversized vectors to the configured dimension

#### Scenario: Other providers are not wrapped with truncation allowed
- **WHEN** a client is constructed for `openai`, `vertex`, `aws`, or `microsoft`
- **THEN** the client SHALL NOT truncate oversized vectors
- **AND** an oversized vector SHALL raise a `DimensionError`

#### Scenario: Custom endpoint redirects requests
- **WHEN** the provider is `openai` and `OPENAI_API_BASE` is set to a local server
- **THEN** embedding requests SHALL be sent to that server rather than to `api.openai.com`

#### Scenario: Bedrock region precedence
- **WHEN** the provider is `aws`, `BEDROCK_AWS_REGION` is `us-west-2`, and `AWS_REGION` is `us-east-1`
- **THEN** the constructed client SHALL use `us-west-2`

### Requirement: Construction Completeness
Every supported provider SHALL be constructible. The system SHALL NOT offer a provider prefix for which no client can be created.

A provider added to the supported-provider set without a means of construction SHALL fail the build rather than failing at startup.

#### Scenario: Every supported provider constructs a client
- **WHEN** a model specification names any provider in the supported-provider set
- **AND** that provider's credential requirements are satisfied
- **THEN** the system SHALL construct an embedding client for it
- **AND** the system SHALL NOT raise `UnsupportedProviderError`

#### Scenario: Provider added without construction support
- **WHEN** a provider is added to the supported-provider set with no way to construct its client
- **THEN** the build SHALL fail
