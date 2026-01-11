# Add ZIP File Support to Scraper Pipeline

## Summary
Enable the scraper to process ZIP archives as if they were directories. This includes support for local ZIP files (treated as subdirectories or root targets) and web-hosted ZIP files (treated as root targets only).

## Motivation
Users often need to ingest documentation or codebases distributed as ZIP archives. Currently, the scraper ignores these files or treats them as binary blobs. By expanding ZIP files and treating them as directories, we can apply existing scraping logic (include/exclude patterns, file processing) to the archived content.

## Proposed Changes
1.  **Dependency**: Add `adm-zip` for ZIP handling.
2.  **LocalFileStrategy**: Enhance to detect ZIP files.
    -   If a file is a ZIP, list its contents as if it were a directory.
    -   Support "virtual" file paths into ZIP archives (e.g., `file:///path/to/archive.zip/inner/doc.md`).
    -   Transparently read content from within ZIPs.
3.  **WebScraperStrategy**: Enhance to handle Root ZIP URLs.
    -   If the *initial* URL is a ZIP, download it to a temporary location and delegate to the ZIP processing logic.
    -   Continue to ignore ZIP files encountered as links during web crawling (as per user request).
