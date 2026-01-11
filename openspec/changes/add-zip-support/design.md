# Design: ZIP File Support

## Architecture

### 1. Unified ZIP Handling (LocalFileStrategy)
The core logic for traversing ZIPs will reside in or be used by `LocalFileStrategy`. We will treat ZIP archives as "virtual directories".

#### Virtual Path Resolution
When `LocalFileStrategy` receives a URL (e.g., `file:///path/to/data.zip/docs/readme.md`):
1.  It attempts to `fs.stat` the path.
2.  If `fs.stat` fails (ENOENT), it traverses up the path hierarchy to find the longest existing prefix that is a file.
3.  If found (e.g., `/path/to/data.zip`), it checks if the file is a valid ZIP archive (magic bytes or extension).
4.  If valid, it treats the remainder of the path (`docs/readme.md`) as an entry within the ZIP.

#### Directory Listing
When processing a ZIP file (or a directory within a ZIP):
1.  List all entries in the ZIP.
2.  Filter entries that match the current "directory" prefix.
3.  Return them as `file://` URLs.

#### Content Reading
When reading a file within a ZIP:
1.  Open the ZIP archive.
2.  Extract the specific entry buffer.
3.  Return `RawContent` with appropriate MIME type detection.

### 2. Web ZIP Handling (WebScraperStrategy)
`WebScraperStrategy` needs to identify when the **Root URL** is a ZIP file.

1.  **Detection**: Check URL extension (`.zip`) or perform a `HEAD` request to check `Content-Type: application/zip`.
2.  **Download**: Stream the response to a temporary file (e.g., using `tmp` or `os.tmpdir()`).
3.  **Handoff**:
    -   Once downloaded, the strategy delegates to the **Local Processing Logic**.
    -   This could be done by instantiating `LocalFileStrategy` with the temp file path.
    -   Or by recursively calling `processItem` with a `file://` URL pointing to the temp file.
4.  **Cleanup**: Ensure the temporary file is deleted after scraping is complete.

### 3. Exclusions/Inclusions
Since we map ZIP contents to standard file paths/URLs, existing `glob` patterns for include/exclude will work naturally.

## Edge Cases

-   **Nested ZIPs**: If `foo.zip` contains `bar.zip`, the system should be able to treat `bar.zip` as a directory (`.../foo.zip/bar.zip/file.txt`). The "longest prefix" logic handles this naturally if implemented recursively (find `foo.zip`, open, find `bar.zip` entry, treat as ZIP stream?). *Constraint*: `adm-zip` works on files. Handling nested ZIPs purely in memory might require buffering `bar.zip` to a temp file or using a stream-capable library.
    -   *Decision*: For V1, we will support only one level of ZIP traversal (or require nested ZIPs to be extracted to temp). Given the complexity of nested in-memory ZIPs, we might limit to **File-based ZIPs**. If a ZIP is inside a ZIP, `LocalFileStrategy` sees it as a file. If we want to traverse it, we'd need to extract it.
    -   *Refinement*: The user requirement implies recursion ("subdirectory expectation"). We will attempt to support it if feasible, but strictly speaking, the user asked for "ZIP file ... treated like a directory".
    -   *MVP*: We will focus on physical ZIP files. Nested ZIPs inside ZIPs might just be listed as files unless we implement complex nested extraction.

-   **Web Links to ZIPs**:
    -   User explicitly requested **NOT** to process ZIPs found during web crawling.
    -   `WebScraperStrategy` will filter out `.zip` links unless it is the Root URL.
