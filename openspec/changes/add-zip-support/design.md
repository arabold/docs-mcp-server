# Design: Archive (ZIP/TAR) File Support

## Architecture

### 1. Unified Archive Handling (LocalFileStrategy)
The core logic for traversing archives will reside in a new `ArchiveManager` used by `LocalFileStrategy`. We will treat archives as "virtual directories".

#### Archive Abstraction
To support multiple formats (ZIP, TAR, TAR.GZ), we will implement an adapter pattern:
-   **`ArchiveAdapter` Interface**:
    -   `listEntries()`: Returns an iterator of entry paths/metadata.
    -   `openEntry(path)`: Returns a readable stream of the entry content.
    -   `close()`: Cleans up resources.
-   **`ZipAdapter`**: Implements `ArchiveAdapter` using `yauzl`.
-   **`TarAdapter`**: Implements `ArchiveAdapter` using `tar`.

#### Virtual Path Resolution
When `LocalFileStrategy` receives a URL (e.g., `file:///path/to/data.tar.gz/docs/readme.md`):
1.  It attempts to `fs.stat` the path.
2.  If `fs.stat` fails (ENOENT), it traverses up the path hierarchy to find the longest existing prefix that is a **file** (explicitly checking `stats.isFile()`).
3.  If found (e.g., `/path/to/data.tar.gz`), it checks if the file is a supported archive (magic bytes or extension).
4.  If valid, it instantiates the appropriate `ArchiveAdapter` and treats the remainder of the path (`docs/readme.md`) as an entry within the archive.

#### Directory Listing
When processing an archive file (or a directory within an archive):
1.  Open the archive using the appropriate adapter.
2.  Iterate through entries to build a virtual directory listing.
3.  Filter entries that match the current "directory" prefix.
4.  Return them as `file://` URLs.

#### Content Reading
When reading a file within an archive:
1.  Open the archive using the appropriate adapter.
2.  Locate the specific entry.
3.  Open a read stream for the entry and buffer the content (or pipe to processing).
4.  Return `RawContent` with appropriate MIME type detection.

### 2. Web Archive Handling (WebScraperStrategy)
`WebScraperStrategy` needs to identify when the **Root URL** is an archive file.

1.  **Detection**: Check URL extension (`.zip`, `.tar`, `.gz`, `.tgz`) or perform a `HEAD` request to check `Content-Type` (e.g., `application/zip`, `application/x-tar`, `application/gzip`).
2.  **Download**: Stream the response to a temporary file (e.g., using `os.tmpdir()`).
3.  **Handoff**:
    -   Once downloaded, the strategy delegates to the **Local Processing Logic**.
    -   This could be done by instantiating `LocalFileStrategy` with the temp file path.
    -   Or by recursively calling `processItem` with a `file://` URL pointing to the temp file.
4.  **Cleanup**: Use `try/finally` blocks to ensure the temporary file is deleted after scraping is complete or if an error occurs.

### 3. Exclusions/Inclusions
Since we map archive contents to standard file paths/URLs, existing `glob` patterns for include/exclude will work naturally.

## Edge Cases

-   **Nested Archives**: If `foo.zip` contains `bar.tar`, the system should be able to treat `bar.tar` as a directory.
    -   *Decision*: For V1, we will support only one level of archive traversal. If an archive is inside an archive, `LocalFileStrategy` sees it as a file. The `ArchiveAdapter` would need to support reading from a stream instead of a file path to fully support nesting, which adds complexity.

-   **Web Links to Archives**:
    -   User explicitly requested **NOT** to process archives found during web crawling.
    -   `WebScraperStrategy` will filter out archive links unless it is the Root URL.
