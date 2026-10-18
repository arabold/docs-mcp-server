# Supported Formats

What the server indexes depends on each item's MIME type. Each content pipeline declares the MIME types it reads. The first pipeline in a fixed order that accepts an item's type processes it, and an item that no pipeline accepts is skipped. [Content Processing](content-processing.md) describes how the pipelines work.

## How an Item Gets Its MIME Type

| Source | MIME type comes from |
|:-------|:---------------------|
| Websites | The response's `Content-Type` header; a URL with a Markdown extension served as `text/plain` counts as Markdown |
| Local files and archive entries | The file extension |
| GitHub repositories | The file extension, when it is known and `raw.githubusercontent.com` answers `text/plain` or `application/octet-stream`; otherwise the header |

`MimeTypeUtils.detectMimeTypeFromPath()` looks an extension up in the project's own table, `CUSTOM_MIME_TYPES`, and then in the `mime` package. The table covers formats the `mime` package does not know or gives a misleading type, such as `.ts`, which it reads as an MPEG transport stream. A query string or fragment is ignored, so `report.pdf?token=abc` resolves to `application/pdf`.

Types from a `Content-Type` header or from the `mime` package pass through `normalizeMimeType()`, which turns known misfilings into text types, for example `video/mp2t` into `text/x-typescript` and `application/x-perl` into `text/x-perl`. The full list is `MIME_TYPE_NORMALIZATION`.

A local file whose extension neither the table nor the `mime` package knows gets `application/octet-stream` and is skipped. This includes files without an extension, such as `Dockerfile`, `Makefile` or `LICENSE`.

**Code reference:** [src/utils/mimeTypeUtils.ts](../../src/utils/mimeTypeUtils.ts)

## Pipeline Routing

Pipelines are tried in this order:

| Order | Pipeline | Accepts | Output |
|:------|:---------|:--------|:-------|
| 1 | `JsonPipeline` | `application/json`, `text/json`, `text/x-json` | JSON, split along its structure |
| 2 | `SourceCodePipeline` | Any MIME type that has a language mapping (see [Source Code](#source-code)) | Source text, split at declarations or by size |
| 3 | `DocumentPipeline` | The document types listed under [Documents](#documents) | Markdown converted by Xberg |
| 4 | `HtmlPipeline` | `text/html`, `application/xhtml+xml` | Markdown converted by the HTML middleware chain |
| 5 | `MarkdownPipeline` | `text/markdown`, `text/x-markdown`, `text/mdx`, `text/x-gfm` | Markdown |
| 6 | `TextPipeline` | Any other `text/*` type, unless the content contains a null byte | Plain text |

Order matters where two pipelines accept a type. `application/json`, for example, also has a language mapping, and `JsonPipeline` takes it first.

**Code reference:** [src/scraper/pipelines/PipelineFactory.ts](../../src/scraper/pipelines/PipelineFactory.ts) for the order, and each pipeline's `canProcess()` for what it accepts.

## Documents

`DocumentPipeline` uses [Xberg](https://github.com/xberg-io/xberg) (`@xberg-io/xberg`) to convert binary and rich documents to Markdown. Xberg renders the whole document structure; a spreadsheet becomes one heading per sheet, each followed by a Markdown table. The title comes from the document's metadata, or else from the file name.

A document larger than `scraper.document.maxSize` (10 MB by default) is not converted; the pipeline returns an error and no content. A website must serve a document under its own MIME type: a response labeled `application/octet-stream` is skipped.

| Format | Extensions | MIME Type |
|:-------|:-----------|:----------|
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

**Code reference:** [src/scraper/pipelines/DocumentPipeline.ts](../../src/scraper/pipelines/DocumentPipeline.ts) and `MimeTypeUtils.isSupportedDocument()`

## Web Pages

`HtmlPipeline` converts HTML to Markdown through its middleware chain; [Content Processing](content-processing.md#html) describes the stages.

| Format | Extensions | MIME Type |
|:-------|:-----------|:----------|
| HTML | `.html`, `.htm` | `text/html` |
| XHTML | `.xhtml` | `application/xhtml+xml` |

**Code reference:** [src/scraper/pipelines/HtmlPipeline.ts](../../src/scraper/pipelines/HtmlPipeline.ts)

## Markdown

`MarkdownPipeline` reads the title from front matter or the first heading and splits the text by headings.

| Format | Extensions | MIME Type |
|:-------|:-----------|:----------|
| Markdown | `.md`, `.markdown`, `.mkd`, `.mkdn`, `.mkdown`, `.mdown`, `.mdwn`, `.ronn`, `.gfm` | `text/markdown`, `text/x-markdown`, `text/x-gfm` |
| MDX | `.mdx` | `text/mdx` |

**Code reference:** [src/scraper/pipelines/MarkdownPipeline.ts](../../src/scraper/pipelines/MarkdownPipeline.ts)

## JSON

`JsonPipeline` splits JSON along its objects and arrays, so each chunk keeps its place in the document.

| Format | Extensions | MIME Type |
|:-------|:-----------|:----------|
| JSON | `.json` | `application/json`, `text/json`, `text/x-json` |

**Code reference:** [src/scraper/pipelines/JsonPipeline.ts](../../src/scraper/pipelines/JsonPipeline.ts)

## Source Code

`SourceCodePipeline` accepts every MIME type that `MimeTypeUtils.extractLanguageFromMimeType()` maps to a language name. For files, the extension decides the MIME type through `CUSTOM_MIME_TYPES` or the `mime` package. Together the two tables cover programming languages, shell scripts, stylesheets, web framework components, configuration and build files, infrastructure as code, query and schema languages, and TeX. Both tables live in [src/utils/mimeTypeUtils.ts](../../src/utils/mimeTypeUtils.ts); check there for a specific extension.

Some formats reach this pipeline that the name does not suggest:

- Lightweight markup, such as reStructuredText (`.rst`), AsciiDoc (`.adoc`, `.asciidoc`), Org (`.org`), Textile, Pod, RDoc, wiki markup and R Markdown (`.rmd`), is indexed as source text. It is not converted the way Markdown is.
- YAML (`.yaml`, `.yml`), TOML (`.toml`) and XML (`.xml` and its relatives such as `.xsd`, `.xslt` and `.wsdl`) are indexed as source text too.

Java is an exception. The `mime` package gives `.java` the type `text/x-java-source`, which has no language mapping, so `TextPipeline` indexes Java files.

### Languages Split at Declarations

These languages have a tree-sitter parser. Each function, method, class or other declaration becomes its own chunk; [Source Code Splitter](source-code-splitter.md) describes the rules.

| Language | Extensions |
|:---------|:-----------|
| TypeScript | `.ts`, `.mts`, `.cts` |
| TSX | `.tsx` |
| JavaScript | `.js`, `.cjs`, `.mjs` |
| JSX | `.jsx` |
| Python | `.py`, `.pyw`, `.pyi` |

Every other language is split by size only: a file that fits in `splitter.maxChunkSize` stays one chunk, and a larger one is cut at blank lines, then line breaks, then spaces.

**Code reference:** [src/scraper/pipelines/SourceCodePipeline.ts](../../src/scraper/pipelines/SourceCodePipeline.ts) and [src/splitter/treesitter/LanguageParserRegistry.ts](../../src/splitter/treesitter/LanguageParserRegistry.ts)

## Text Fallback

`TextPipeline` takes any `text/*` type that no earlier pipeline accepts. It refuses content that contains a null byte, which marks it as binary. Common cases:

| Format | Extensions | MIME Type |
|:-------|:-----------|:----------|
| Plain text | `.txt`, `.log` | `text/plain` |
| CSV | `.csv` | `text/csv` |
| TSV | `.tsv` | `text/tab-separated-values` |

**Code reference:** [src/scraper/pipelines/TextPipeline.ts](../../src/scraper/pipelines/TextPipeline.ts)

## Archives

An archive is a container, not a format with text of its own. The server unpacks it and routes each entry through the pipelines by the entry's file extension.

| Format | Extensions | Library |
|:-------|:-----------|:--------|
| ZIP | `.zip` | `yauzl` |
| TAR | `.tar` | `tar` |
| Gzipped TAR | `.tar.gz`, `.tgz`, and any other `.gz` | `tar` |

Detection uses the extension only. DOCX, XLSX, EPUB and the OpenDocument formats are ZIP files inside, and they must reach `DocumentPipeline` rather than be unpacked.

- Local scrapes (`file://`) open every archive they meet, at the start path or inside a scanned directory.
- Web scrapes unpack an archive only when it is the start URL. Archive links found during a crawl are not followed.

**Code reference:** [src/utils/archive/ArchiveFactory.ts](../../src/utils/archive/ArchiveFactory.ts) and [src/scraper/strategies/LocalFileStrategy.ts](../../src/scraper/strategies/LocalFileStrategy.ts)

## GitHub Repositories

A GitHub scrape fetches only the files its own filter accepts: known text and document extensions, common file names such as `README`, `LICENSE` and `Dockerfile`, a few name patterns such as `.env` files, and any other file whose extension resolves to a `text/*` type. The selected files then go through the pipelines like any other content.

**Code reference:** `TEXT_EXTENSIONS`, `DOCUMENT_EXTENSIONS` and `COMMON_TEXT_FILES` in [src/scraper/strategies/GitHubScraperStrategy.ts](../../src/scraper/strategies/GitHubScraperStrategy.ts)
