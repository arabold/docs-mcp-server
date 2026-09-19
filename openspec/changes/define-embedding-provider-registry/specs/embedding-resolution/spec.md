## ADDED Requirements

### Requirement: Default Model Validity
The built-in default embedding model SHALL be usable on a fresh installation with no configuration beyond provider credentials. It SHALL satisfy all of the following:

1. **Resolves to the `openai` provider**, so that it works against OpenAI and against any OpenAI-compatible endpoint without a provider prefix.
2. **Has dimensions recorded in the known-dimensions table**, so that a first run determines its vector width without contacting a provider. A default whose dimensions are unknown would require a live embedding request before the vector table can be created, which fails on an offline or air-gapped first start.
3. **Has dimensions not exceeding the built-in default vector dimension**, so that a first run cannot fail with a `DimensionError` before any document is indexed.

Changing the default model SHALL preserve all three properties. The default SHALL have a single definition; no component may carry its own fallback copy of the default model name.

#### Scenario: Default model dimensions are known without a provider request
- **WHEN** a fresh installation starts with no embedding model configured
- **THEN** the default model's dimensions SHALL be resolved from the known-dimensions table
- **AND** the system SHALL NOT issue an embedding request to determine them

#### Scenario: Default model fits the default vector dimension
- **WHEN** the built-in default embedding model and the built-in default vector dimension are compared
- **THEN** the model's known dimensions SHALL NOT exceed the default vector dimension

#### Scenario: Default model changed to one with unknown dimensions
- **WHEN** the built-in default is changed to a model absent from the known-dimensions table
- **THEN** the build SHALL fail

#### Scenario: Default model changed to one that exceeds the default dimension
- **WHEN** the built-in default is changed to a model whose known dimensions exceed the default vector dimension
- **THEN** the build SHALL fail

## REMOVED Requirements

### Requirement: Credential Validation
**Reason:** Superseded by **Credential Preflight** in the new `embedding-provider-integration` capability.

The removed requirement treated the absence of a provider's environment variables as proof that the provider could not work. That is false for every provider whose credentials can arrive from ambient sources — AWS instance and task roles, SSO and web identity, Google Application Default Credentials — and for OpenAI-compatible endpoints that require no authentication at all, which is why local setups were told to configure a placeholder key.

It also fixed a failure policy that contradicted the rest of the system: absent credentials degraded silently to full-text-only mode, while credentials that were present but rejected failed hard at the first embedding request.

`embedding-provider-integration` replaces it with a rule that distinguishes a configuration that is provably unusable from one whose credentials may arrive at call time, and that applies one failure policy to both.

**Migration:** the provider-to-environment-variable table moves to the provider registry, where each provider additionally declares whether its credentials may be ambient. The `OpenAI with custom endpoint` scenario is preserved as `Custom endpoint redirects requests` under **Client Construction Invariants**.
