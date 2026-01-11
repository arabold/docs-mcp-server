# Add Archive (ZIP/TAR) File Support to Scraper Pipeline

## Summary
Enable the scraper to process archive files (ZIP, TAR, TAR.GZ, TGZ) as if they were directories. This includes support for local archives (treated as subdirectories or root targets) and web-hosted archives (treated as root targets only).

## Motivation
Users often need to ingest documentation or codebases distributed as archives (ZIP, TAR, etc.). Currently, the scraper ignores these files or treats them as binary blobs. By expanding archives and treating them as directories, we can apply existing scraping logic (include/exclude patterns, file processing) to the archived content.

## Proposed Changes
1.  **Dependencies**:
    -   Add `yauzl` (Yet Another Unzip Library) for non-blocking, stream-based ZIP handling.
    -   Add `tar` for non-blocking, stream-based TAR/GZ handling.
2.  **Archive Abstraction**: Create a common interface for archive processing to abstract away format differences.
3.  **LocalFileStrategy**: Enhance to detect archive files.
    -   If a file is a supported archive, list its contents as if it were a directory.
    -   Support "virtual" file paths into archives (e.g., `file:///path/to/archive.zip/inner/doc.md`).
    -   Transparently read content from within archives.
4.  **WebScraperStrategy**: Enhance to handle Root Archive URLs.
    -   If the *initial* URL is an archive, download it to a temporary location and delegate to the archive processing logic.
    -   Continue to ignore archive files encountered as links during web crawling (as per user request).
