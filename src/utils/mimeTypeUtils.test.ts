import { describe, expect, it } from "vitest";
import { MimeTypeUtils, type ParsedContentType } from "./mimeTypeUtils";

/** A missing MIME type, which callers pass despite the `string` signature. */
const missing = (value: null | undefined) => value as unknown as string;

describe("MimeTypeUtils", () => {
  it("detects binary content by its null bytes", () => {
    const cases: Array<[label: string, content: string | Buffer, expected: boolean]> = [
      ["string with a null byte", "text content\0with null byte", true],
      // PNG-like header with a null byte
      [
        "Buffer with a null byte",
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a]),
        true,
      ],
      ["plain string", "This is plain text content without null bytes", false],
      ["plain Buffer", Buffer.from("This is text content", "utf8"), false],
    ];

    for (const [label, content, expected] of cases) {
      expect.soft(MimeTypeUtils.isBinary(content), label).toBe(expected);
    }
  });

  it("accepts plain text types and leaves structured text to its own pipeline", () => {
    const cases: Array<[mimeType: string, expected: boolean]> = [
      ["text/plain", true],
      ["text/css", true],
      ["text/html", true],
      ["TEXT/HTML", true], // case insensitive
      ["text/markdown", false], // goes to MarkdownPipeline
      ["application/json", false], // goes to JsonPipeline
      ["text/json", false], // goes to JsonPipeline
      ["application/xml", false],
      ["application/javascript", false],
      ["application/octet-stream", false],
      ["application/pdf", false],
      ["image/png", false],
      ["image/jpeg", false],
      ["video/mp4", false],
      ["audio/mpeg", false],
      ["", false],
      [missing(null), false],
      [missing(undefined), false],
    ];

    for (const [mimeType, expected] of cases) {
      expect.soft(MimeTypeUtils.isText(mimeType), String(mimeType)).toBe(expected);
    }
  });

  it("accepts every text type and the text-based application types for text processing", () => {
    const cases: Array<[mimeType: string, expected: boolean]> = [
      ["text/plain", true],
      ["text/markdown", true],
      ["text/css", true],
      ["TEXT/HTML", true], // case insensitive
      ["application/xml", true],
      ["application/javascript", true],
      ["application/x-javascript", true],
      ["application/x-sh", true],
      ["application/x-yaml", true],
      ["application/yaml", true],
      ["application/json", true],
      ["application/xslt+xml", true],
      ["application/xml-dtd", true],
      ["application/wsdl+xml", true],
      ["application/octet-stream", false],
      ["application/pdf", false],
      ["application/zip", false],
      ["application/unknown", false],
      ["image/png", false],
      ["image/jpeg", false],
      ["video/mp4", false],
      ["audio/mpeg", false],
      ["", false],
      [missing(null), false],
      [missing(undefined), false],
    ];

    for (const [mimeType, expected] of cases) {
      expect
        .soft(MimeTypeUtils.isSafeForTextProcessing(mimeType), String(mimeType))
        .toBe(expected);
    }
  });

  it("recognizes the HTML, Markdown and JSON types", () => {
    const predicates = {
      isHtml: MimeTypeUtils.isHtml,
      isMarkdown: MimeTypeUtils.isMarkdown,
      isJson: MimeTypeUtils.isJson,
    };
    const cases: Array<
      [predicate: keyof typeof predicates, mimeType: string, expected: boolean]
    > = [
      ["isHtml", "text/html", true],
      ["isHtml", "application/xhtml+xml", true],
      ["isHtml", "text/plain", false],
      ["isMarkdown", "text/markdown", true],
      ["isMarkdown", "text/x-markdown", true],
      ["isMarkdown", "text/mdx", true],
      ["isMarkdown", "text/x-gfm", true],
      ["isMarkdown", "text/plain", false],
      ["isJson", "application/json", true],
      ["isJson", "text/json", true],
      ["isJson", "text/x-json", true],
      ["isJson", "text/plain", false],
    ];

    for (const [predicate, mimeType, expected] of cases) {
      expect
        .soft(predicates[predicate](mimeType), `${predicate}(${mimeType})`)
        .toBe(expected);
    }
  });

  it("detects each document format and assigns it to exactly one document family", () => {
    const families = {
      pdf: MimeTypeUtils.isPdf,
      office: MimeTypeUtils.isOfficeDocument,
      legacyOffice: MimeTypeUtils.isLegacyOfficeDocument,
      openDocument: MimeTypeUtils.isOpenDocument,
      rtf: MimeTypeUtils.isRtf,
      ebook: MimeTypeUtils.isEbook,
      jupyter: MimeTypeUtils.isJupyterNotebook,
    };
    // A null path is a MIME type that arrives without one, e.g. from a header.
    // A null family is a type DocumentPipeline must not claim.
    const cases: Array<{
      path: string | null;
      mimeType: string;
      family: keyof typeof families | null;
    }> = [
      { path: "file.pdf", mimeType: "application/pdf", family: "pdf" },
      {
        path: "file.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        family: "office",
      },
      {
        path: "file.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        family: "office",
      },
      {
        path: "file.pptx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        family: "office",
      },
      { path: "file.doc", mimeType: "application/msword", family: "legacyOffice" },
      { path: "file.xls", mimeType: "application/vnd.ms-excel", family: "legacyOffice" },
      {
        path: "file.ppt",
        mimeType: "application/vnd.ms-powerpoint",
        family: "legacyOffice",
      },
      {
        path: "file.odt",
        mimeType: "application/vnd.oasis.opendocument.text",
        family: "openDocument",
      },
      {
        path: "file.ods",
        mimeType: "application/vnd.oasis.opendocument.spreadsheet",
        family: "openDocument",
      },
      {
        path: "file.odp",
        mimeType: "application/vnd.oasis.opendocument.presentation",
        family: "openDocument",
      },
      { path: "file.rtf", mimeType: "application/rtf", family: "rtf" },
      { path: null, mimeType: "text/rtf", family: "rtf" },
      { path: "book.epub", mimeType: "application/epub+zip", family: "ebook" },
      { path: "book.fb2", mimeType: "application/x-fictionbook+xml", family: "ebook" },
      { path: "notebook.ipynb", mimeType: "application/x-ipynb+json", family: "jupyter" },
      { path: null, mimeType: "text/html", family: null },
      { path: null, mimeType: "text/plain", family: null },
      { path: null, mimeType: "application/json", family: null },
    ];

    for (const { path, mimeType, family } of cases) {
      const label = path ?? mimeType;
      if (path !== null) {
        expect
          .soft(MimeTypeUtils.detectMimeTypeFromPath(path), `${label}: MIME type`)
          .toBe(mimeType);
      }
      expect
        .soft(MimeTypeUtils.isSupportedDocument(mimeType), `${label}: supported document`)
        .toBe(family !== null);
      for (const [name, isFamily] of Object.entries(families)) {
        expect.soft(isFamily(mimeType), `${label}: ${name}`).toBe(name === family);
      }
    }
  });

  it("maps a path to its MIME type and the MIME type to its code language", () => {
    // A null path is a MIME type that arrives without one. An empty language
    // means the type is not source code.
    const cases: Array<{ path: string | null; mimeType: string; language: string }> = [
      // Documentation formats (issue #311)
      { path: "docs/readme.rst", mimeType: "text/x-rst", language: "rst" },
      { path: "README.RST", mimeType: "text/x-rst", language: "rst" }, // extension case ignored
      { path: "docs/guide.adoc", mimeType: "text/x-asciidoc", language: "asciidoc" },
      { path: "README.asciidoc", mimeType: "text/x-asciidoc", language: "asciidoc" },
      { path: "notes.org", mimeType: "text/x-org", language: "org" },
      { path: "doc.textile", mimeType: "text/x-textile", language: "textile" },
      { path: "doc.pod", mimeType: "text/x-pod", language: "pod" },
      { path: "doc.rdoc", mimeType: "text/x-rdoc", language: "rdoc" },
      { path: "doc.wiki", mimeType: "text/x-wiki", language: "wiki" },
      { path: "doc.rmd", mimeType: "text/x-rmarkdown", language: "rmarkdown" },

      // TypeScript and JavaScript
      { path: "app.ts", mimeType: "text/x-typescript", language: "typescript" },
      { path: "app.tsx", mimeType: "text/x-tsx", language: "tsx" },
      { path: "app.mts", mimeType: "text/x-typescript", language: "typescript" },
      { path: "app.cts", mimeType: "text/x-typescript", language: "typescript" },
      { path: "app.js", mimeType: "text/javascript", language: "javascript" },
      { path: "app.jsx", mimeType: "text/x-jsx", language: "jsx" },
      { path: "app.cjs", mimeType: "text/javascript", language: "javascript" },
      { path: "app.mjs", mimeType: "text/javascript", language: "javascript" },
      { path: null, mimeType: "application/javascript", language: "javascript" },

      // Python
      { path: "script.py", mimeType: "text/x-python", language: "python" },
      { path: "script.pyw", mimeType: "text/x-python", language: "python" },
      { path: "types.pyi", mimeType: "text/x-python", language: "python" },
      { path: "module.pyx", mimeType: "text/x-cython", language: "cython" },

      // Systems languages
      { path: "main.go", mimeType: "text/x-go", language: "go" },
      { path: "main.rs", mimeType: "text/x-rust", language: "rust" },
      { path: "main.c", mimeType: "text/x-csrc", language: "c" },
      { path: "main.cpp", mimeType: "text/x-c++src", language: "cpp" },
      { path: "main.zig", mimeType: "text/x-zig", language: "zig" },
      { path: "main.nim", mimeType: "text/x-nim", language: "nim" },

      // JVM languages
      { path: "Main.kt", mimeType: "text/x-kotlin", language: "kotlin" },
      { path: "build.kts", mimeType: "text/x-kotlin", language: "kotlin" },
      { path: "Main.scala", mimeType: "text/x-scala", language: "scala" },
      { path: "Script.groovy", mimeType: "text/x-groovy", language: "groovy" },
      { path: "build.gradle", mimeType: "text/x-gradle", language: "groovy" },

      // Functional languages
      { path: "Main.hs", mimeType: "text/x-haskell", language: "haskell" },
      { path: "Main.elm", mimeType: "text/x-elm", language: "elm" },
      { path: "app.ex", mimeType: "text/x-elixir", language: "elixir" },
      { path: "app.exs", mimeType: "text/x-elixir", language: "elixir" },
      { path: "core.clj", mimeType: "text/x-clojure", language: "clojure" },
      { path: "script.jl", mimeType: "text/x-julia", language: "julia" },

      // Scripting languages
      { path: "script.rb", mimeType: "text/x-ruby", language: "ruby" },
      { path: "Rakefile.rake", mimeType: "text/x-ruby", language: "ruby" },
      { path: "script.lua", mimeType: "text/x-lua", language: "lua" },
      { path: "script.pl", mimeType: "text/x-perl", language: "perl" },
      { path: "analysis.r", mimeType: "text/x-r", language: "r" },
      { path: "analysis.R", mimeType: "text/x-r", language: "r" },

      // Web3 and smart contract languages
      { path: "Contract.sol", mimeType: "text/x-solidity", language: "solidity" },
      { path: "module.move", mimeType: "text/x-move", language: "move" },
      { path: "contract.cairo", mimeType: "text/x-cairo", language: "cairo" },

      // Web framework components
      { path: "App.vue", mimeType: "text/x-vue", language: "vue" },
      { path: "App.svelte", mimeType: "text/x-svelte", language: "svelte" },
      { path: "Page.astro", mimeType: "text/x-astro", language: "astro" },

      // Configuration files
      { path: "config.toml", mimeType: "text/x-toml", language: "toml" },
      { path: "config.ini", mimeType: "text/x-ini", language: "ini" },
      { path: "settings.cfg", mimeType: "text/x-ini", language: "ini" },
      { path: "app.conf", mimeType: "text/x-conf", language: "conf" },
      { path: ".env", mimeType: "text/x-dotenv", language: "dotenv" },
      { path: "app.properties", mimeType: "text/x-properties", language: "properties" },

      // Build and infrastructure files, some matched by their whole file name
      { path: "Dockerfile", mimeType: "text/x-dockerfile", language: "dockerfile" },
      { path: "app.dockerfile", mimeType: "text/x-dockerfile", language: "dockerfile" },
      { path: "Containerfile", mimeType: "text/x-dockerfile", language: "dockerfile" },
      { path: "Makefile", mimeType: "text/x-makefile", language: "makefile" },
      { path: "CMakeLists.cmake", mimeType: "text/x-cmake", language: "cmake" },
      { path: "BUILD.bazel", mimeType: "text/x-bazel", language: "bazel" },
      { path: "defs.bzl", mimeType: "text/x-bazel", language: "bazel" },
      { path: "main.tf", mimeType: "text/x-terraform", language: "hcl" },
      { path: "vars.tfvars", mimeType: "text/x-terraform", language: "hcl" },
      { path: "config.hcl", mimeType: "text/x-hcl", language: "hcl" },

      // XML-based formats keep their standard MIME types and all read as XML
      // source (issue #341)
      { path: "transform.xslt", mimeType: "application/xslt+xml", language: "xml" },
      { path: "transform.xsl", mimeType: "application/xml", language: "xml" },
      { path: "schema.xsd", mimeType: "application/xml", language: "xml" },
      { path: "doctype.dtd", mimeType: "application/xml-dtd", language: "xml" },
      { path: "service.wsdl", mimeType: "application/wsdl+xml", language: "xml" },
      { path: null, mimeType: "text/xml", language: "xml" },

      // Schema and API definitions
      { path: "schema.graphql", mimeType: "text/x-graphql", language: "graphql" },
      { path: "query.gql", mimeType: "text/x-graphql", language: "graphql" },
      { path: "messages.proto", mimeType: "text/x-proto", language: "protobuf" },
      { path: "schema.prisma", mimeType: "text/x-prisma", language: "prisma" },
      { path: "service.thrift", mimeType: "text/x-thrift", language: "thrift" },
      { path: "schema.avro", mimeType: "text/x-avro", language: "avro" },

      // TeX and LaTeX
      { path: "document.tex", mimeType: "text/x-tex", language: "tex" },
      { path: "document.latex", mimeType: "text/x-latex", language: "latex" },

      // The mime package files these plain-text scripts under application/*,
      // which left them unindexed by the GitHub and local-file strategies and
      // drove the binary-media narrowing of the crawl gate (issue #490).
      { path: "/script.csh", mimeType: "text/x-shellscript", language: "bash" },
      { path: "/script.tcsh", mimeType: "text/x-shellscript", language: "bash" },
      { path: "/script.ksh", mimeType: "text/x-shellscript", language: "bash" },
      { path: "/script.tcl", mimeType: "text/x-tcl", language: "tcl" },
      { path: "/lib.scm", mimeType: "text/x-scheme", language: "scheme" },
      { path: "/build.bat", mimeType: "text/x-batch", language: "batch" },
      { path: "/build.cmd", mimeType: "text/x-batch", language: "batch" },

      // Not source code. .ps is not a misfiled text script but a genuine
      // document format, so it keeps application/postscript.
      { path: "/Guess/guess.ps", mimeType: "application/postscript", language: "" },
      { path: null, mimeType: "text/plain", language: "" },
      { path: null, mimeType: "text/markdown", language: "" },
      { path: null, mimeType: "text/html", language: "" },
      { path: null, mimeType: "text/x-unknown", language: "" },
      { path: null, mimeType: "application/octet-stream", language: "" },
      { path: null, mimeType: "application/pdf", language: "" },
      { path: null, mimeType: "image/png", language: "" },
      { path: null, mimeType: "video/mp4", language: "" },
    ];

    for (const { path, mimeType, language } of cases) {
      const label = path ?? mimeType;
      if (path !== null) {
        expect
          .soft(MimeTypeUtils.detectMimeTypeFromPath(path), `${label}: MIME type`)
          .toBe(mimeType);
      }
      expect
        .soft(MimeTypeUtils.extractLanguageFromMimeType(mimeType), `${label}: language`)
        .toBe(language);
      expect
        .soft(MimeTypeUtils.isSourceCode(mimeType), `${label}: source code`)
        .toBe(language !== "");
    }
  });

  it("ignores query parameters and hash fragments when detecting from a URL", () => {
    const cases: Array<[path: string, expected: string]> = [
      ["report.pdf?token=abc123", "application/pdf"],
      [
        "https://s3.amazonaws.com/bucket/report.docx?X-Amz-Signature=abc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      ["document.pdf#page=5", "application/pdf"],
      [
        "file.xlsx?v=2#sheet=1",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      ["https://cdn.example.com/files/report.pdf?t=1767868182094", "application/pdf"],
      ["src/main.ts?ref=abc123", "text/x-typescript"],
    ];

    for (const [path, expected] of cases) {
      expect.soft(MimeTypeUtils.detectMimeTypeFromPath(path), path).toBe(expected);
    }
  });

  it("reads a dot as an extension only in the final path segment", () => {
    // The crawl's queue-time gate acts on this result before making any request, so
    // a dot inside a directory segment must not be read as a file extension. That
    // currently holds because the token after the last dot contains a "/" and cannot
    // match the extension table. These cases pin the behaviour against a refactor.
    const cases: Array<[pathname: string, expected: string | null]> = [
      ["/docs/v1.0/guide", null],
      ["/api/v2.0", null],
      ["/2024.01.15/post", null],
      ["/some.dir/index", null],
      ["/node.js/api", null],
      ["/lib/jquery.min/docs", null],
      ["/u.s.a/history", null],
      ["/spring.io/guides", null],
      ["/rails-7.1/intro", null],
      ["/archive.2019/index", null],
      ["/pkg/[email protected]/readme", null],
      ["/docs/getting-started", null],
      ["/", null],
      ["/assets/diagram.png", "image/png"],
      ["/assets/flame.svg", "image/svg+xml"],
      ["/x.mov", "video/quicktime"],
      ["/rust.rs", "text/x-rust"],
    ];

    for (const [pathname, expected] of cases) {
      expect
        .soft(MimeTypeUtils.detectMimeTypeFromPath(pathname), pathname)
        .toBe(expected);
    }
  });

  it("corrects the MIME types the mime package gets wrong and passes the rest through", () => {
    const cases: Array<[mimeType: string | null, expected: string | null]> = [
      ["application/node", "text/javascript"],
      ["video/mp2t", "text/x-typescript"],
      ["application/rls-services+xml", "text/x-rust"],
      ["application/vnd.lotus-organizer", "text/x-org"],
      ["application/vnd.dart", "text/x-dart"],
      ["application/toml", "text/x-toml"],
      // Script types arriving already wrong, e.g. in a Content-Type header (issue #490)
      ["application/x-csh", "text/x-shellscript"],
      ["application/x-tcl", "text/x-tcl"],
      ["application/vnd.lotus-screencam", "text/x-scheme"],
      ["application/x-msdownload", "text/x-batch"],
      ["text/html", "text/html"],
      ["application/json", "application/json"],
      ["text/x-python", "text/x-python"],
      [null, null],
    ];

    for (const [mimeType, expected] of cases) {
      expect
        .soft(MimeTypeUtils.normalizeMimeType(mimeType), String(mimeType))
        .toBe(expected);
    }
  });

  it("parses a Content-Type header into a normalized MIME type and charset", () => {
    const cases: Array<[header: string | null | undefined, expected: ParsedContentType]> =
      [
        ["text/html; charset=utf-8", { mimeType: "text/html", charset: "utf-8" }],
        // A server's misfiled script type is corrected like a path's would be
        [
          "application/x-tcl; charset=UTF-8",
          { mimeType: "text/x-tcl", charset: "utf-8" },
        ],
        [
          "Text/Plain; format=flowed; Charset=ISO-8859-1",
          { mimeType: "text/plain", charset: "iso-8859-1" },
        ],
        ["application/json", { mimeType: "application/json" }],
        ["", { mimeType: "application/octet-stream" }],
        [null, { mimeType: "application/octet-stream" }],
        [undefined, { mimeType: "application/octet-stream" }],
      ];

    for (const [header, expected] of cases) {
      expect
        .soft(MimeTypeUtils.parseContentType(header), String(header))
        .toEqual(expected);
    }
  });

  it("classifies only the image, video, audio and font families as binary media", () => {
    const cases: Array<[mimeType: string, expected: boolean]> = [
      ["image/png", true],
      ["image/jpeg", true],
      ["image/svg+xml", true],
      ["video/mp4", true],
      ["video/quicktime", true],
      ["audio/mpeg", true],
      ["font/woff2", true],
      ["IMAGE/PNG", true],
      ["text/html", false],
      ["text/plain", false],
      ["text/x-python", false],
      // The application/* rows matter most: the mime package resolves real script
      // extensions (.csh, .tcl, .bat, .scm, .ps) to those types, and treating the
      // family as binary media would make the crawl gate reject pages that index
      // correctly today (issue #490).
      ["application/pdf", false],
      ["application/json", false],
      ["application/zip", false],
      ["application/octet-stream", false],
      ["application/x-csh", false],
      ["application/x-tcl", false],
      ["application/x-msdownload", false],
      ["application/vnd.lotus-screencam", false],
      // PostScript stays a document format, and the crawl gate still admits it
      ["application/postscript", false],
      ["", false],
    ];

    for (const [mimeType, expected] of cases) {
      expect.soft(MimeTypeUtils.isBinaryMediaType(mimeType), mimeType).toBe(expected);
    }
  });
});
