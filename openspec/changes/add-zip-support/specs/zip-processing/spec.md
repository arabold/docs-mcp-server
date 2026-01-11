# ZIP Processing Support

## ADDED Requirements

### Requirement: Local ZIP Directory Traversal
The system MUST treat local ZIP archives as directories when encountered during file scraping. It MUST list the contents of the ZIP and allow processing of supported file types within it.

#### Scenario: Scraping a local ZIP file
Given a local file `archive.zip` containing `doc.md` and `image.png`
When the scraper processes `file:///path/to/archive.zip`
Then it should identify `archive.zip` as a directory
And it should produce a link to `doc.md` (e.g., `file:///path/to/archive.zip/doc.md`)
And it should produce a link to `image.png`
And it should process `doc.md` content

#### Scenario: Recursive ZIP discovery
Given a local directory `/data` containing `project.zip`
When the scraper processes `file:///data`
Then it should identify `project.zip` as a subdirectory
And it should traverse into `project.zip` to find contained files

### Requirement: Web Root ZIP Processing
The system MUST support a ZIP file URL as a valid Root URL for the Web Scraper. It MUST download the ZIP and process its contents.

#### Scenario: Scraping a Web ZIP Root
Given a URL `https://example.com/docs.zip`
When the scraper is started with this URL
Then it should download `docs.zip`
And it should process the contents of the ZIP file
And the URLs of the contents should be valid `file://` or `http://` references (implementation detail: likely temp file paths)

### Requirement: Web Nested ZIP Exclusion
The system MUST NOT process ZIP files found as links within a web page, treating them as binary/ignored content.

#### Scenario: Ignoring ZIP links on web pages
Given a web page `https://example.com/index.html` linking to `download.zip`
When the scraper crawls `index.html`
Then it should NOT follow the link to `download.zip` for extraction
And it should NOT attempt to crawl inside `download.zip`
