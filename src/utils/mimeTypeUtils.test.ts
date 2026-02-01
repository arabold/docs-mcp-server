import { describe, expect, it } from "vitest";
import { MimeTypeUtils } from "./mimeTypeUtils";

describe("MimeTypeUtils", () => {
  describe("isBinary", () => {
    it("should detect binary content with null bytes", () => {
      const binaryContent = "text content\0with null byte";
      expect(MimeTypeUtils.isBinary(binaryContent)).toBe(true);
    });

    it("should detect binary Buffer content", () => {
      const binaryBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a]); // PNG-like header with null byte
      expect(MimeTypeUtils.isBinary(binaryBuffer)).toBe(true);
    });

    it("should not detect text content as binary", () => {
      const textContent = "This is plain text content without null bytes";
      expect(MimeTypeUtils.isBinary(textContent)).toBe(false);
    });

    it("should not detect text Buffer as binary", () => {
      const textBuffer = Buffer.from("This is text content", "utf8");
      expect(MimeTypeUtils.isBinary(textBuffer)).toBe(false);
    });
  });

  describe("isText", () => {
    it("should accept basic text/* MIME types", () => {
      expect(MimeTypeUtils.isText("text/plain")).toBe(true);
      expect(MimeTypeUtils.isText("text/css")).toBe(true);
      expect(MimeTypeUtils.isText("TEXT/HTML")).toBe(true); // Case insensitive
    });

    it("should exclude structured text formats for specific pipelines", () => {
      expect(MimeTypeUtils.isText("text/markdown")).toBe(false); // Should go to MarkdownPipeline
      expect(MimeTypeUtils.isText("application/json")).toBe(false); // Should go to JsonPipeline
      expect(MimeTypeUtils.isText("text/json")).toBe(false); // Should go to JsonPipeline
    });

    it("should reject application types", () => {
      expect(MimeTypeUtils.isText("application/xml")).toBe(false);
      expect(MimeTypeUtils.isText("application/javascript")).toBe(false);
      expect(MimeTypeUtils.isText("application/octet-stream")).toBe(false);
      expect(MimeTypeUtils.isText("application/pdf")).toBe(false);
    });

    it("should reject image and video types", () => {
      expect(MimeTypeUtils.isText("image/png")).toBe(false);
      expect(MimeTypeUtils.isText("image/jpeg")).toBe(false);
      expect(MimeTypeUtils.isText("video/mp4")).toBe(false);
      expect(MimeTypeUtils.isText("audio/mpeg")).toBe(false);
    });

    it("should reject empty or null MIME types", () => {
      expect(MimeTypeUtils.isText("")).toBe(false);
      expect(MimeTypeUtils.isText(null as any)).toBe(false);
      expect(MimeTypeUtils.isText(undefined as any)).toBe(false);
    });
  });

  describe("isSafeForTextProcessing", () => {
    it("should accept all text/* MIME types", () => {
      expect(MimeTypeUtils.isSafeForTextProcessing("text/plain")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("text/markdown")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("text/css")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("TEXT/HTML")).toBe(true); // Case insensitive
    });

    it("should accept safe application types", () => {
      expect(MimeTypeUtils.isSafeForTextProcessing("application/xml")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/javascript")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/x-javascript")).toBe(
        true,
      );
      expect(MimeTypeUtils.isSafeForTextProcessing("application/x-sh")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/x-yaml")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/yaml")).toBe(true);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/json")).toBe(true);
    });

    it("should reject unsafe application types", () => {
      expect(MimeTypeUtils.isSafeForTextProcessing("application/octet-stream")).toBe(
        false,
      );
      expect(MimeTypeUtils.isSafeForTextProcessing("application/pdf")).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing("application/zip")).toBe(false);
    });

    it("should reject image and video types", () => {
      expect(MimeTypeUtils.isSafeForTextProcessing("image/png")).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing("image/jpeg")).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing("video/mp4")).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing("audio/mpeg")).toBe(false);
    });

    it("should reject empty or null MIME types", () => {
      expect(MimeTypeUtils.isSafeForTextProcessing("")).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing(null as any)).toBe(false);
      expect(MimeTypeUtils.isSafeForTextProcessing(undefined as any)).toBe(false);
    });
  });

  describe("existing methods", () => {
    it("should correctly identify HTML", () => {
      expect(MimeTypeUtils.isHtml("text/html")).toBe(true);
      expect(MimeTypeUtils.isHtml("application/xhtml+xml")).toBe(true);
      expect(MimeTypeUtils.isHtml("text/plain")).toBe(false);
    });

    it("should correctly identify Markdown", () => {
      expect(MimeTypeUtils.isMarkdown("text/markdown")).toBe(true);
      expect(MimeTypeUtils.isMarkdown("text/x-markdown")).toBe(true);
      expect(MimeTypeUtils.isMarkdown("text/plain")).toBe(false);
    });

    it("should correctly identify text types", () => {
      expect(MimeTypeUtils.isText("text/plain")).toBe(true);
      expect(MimeTypeUtils.isText("text/html")).toBe(true);
      expect(MimeTypeUtils.isText("application/json")).toBe(false); // JSON should go to JsonPipeline
    });

    it("should correctly identify JSON", () => {
      expect(MimeTypeUtils.isJson("application/json")).toBe(true);
      expect(MimeTypeUtils.isJson("text/json")).toBe(true);
      expect(MimeTypeUtils.isJson("text/x-json")).toBe(true);
      expect(MimeTypeUtils.isJson("text/plain")).toBe(false);
    });

    it("should correctly identify source code", () => {
      expect(MimeTypeUtils.isSourceCode("text/x-typescript")).toBe(true);
      expect(MimeTypeUtils.isSourceCode("text/x-python")).toBe(true);
      expect(MimeTypeUtils.isSourceCode("text/plain")).toBe(false);
    });
  });

  describe("detectMimeTypeFromPath", () => {
    describe("documentation formats (issue #311)", () => {
      it("should detect RST (reStructuredText) files", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("docs/readme.rst")).toBe(
          "text/x-rst",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("README.RST")).toBe("text/x-rst");
      });

      it("should detect AsciiDoc files", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("docs/guide.adoc")).toBe(
          "text/x-asciidoc",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("README.asciidoc")).toBe(
          "text/x-asciidoc",
        );
      });

      it("should detect Org-mode files", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("notes.org")).toBe("text/x-org");
      });

      it("should detect other documentation formats", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("doc.textile")).toBe(
          "text/x-textile",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("doc.pod")).toBe("text/x-pod");
        expect(MimeTypeUtils.detectMimeTypeFromPath("doc.rdoc")).toBe("text/x-rdoc");
        expect(MimeTypeUtils.detectMimeTypeFromPath("doc.wiki")).toBe("text/x-wiki");
        expect(MimeTypeUtils.detectMimeTypeFromPath("doc.rmd")).toBe("text/x-rmarkdown");
      });
    });

    describe("programming languages", () => {
      it("should detect TypeScript variants", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.ts")).toBe("text/x-typescript");
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.tsx")).toBe("text/x-tsx");
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.mts")).toBe("text/x-typescript");
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.cts")).toBe("text/x-typescript");
      });

      it("should detect JavaScript variants", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.js")).toBe("text/javascript");
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.jsx")).toBe("text/x-jsx");
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.cjs")).toBe("text/javascript");
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.mjs")).toBe("text/javascript");
      });

      it("should detect Python files", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("script.py")).toBe("text/x-python");
        expect(MimeTypeUtils.detectMimeTypeFromPath("script.pyw")).toBe("text/x-python");
        expect(MimeTypeUtils.detectMimeTypeFromPath("types.pyi")).toBe("text/x-python");
        expect(MimeTypeUtils.detectMimeTypeFromPath("module.pyx")).toBe("text/x-cython");
      });

      it("should detect systems languages", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("main.go")).toBe("text/x-go");
        expect(MimeTypeUtils.detectMimeTypeFromPath("main.rs")).toBe("text/x-rust");
        expect(MimeTypeUtils.detectMimeTypeFromPath("main.c")).toBe("text/x-csrc");
        expect(MimeTypeUtils.detectMimeTypeFromPath("main.cpp")).toBe("text/x-c++src");
        expect(MimeTypeUtils.detectMimeTypeFromPath("main.zig")).toBe("text/x-zig");
        expect(MimeTypeUtils.detectMimeTypeFromPath("main.nim")).toBe("text/x-nim");
      });

      it("should detect JVM languages", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("Main.kt")).toBe("text/x-kotlin");
        expect(MimeTypeUtils.detectMimeTypeFromPath("build.kts")).toBe("text/x-kotlin");
        expect(MimeTypeUtils.detectMimeTypeFromPath("Main.scala")).toBe("text/x-scala");
        expect(MimeTypeUtils.detectMimeTypeFromPath("Script.groovy")).toBe(
          "text/x-groovy",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("build.gradle")).toBe(
          "text/x-gradle",
        );
      });

      it("should detect functional languages", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("Main.hs")).toBe("text/x-haskell");
        expect(MimeTypeUtils.detectMimeTypeFromPath("Main.elm")).toBe("text/x-elm");
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.ex")).toBe("text/x-elixir");
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.exs")).toBe("text/x-elixir");
        expect(MimeTypeUtils.detectMimeTypeFromPath("core.clj")).toBe("text/x-clojure");
        expect(MimeTypeUtils.detectMimeTypeFromPath("script.jl")).toBe("text/x-julia");
      });

      it("should detect scripting languages", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("script.rb")).toBe("text/x-ruby");
        expect(MimeTypeUtils.detectMimeTypeFromPath("Rakefile.rake")).toBe("text/x-ruby");
        expect(MimeTypeUtils.detectMimeTypeFromPath("script.lua")).toBe("text/x-lua");
        expect(MimeTypeUtils.detectMimeTypeFromPath("script.pl")).toBe("text/x-perl");
        expect(MimeTypeUtils.detectMimeTypeFromPath("analysis.r")).toBe("text/x-r");
        expect(MimeTypeUtils.detectMimeTypeFromPath("analysis.R")).toBe("text/x-r");
      });

      it("should detect Web3/smart contract languages", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("Contract.sol")).toBe(
          "text/x-solidity",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("module.move")).toBe("text/x-move");
        expect(MimeTypeUtils.detectMimeTypeFromPath("contract.cairo")).toBe(
          "text/x-cairo",
        );
      });
    });

    describe("modern web frameworks", () => {
      it("should detect Vue, Svelte, and Astro components", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("App.vue")).toBe("text/x-vue");
        expect(MimeTypeUtils.detectMimeTypeFromPath("App.svelte")).toBe("text/x-svelte");
        expect(MimeTypeUtils.detectMimeTypeFromPath("Page.astro")).toBe("text/x-astro");
      });
    });

    describe("configuration files", () => {
      it("should detect TOML and INI formats", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("config.toml")).toBe("text/x-toml");
        expect(MimeTypeUtils.detectMimeTypeFromPath("config.ini")).toBe("text/x-ini");
        expect(MimeTypeUtils.detectMimeTypeFromPath("settings.cfg")).toBe("text/x-ini");
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.conf")).toBe("text/x-conf");
      });

      it("should detect environment and properties files", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath(".env")).toBe("text/x-dotenv");
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.properties")).toBe(
          "text/x-properties",
        );
      });
    });

    describe("build and infrastructure files", () => {
      it("should detect Docker and container files", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("Dockerfile")).toBe(
          "text/x-dockerfile",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("app.dockerfile")).toBe(
          "text/x-dockerfile",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("Containerfile")).toBe(
          "text/x-dockerfile",
        );
      });

      it("should detect build system files", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("Makefile")).toBe("text/x-makefile");
        expect(MimeTypeUtils.detectMimeTypeFromPath("CMakeLists.cmake")).toBe(
          "text/x-cmake",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("BUILD.bazel")).toBe("text/x-bazel");
        expect(MimeTypeUtils.detectMimeTypeFromPath("defs.bzl")).toBe("text/x-bazel");
      });

      it("should detect Terraform and HCL files", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("main.tf")).toBe("text/x-terraform");
        expect(MimeTypeUtils.detectMimeTypeFromPath("vars.tfvars")).toBe(
          "text/x-terraform",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("config.hcl")).toBe("text/x-hcl");
      });
    });

    describe("schema and API definitions", () => {
      it("should detect GraphQL and Protocol Buffers", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("schema.graphql")).toBe(
          "text/x-graphql",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("query.gql")).toBe("text/x-graphql");
        expect(MimeTypeUtils.detectMimeTypeFromPath("messages.proto")).toBe(
          "text/x-proto",
        );
      });

      it("should detect Prisma, Thrift, and Avro", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("schema.prisma")).toBe(
          "text/x-prisma",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("service.thrift")).toBe(
          "text/x-thrift",
        );
        expect(MimeTypeUtils.detectMimeTypeFromPath("schema.avro")).toBe("text/x-avro");
      });
    });

    describe("TeX and LaTeX", () => {
      it("should detect TeX/LaTeX files", () => {
        expect(MimeTypeUtils.detectMimeTypeFromPath("document.tex")).toBe("text/x-tex");
        expect(MimeTypeUtils.detectMimeTypeFromPath("document.latex")).toBe(
          "text/x-latex",
        );
      });
    });
  });

  describe("normalizeMimeType", () => {
    it("should normalize incorrect mime package results", () => {
      expect(MimeTypeUtils.normalizeMimeType("application/node")).toBe("text/javascript");
      expect(MimeTypeUtils.normalizeMimeType("video/mp2t")).toBe("text/x-typescript");
      expect(MimeTypeUtils.normalizeMimeType("application/rls-services+xml")).toBe(
        "text/x-rust",
      );
      expect(MimeTypeUtils.normalizeMimeType("application/vnd.lotus-organizer")).toBe(
        "text/x-org",
      );
      expect(MimeTypeUtils.normalizeMimeType("application/vnd.dart")).toBe("text/x-dart");
      expect(MimeTypeUtils.normalizeMimeType("application/toml")).toBe("text/x-toml");
    });

    it("should pass through correct MIME types unchanged", () => {
      expect(MimeTypeUtils.normalizeMimeType("text/html")).toBe("text/html");
      expect(MimeTypeUtils.normalizeMimeType("application/json")).toBe(
        "application/json",
      );
      expect(MimeTypeUtils.normalizeMimeType("text/x-python")).toBe("text/x-python");
    });

    it("should handle null input", () => {
      expect(MimeTypeUtils.normalizeMimeType(null)).toBe(null);
    });
  });

  describe("extractLanguageFromMimeType", () => {
    it("should extract language for documentation formats", () => {
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-rst")).toBe("rst");
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-asciidoc")).toBe(
        "asciidoc",
      );
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-org")).toBe("org");
    });

    it("should extract language for programming languages", () => {
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-typescript")).toBe(
        "typescript",
      );
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-python")).toBe("python");
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-rust")).toBe("rust");
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-go")).toBe("go");
    });

    it("should extract language for modern frameworks", () => {
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-vue")).toBe("vue");
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-svelte")).toBe("svelte");
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-astro")).toBe("astro");
    });

    it("should extract language for config and build files", () => {
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-toml")).toBe("toml");
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-dockerfile")).toBe(
        "dockerfile",
      );
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/x-terraform")).toBe("hcl");
    });

    it("should return empty string for unknown MIME types", () => {
      expect(MimeTypeUtils.extractLanguageFromMimeType("text/plain")).toBe("");
      expect(MimeTypeUtils.extractLanguageFromMimeType("application/octet-stream")).toBe(
        "",
      );
    });
  });
});
