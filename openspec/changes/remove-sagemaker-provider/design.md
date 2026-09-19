# Design: remove the sagemaker provider

## Context

`sagemaker` entered the codebase on 2025-09-20 in `83bc1ac` ("vector search and embeddings are optional now"). That commit introduced `areCredentialsAvailable` and, in the same pass, added `sagemaker` to three places:

| Location | Added | Ever implemented |
|---|---|---|
| `EmbeddingProvider` union | yes | — |
| `areCredentialsAvailable` switch | yes | — |
| `UnsupportedProviderError` message's provider list | yes | — |
| `createEmbeddingModel` switch | **no** | never |

`git log -S sagemaker` over `EmbeddingFactory.ts` shows no commit that ever added and later removed a creation branch. It has been aspirational for its whole existence.

The practical effect: `sagemaker:my-endpoint` passes the credential gate (given `AWS_REGION` plus a profile or key pair), reaches `createEmbeddingModel`, falls through the switch, and throws `UnsupportedProviderError` — while the error message it throws lists `sagemaker` among the supported providers.

## Why finishing it is not a small job

Two independent blockers.

**No library support.** `@langchain/aws@1.4.3` exports a single embeddings class, `BedrockEmbeddings`. There is no SageMaker equivalent, `@aws-sdk/client-sagemaker-runtime` is not a dependency, and `@langchain/community` (where LangChain's SageMaker wrapper lives, and where it is an LLM rather than an embeddings model) is not installed either. Implementing this means a new dependency plus a hand-written `Embeddings` subclass.

**No standard wire format.** This is the real obstacle.

```
   BEDROCK                              SAGEMAKER
   ════════════════════════             ════════════════════════

   "amazon.titan-embed-text-v2:0"       "my-endpoint"
              │                                  │
              ▼                                  ▼
   model id fully determines           endpoint names a container
   the request and response            you deployed — HF TEI, DJL,
   schema                              a custom server — each with
                                       its own payload schema
              │                                  │
              ▼                                  ▼
   a model spec string is              a model spec string is NOT
   sufficient                          sufficient
```

A SageMaker endpoint is an address, not a contract. LangChain's own SageMaker support requires the caller to supply a `ContentHandler` implementing `transformInput` and `transformOutput`, because nothing about the endpoint name reveals how to serialize a request to it. Our configuration surface is a single model specification string, which cannot carry that.

Supporting SageMaker therefore requires designing a new configuration surface — a content-handler selector (`embeddings.sagemaker.format: tei | djl | …`) or user-supplied transform code — and that design cannot be assumed while writing a provider-handling specification.

## Decision

Remove it.

The alternative reading of "implement it properly" is "stop advertising something that does not work." Removal is a three-line deletion plus documentation, carries zero user risk because no working configuration can exist, and unblocks the provider specification that motivated this investigation.

If SageMaker is wanted later, it returns as its own change with the content-handler design attached — which is where that decision belongs anyway.

## Consequence: exhaustiveness moves to compile time

With `sagemaker` gone, every member of `EmbeddingProvider` has a `createEmbeddingModel` branch. Because `splitModelSpec` can only ever return a member of that union, the switch's `default` branch becomes unreachable through any real path.

That is an upgrade, not a loss. The `default` branch was a runtime guard against a provider added to the union without a matching branch — it fired at a user's startup. Narrowing `provider` to `never` in the default case moves the same guard to `npm run typecheck`:

```ts
default: {
  const _exhaustive: never = provider;
  throw new UnsupportedProviderError(_exhaustive);
}
```

Adding a provider to `SUPPORTED_PROVIDERS` without a creation branch now fails the build. This supersedes the reasoning recorded in `fix-embedding-model-spec-parsing`, which argued for keeping the runtime branch precisely because `sagemaker` reached it.

The `UnsupportedProviderError` class is retained and thrown from that assertion. Keeping it costs nothing, preserves the existing handling in `src/cli/main.ts` and `src/store/DocumentStore.ts`, and leaves a runtime backstop if a future refactor reintroduces a path that constructs a provider value without passing through `splitModelSpec`.

## The known-dimension entries stay

`EmbeddingConfig.ts` labels three entries `// SageMaker models (hosted on AWS SageMaker)`:

```
"intfloat/multilingual-e5-large": 1024,
"multilingual-e5-large": 1024,
"text-embedding-multilingual-e5-large": 1024,
```

These are ordinary open-weight model names. They are servable from Ollama, LM Studio, llama.cpp, a HuggingFace TEI container, or any other OpenAI-compatible endpoint, and their dimensions are correct regardless of where they are hosted. Only the comment is wrong — it describes one possible host as though it were the model's provider. Relabel the group and keep the entries.

## Alternatives considered

**Implement SageMaker now.** Rejected for this change: it requires a new dependency and a configuration-surface design, and it would hold the provider specification hostage to that design. It remains a viable future change.

**Keep it and specify it as unimplemented.** This is the status quo. It forces `embedding-resolution` to carry requirements and scenarios whose only purpose is to describe a provider that always fails, and it leaves the error message contradicting itself. Rejected.

**Keep the union entry but remove the credential branch,** so it fails earlier. Rejected: it still advertises the provider in the list and in the error message, and the failure mode ("no credentials found for sagemaker") would be actively misleading.
