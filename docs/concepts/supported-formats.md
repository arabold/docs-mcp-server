# Supported Formats

The server processes a wide range of file formats through a pipeline architecture. Each content type is routed to a specialized pipeline that extracts text, preserves structure, and produces searchable chunks.

## Pipeline Routing

Content is routed to the first pipeline whose `canProcess()` method matches the MIME type. Pipelines are evaluated in this order:

| Priority | Pipeline | Purpose | Output |
|----------|----------|---------|--------|
| 1 | JsonPipeline | JSON documents | JSON (structural splitting) |
| 2 | SourceCodePipeline | Programming languages | Source code (AST-aware or line-based splitting) |
| 3 | DocumentPipeline | Binary and rich documents | Markdown (converted via Kreuzberg) |
| 4 | HtmlPipeline | Web pages | Markdown (converted via middleware chain) |
| 5 | MarkdownPipeline | Markdown files | Markdown (passthrough with metadata extraction) |
| 6 | TextPipeline | Universal fallback | Plain text (line-based splitting) |

**Code Reference:**
- `src/scraper/pipelines/PipelineFactory.ts` - Pipeline ordering and selection
- `src/utils/mimeTypeUtils.ts` - MIME type classification functions

## Archives

Archive files are treated as content sources, not as a file format to extract text from. When the server encounters an archive, it unpacks the contents and processes each file individually through the appropriate pipeline.

Archives are supported as input for both local file scraping (`file://` URLs) and web scraping (when an archive URL is the scrape target).

| Format | Extensions | Library |
|--------|------------|---------|
| ZIP | `.zip` | `yauzl` |
| TAR | `.tar` | `tar` |
| Gzipped TAR | `.tar.gz`, `.tgz` | `tar` |

**Code Reference:**
- `src/utils/archive/ZipAdapter.ts` - ZIP extraction
- `src/utils/archive/TarAdapter.ts` - TAR/gzip extraction
- `src/utils/archive/ArchiveFactory.ts` - Format detection (extension-based)
- `src/scraper/strategies/LocalFileStrategy.ts` - Archive entry enumeration and processing

## Documents

The DocumentPipeline uses [Kreuzberg](https://github.com/nichochar/kreuzberg) (`@kreuzberg/node`) to extract content from binary and rich document formats. All documents are converted to Markdown. For spreadsheets, Kreuzberg's pre-rendered table Markdown is preferred over flat text extraction.

Documents are subject to a configurable size limit (`scraper.document.maxSize`, default 10 MB).

| Format | Extensions | MIME Type |
|--------|------------|-----------|
| PDF | `.pdf` | `application/pdf` |
| Word (modern) | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Word (legacy) | `.doc` | `application/msword` |
| Excel (modern) | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Excel (legacy) | `.xls` | `application/vnd.ms-excel` |
| PowerPoint (modern) | `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| PowerPoint (legacy) | `.ppt` | `application/vnd.ms-powerpoint` |
| OpenDocument Text | `.odt` | `application/vnd.oasis.opendocument.text` |
| OpenDocument Spreadsheet | `.ods` | `application/vnd.oasis.opendocument.spreadsheet` |
| OpenDocument Presentation | `.odp` | `application/vnd.oasis.opendocument.presentation` |
| Rich Text Format | `.rtf` | `application/rtf`, `text/rtf` |
| EPUB | `.epub` | `application/epub+zip` |
| FictionBook | `.fb2` | `application/x-fictionbook+xml` |
| Jupyter Notebook | `.ipynb` | `application/x-ipynb+json` |

**Code Reference:**
- `src/scraper/pipelines/DocumentPipeline.ts` - Kreuzberg integration and content extraction
- `src/utils/mimeTypeUtils.ts` - `isSupportedDocument()` gate function

## Web Pages

The HtmlPipeline converts HTML to Markdown through a multi-stage middleware chain: optional Playwright rendering for JavaScript-heavy pages, DOM parsing, metadata extraction, link discovery, content sanitization, URL normalization, and Markdown conversion.

| Format | Extensions | MIME Type |
|--------|------------|-----------|
| HTML | `.html`, `.htm` | `text/html` |
| XHTML | `.xhtml` | `application/xhtml+xml` |

**Code Reference:** `src/scraper/pipelines/HtmlPipeline.ts`

## Markdown

The MarkdownPipeline processes Markdown files with frontmatter and metadata extraction. Content passes through to the semantic splitter with minimal transformation.

| Format | Extensions | MIME Type |
|--------|------------|-----------|
| Markdown | `.md`, `.markdown`, `.mkd`, `.mkdn`, `.mkdown`, `.mdown`, `.mdwn`, `.ronn`, `.gfm` | `text/markdown`, `text/x-markdown`, `text/x-gfm` |
| MDX | `.mdx` | `text/mdx` |

**Code Reference:** `src/scraper/pipelines/MarkdownPipeline.ts`

## JSON

The JsonPipeline validates JSON structure and applies hierarchical splitting that preserves object and array boundaries for context-aware chunking.

| Format | Extensions | MIME Type |
|--------|------------|-----------|
| JSON | `.json` | `application/json`, `text/json`, `text/x-json` |

**Code Reference:** `src/scraper/pipelines/JsonPipeline.ts`

## Source Code

The SourceCodePipeline handles programming languages with language detection. TypeScript, JavaScript, and Python use full tree-sitter AST parsing for structure-aware splitting. All other languages use line-based splitting.

### Languages with AST-Aware Splitting

These languages use tree-sitter for semantic boundary detection (function, class, and module boundaries):

| Language | Extensions |
|----------|------------|
| TypeScript | `.ts`, `.mts`, `.cts` |
| TSX | `.tsx` |
| JavaScript | `.js`, `.cjs`, `.mjs` |
| JSX | `.jsx` |
| Python | `.py`, `.pyw`, `.pyi` |

### Languages with Line-Based Splitting

These languages are recognized and processed with line-based splitting:

| Category | Languages | Extensions |
|----------|-----------|------------|
| Systems | C | `.c`, `.h` |
| | C++ | `.cpp`, `.cxx`, `.cc`, `.hpp`, `.hxx` |
| | Go | `.go` |
| | Rust | `.rs` |
| | Zig | `.zig` |
| | Nim | `.nim` |
| | V | `.v` |
| | Crystal | `.cr` |
| JVM | Java | `.java` |
| | Kotlin | `.kt`, `.kts` |
| | Scala | `.scala` |
| | Groovy | `.groovy`, `.gradle` |
| .NET | C# | `.cs` |
| Apple/Mobile | Swift | `.swift` |
| | Dart | `.dart` |
| Scripting | Ruby | `.rb`, `.rake` |
| | PHP | `.php` |
| | Lua | `.lua` |
| | Perl | `.pl`, `.pm` |
| | R | `.r` |
| | Cython | `.pyx`, `.pxd` |
| Functional | Haskell | `.hs`, `.lhs` |
| | Elm | `.elm` |
| | Erlang | `.erl` |
| | Elixir | `.ex`, `.exs` |
| | Clojure | `.clj`, `.cljs`, `.cljc` |
| | Julia | `.jl` |
| Shell | Bash | `.sh`, `.bash`, `.zsh`, `.fish` |
| | PowerShell | `.ps1` |
| Web Frameworks | Vue | `.vue` |
| | Svelte | `.svelte` |
| | Astro | `.astro` |
| Stylesheets | CSS | `.css` |
| | SCSS | `.scss` |
| | Sass | `.sass` |
| | Less | `.less` |
| Web3 | Solidity | `.sol` |
| | Move | `.move` |
| | Cairo | `.cairo` |

**Code Reference:**
- `src/scraper/pipelines/SourceCodePipeline.ts` - Language detection and splitting
- `src/utils/mimeTypeUtils.ts` - `extractLanguageFromMimeType()` mapping

## Markup and Documentation Formats

These lightweight markup languages are processed as source code (line-based splitting), not as Markdown:

| Format | Extensions |
|--------|------------|
| reStructuredText | `.rst` |
| AsciiDoc | `.adoc`, `.asciidoc` |
| Org Mode | `.org` |
| Textile | `.textile` |
| Pod | `.pod` |
| RDoc | `.rdoc` |
| Wiki | `.wiki` |
| R Markdown | `.rmd` |

## Configuration and Data Formats

These formats are processed as source code with language detection:

| Category | Format | Extensions |
|----------|--------|------------|
| Config | TOML | `.toml` |
| | INI | `.ini`, `.cfg` |
| | General config | `.conf` |
| | Properties | `.properties` |
| | Dotenv | `.env` |
| Build Systems | Dockerfile | `.dockerfile`, `.containerfile` |
| | Makefile | `.makefile` |
| | CMake | `.cmake` |
| | Bazel | `.bazel`, `.bzl` |
| | Buck | `.buck` |
| IaC | Terraform | `.tf`, `.tfvars` |
| | HCL | `.hcl` |
| Data/Query | SQL | `.sql` |
| | GraphQL | `.graphql`, `.gql` |
| | XML | `.xml` |
| | YAML | `.yaml`, `.yml` |
| Schema/API | Protocol Buffers | `.proto` |
| | Prisma | `.prisma` |
| | Thrift | `.thrift` |
| | Avro | `.avro` |
| TeX | TeX | `.tex` |
| | LaTeX | `.latex` |

## Text Fallback

The TextPipeline acts as a universal fallback for any `text/*` MIME type not claimed by a higher-priority pipeline. It rejects binary content via null-byte detection.

Common formats handled by the text fallback:

| Format | Extensions |
|--------|------------|
| Plain text | `.txt` |
| CSV | `.csv` |
| TSV | `.tsv` |
| Log files | `.log` |

## MIME Type Detection

File format detection uses a layered approach:

1. **HTTP Content-Type header** (for web content)
2. **`detectMimeTypeFromPath()`** - Extension-based detection using the `mime` package supplemented with custom mappings for formats the `mime` package misidentifies (e.g., `.ts` files detected as MPEG-2 transport streams)
3. **Content sniffing** - Binary detection via null-byte scanning

URL query parameters and hash fragments are stripped before extension detection, so `report.pdf?token=abc` correctly resolves to `application/pdf`.

### MIME Type Normalization

Some external MIME types (from HTTP headers or OS detection) are automatically corrected:

| External MIME Type | Corrected To | Reason |
|---|---|---|
| `video/mp2t` | `text/x-typescript` | `.ts` / `.mts` MPEG-2 conflict |
| `application/node` | `text/javascript` | `.cjs` files |
| `application/rls-services+xml` | `text/x-rust` | `.rs` files |
| `application/vnd.lotus-organizer` | `text/x-org` | `.org` files |
| `application/vnd.dart` | `text/x-dart` | `.dart` files |
| `application/x-perl` | `text/x-perl` | `.pl` / `.pm` files |
| `application/x-tex` | `text/x-tex` | `.tex` files |
| `application/x-latex` | `text/x-latex` | `.latex` files |
| `application/toml` | `text/x-toml` | `.toml` files |

**Code Reference:** `src/utils/mimeTypeUtils.ts` - `normalizeMimeType()` and `detectMimeTypeFromPath()`
