## Context

The `mime` npm package (used via `mime.getType()`) is the standard library for MIME type detection, but it has significant gaps and errors for developer-focused file types:

1. **Returns `null`** for many common extensions (no mapping exists)
2. **Returns incorrect types** that conflict with developer expectations (e.g., `.ts` → `video/mp2t` instead of TypeScript)

This design documents all custom MIME type mappings, their reasoning, and the architectural decision to prioritize our custom mappings over the `mime` package.

## Goals / Non-Goals

**Goals:**
- Ensure all text-based documentation and source code files are correctly identified
- Provide consistent MIME type detection across all code paths
- Enable syntax highlighting for all supported file types
- Document reasoning for each custom mapping

**Non-Goals:**
- Replace the `mime` package entirely (still used as fallback for standard types like images, PDFs, etc.)
- Support binary file type detection
- Make mappings user-configurable (out of scope for this change)

## Decisions

### Decision 1: Custom Mappings Take Priority Over `mime` Package

The `MimeTypeUtils.detectMimeTypeFromPath()` function first checks custom mappings, then falls back to the `mime` package. This is intentional because:

1. The `mime` package is designed for web standards, not developer tooling
2. Many developer file types have no IANA-registered MIME type
3. Some IANA types conflict with developer expectations (e.g., `.ts` is registered for MPEG-2 transport streams)

### Decision 2: Use `text/x-*` Convention for Source Code

Following the convention used by editors and syntax highlighters, source code MIME types use the `text/x-` prefix (e.g., `text/x-python`, `text/x-rust`). This:
- Indicates the content is text-based and safe to display
- Uses the `x-` prefix for unregistered/experimental types
- Aligns with what tools like VS Code and GitHub use internally

### Decision 3: Centralize All Detection in MimeTypeUtils

All file type detection MUST go through `MimeTypeUtils.detectMimeTypeFromPath()`. Direct calls to `mime.getType()` are prohibited outside of `mimeTypeUtils.ts`.

## Custom MIME Type Mappings

### Category 1: Extensions Where `mime` Returns `null` (Not Recognized)

These extensions have no mapping in the `mime` package and would default to `application/octet-stream`:

| Extension | MIME Type | Language | Reasoning |
|-----------|-----------|----------|-----------|
| `.rst` | `text/x-rst` | rst | reStructuredText - Python documentation standard |
| `.adoc`, `.asciidoc` | `text/x-asciidoc` | asciidoc | AsciiDoc markup format |
| `.textile` | `text/x-textile` | textile | Textile markup format |
| `.pod` | `text/x-pod` | pod | Perl documentation format |
| `.rdoc` | `text/x-rdoc` | rdoc | Ruby documentation format |
| `.wiki` | `text/x-wiki` | wiki | Wiki markup |
| `.py`, `.pyw`, `.pyi` | `text/x-python` | python | Python source (already in mappings) |
| `.pyx`, `.pxd` | `text/x-cython` | cython | Cython source files |
| `.tsx` | `text/x-tsx` | tsx | TypeScript JSX (already in mappings) |
| `.mts`, `.cts` | `text/x-typescript` | typescript | TypeScript ES modules/CommonJS |
| `.go` | `text/x-go` | go | Go source (already in mappings) |
| `.kt`, `.kts` | `text/x-kotlin` | kotlin | Kotlin source and scripts |
| `.scala` | `text/x-scala` | scala | Scala source (already in mappings) |
| `.swift` | `text/x-swift` | swift | Swift source (already in mappings) |
| `.rb`, `.rake` | `text/x-ruby` | ruby | Ruby source and Rakefiles |
| `.lua` | `text/x-lua` | lua | Lua source |
| `.pl`, `.pm` | `text/x-perl` | perl | Perl source |
| `.r`, `.R` | `text/x-r` | r | R statistical language |
| `.jl` | `text/x-julia` | julia | Julia source |
| `.hs`, `.lhs` | `text/x-haskell` | haskell | Haskell source |
| `.elm` | `text/x-elm` | elm | Elm source |
| `.erl` | `text/x-erlang` | erlang | Erlang source |
| `.ex`, `.exs` | `text/x-elixir` | elixir | Elixir source |
| `.clj`, `.cljs`, `.cljc` | `text/x-clojure` | clojure | Clojure source |
| `.groovy` | `text/x-groovy` | groovy | Groovy source |
| `.gradle` | `text/x-gradle` | groovy | Gradle build files (Groovy DSL) |
| `.v` | `text/x-v` | v | V language source |
| `.zig` | `text/x-zig` | zig | Zig source |
| `.nim` | `text/x-nim` | nim | Nim source |
| `.cr` | `text/x-crystal` | crystal | Crystal source |
| `.sol` | `text/x-solidity` | solidity | Solidity smart contracts |
| `.move` | `text/x-move` | move | Move smart contracts |
| `.cairo` | `text/x-cairo` | cairo | Cairo smart contracts |
| `.vue` | `text/x-vue` | vue | Vue.js single-file components |
| `.svelte` | `text/x-svelte` | svelte | Svelte components |
| `.astro` | `text/x-astro` | astro | Astro components |
| `.cfg` | `text/x-ini` | ini | Configuration files |
| `.properties` | `text/x-properties` | properties | Java properties files |
| `.env` | `text/x-dotenv` | dotenv | Environment variable files |
| `.dockerfile`, `Dockerfile` | `text/x-dockerfile` | dockerfile | Docker build files (already in mappings) |
| `.containerfile` | `text/x-dockerfile` | dockerfile | Podman container files |
| `.makefile`, `Makefile` | `text/x-makefile` | makefile | Make build files |
| `.cmake` | `text/x-cmake` | cmake | CMake build files |
| `.bazel`, `.bzl` | `text/x-bazel` | bazel | Bazel build files |
| `.buck` | `text/x-buck` | buck | Buck build files |
| `.tf`, `.tfvars` | `text/x-terraform` | hcl | Terraform configuration |
| `.hcl` | `text/x-hcl` | hcl | HashiCorp Configuration Language |
| `.prisma` | `text/x-prisma` | prisma | Prisma schema files |
| `.graphql`, `.gql` | `text/x-graphql` | graphql | GraphQL schemas (already in mappings) |
| `.proto` | `text/x-proto` | protobuf | Protocol Buffers (already in mappings) |
| `.thrift` | `text/x-thrift` | thrift | Apache Thrift IDL |
| `.avro` | `text/x-avro` | avro | Apache Avro schemas |
| `.rmd` | `text/x-rmarkdown` | rmarkdown | R Markdown |

### Category 2: Extensions Where `mime` Returns Incorrect Types

These extensions have IANA-registered types that don't match developer expectations:

| Extension | `mime` Returns | Our Override | Reasoning |
|-----------|---------------|--------------|-----------|
| `.ts` | `video/mp2t` | `text/x-typescript` | MPEG-2 transport stream vs TypeScript |
| `.mts` | `video/mp2t` | `text/x-typescript` | Same issue for TypeScript ES modules |
| `.rs` | `application/rls-services+xml` | `text/x-rust` | RLS services XML vs Rust source |
| `.org` | `application/vnd.lotus-organizer` | `text/x-org` | Lotus Organizer vs Org-mode |
| `.cjs` | `application/node` | `text/javascript` | Node.js type vs JavaScript source |
| `.dart` | `application/vnd.dart` | `text/x-dart` | Dart VM type vs Dart source |
| `.pl`, `.pm` | `application/x-perl` | `text/x-perl` | Application vs text type |
| `.tex` | `application/x-tex` | `text/x-tex` | Application vs text type |
| `.latex` | `application/x-latex` | `text/x-latex` | Application vs text type |
| `.toml` | `application/toml` | `text/x-toml` | Application vs text type |
| `.ini` | `text/plain` | `text/x-ini` | Too generic vs specific type |
| `.conf` | `text/plain` | `text/x-conf` | Too generic vs specific type |

### Category 3: Normalization Rules

For types returned by `mime.getType()` that need correction, add to `mimeTypeNormalization`.
Note: Most of these are defense-in-depth since extensions are checked first in `customMimeTypes`.
These normalizations apply when MIME types are provided externally (e.g., HTTP Content-Type headers).

```typescript
const mimeTypeNormalization: Record<string, string> = {
  "application/node": "text/javascript",           // .cjs files
  "video/mp2t": "text/x-typescript",               // defense-in-depth for .ts/.mts
  "application/rls-services+xml": "text/x-rust",   // .rs files
  "application/vnd.lotus-organizer": "text/x-org", // .org files
  "application/vnd.dart": "text/x-dart",           // .dart files
  "application/x-perl": "text/x-perl",             // .pl/.pm files
  "application/x-tex": "text/x-tex",               // .tex files
  "application/x-latex": "text/x-latex",           // .latex files
  "application/toml": "text/x-toml",               // .toml files
};
```

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| New mappings may conflict with edge cases | Extension-based detection takes priority; `mime` is only fallback |
| Maintenance burden of custom mappings | Document all mappings with reasoning; add tests |
| May miss future file types | Easy to add new mappings; clear pattern established |

## Migration Plan

1. Update `mimeTypeUtils.ts` with new mappings
2. Update consuming files to use `MimeTypeUtils.detectMimeTypeFromPath()`
3. Remove direct `mime` imports from strategy files
4. Add tests for new file types
5. No breaking changes - only improves detection

## Open Questions

None - approach is clear and aligns with existing patterns.
