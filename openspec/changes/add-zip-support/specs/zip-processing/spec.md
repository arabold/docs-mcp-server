# ZIP Processing Support

## ADDED Requirements

### Requirement: Local Archive Directory Traversal
The system MUST treat local archives (ZIP, TAR, TGZ) as directories when encountered during file scraping. It MUST list the contents of the archive and allow processing of supported file types within it.

#### Scenario: Scraping a local ZIP file
Given a local file `archive.zip` containing `doc.md`
When the scraper processes `file:///path/to/archive.zip`
Then it should identify `archive.zip` as a directory
And it should produce a link to `doc.md`

#### Scenario: Scraping a local TAR.GZ file
Given a local file `data.tar.gz` containing `readme.txt`
When the scraper processes `file:///path/to/data.tar.gz`
Then it should identify `data.tar.gz` as a directory
And it should produce a link to `readme.txt`

### Requirement: Web Root Archive Processing
The system MUST support an archive file URL (ZIP, TAR, TGZ) as a valid Root URL for the Web Scraper. It MUST download the archive and process its contents.

#### Scenario: Scraping a Web Archive Root
Given a URL `https://example.com/docs.tgz`
When the scraper is started with this URL
Then it should download `docs.tgz`
And it should process the contents of the archive file

### Requirement: Web Nested Archive Exclusion
The system MUST NOT process archive files found as links within a web page.

#### Scenario: Ignoring archive links on web pages
Given a web page linking to `backup.tar.gz`
When the scraper crawls the page
Then it should NOT follow the link to `backup.tar.gz`

