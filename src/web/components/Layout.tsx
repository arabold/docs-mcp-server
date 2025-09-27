/**
 * Defines the shared HTML skeleton for all web pages, including the global
 * header with version badge and the hook for client-side update notifications.
 * The component resolves the current version from props or package metadata
 * and renders placeholders that AlpineJS hydrates at runtime.
 */
import type { PropsWithChildren } from "@kitajs/html";
import { readFileSync } from "node:fs";
import { logger } from "../../utils/logger";

/**
 * Props for the Layout component.
 */
interface LayoutProps extends PropsWithChildren {
  title: string;
  /** Optional version string to display next to the title. */
  version?: string;
}

/**
 * Base HTML layout component for all pages.
 * Includes common head elements, header, and scripts.
 * @param props - Component props including title, version, and children.
 */
const Layout = ({ title, version, children }: LayoutProps) => {
  let versionString = version;
  if (!versionString) {
    // If no version is provided, use the version from package.json
    // We cannot bake the version into the bundle, as the package.json will
    // be updated by the build process, after the bundle is created.
    try {
      const packageJson = JSON.parse(readFileSync("package.json", "utf-8")) as {
        version: string;
      };
      versionString = packageJson.version;
      logger.debug(`Resolved version from package.json: ${versionString}`);
    } catch (error) {
      logger.error(`Error reading package.json: ${error}`);
    }
  }
  const versionInitializer = `versionUpdate({ currentVersion: ${
    versionString ? `'${versionString}'` : "null"
  } })`;

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title safe>{title}</title>

        {/* Favicons */}
        <link
          rel="apple-touch-icon"
          sizes="57x57"
          href="/apple-icon-57x57.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="60x60"
          href="/apple-icon-60x60.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="72x72"
          href="/apple-icon-72x72.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="76x76"
          href="/apple-icon-76x76.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="114x114"
          href="/apple-icon-114x114.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="120x120"
          href="/apple-icon-120x120.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="144x144"
          href="/apple-icon-144x144.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="152x152"
          href="/apple-icon-152x152.png"
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/apple-icon-180x180.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="192x192"
          href="/android-icon-192x192.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="96x96"
          href="/favicon-96x96.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon-16x16.png"
        />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="msapplication-TileColor" content="#ffffff" />
        <meta name="msapplication-TileImage" content="/ms-icon-144x144.png" />
        <meta name="theme-color" content="#ffffff" />
        {/* Bundled CSS (includes Tailwind and Flowbite) */}
        <link rel="stylesheet" href="/assets/main.css" />
        {/* Add style for htmx-indicator behavior (needed globally) */}
        <style>
          {`
          .htmx-indicator {
            display: none;
          }
          .htmx-request .htmx-indicator {
            display: block;
          }
          .htmx-request.htmx-indicator {
            display: block;
          }
          /* Default: Hide skeleton, show results container */
          #searchResultsContainer .search-skeleton { display: none; }
          #searchResultsContainer .search-results { display: block; } /* Or as needed */

          /* Request in progress: Show skeleton, hide results */
          #searchResultsContainer.htmx-request .search-skeleton { display: block; } /* Or flex etc. */
          #searchResultsContainer.htmx-request .search-results { display: none; }

          /* Keep button spinner logic */
          form .htmx-indicator .spinner { display: flex; }
          form .htmx-indicator .search-text { display: none; }
          form .spinner { display: none; }
          `}
        </style>
      </head>
      <body class="bg-gray-50 dark:bg-gray-900">
        {/* Full-width header with grounded.tools branding */}
        <header
          class="bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700"
          x-data={versionInitializer}
          x-init="queueCheck()"
        >
          <div class="container max-w-2xl mx-auto px-4 py-4">
            {/* Large screens: single row layout */}
            <div class="hidden sm:flex items-center justify-between">
              <div class="flex items-center gap-3">
                <a
                  href="https://grounded.tools"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xl font-medium text-gray-900 dark:text-white hover:text-primary-500 dark:hover:text-primary-400 transition-colors font-brand"
                >
                  <span class="text-primary-600 dark:text-primary-300">
                    grounded
                  </span>
                  <span class="text-accent-500">.</span>
                  <span class="text-gray-900 dark:text-gray-100">tools</span>
                </a>
                <span class="text-gray-400 dark:text-gray-400">|</span>
                <a
                  href="/"
                  class="text-lg font-semibold text-gray-900 dark:text-white hover:text-primary-500 dark:hover:text-primary-400 transition-colors font-brand"
                >
                  Docs MCP Server
                </a>
                {versionString ? (
                  <span
                    safe
                    class="text-sm font-normal text-gray-500 dark:text-slate-400"
                    title={`Version ${versionString}`}
                  >
                    v{versionString}
                  </span>
                ) : null}
              </div>
              <div>
                <span
                  x-show="hasUpdate"
                  x-cloak
                  class="inline-flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30"
                  role="status"
                  aria-live="polite"
                >
                  <span class="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-amber-800 dark:text-amber-900 text-xs font-bold">
                    !
                  </span>
                  <a
                    x-bind:href="latestReleaseUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
                  >
                    <span class="mr-1">Update available</span>
                  </a>
                </span>
              </div>
            </div>

            {/* Small screens: stacked layout */}
            <div class="sm:hidden space-y-2">
              {/* Row 1: grounded.tools branding */}
              <div class="flex justify-center">
                <a
                  href="https://grounded.tools"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xl font-medium text-gray-900 dark:text-white hover:text-primary-500 dark:hover:text-primary-400 transition-colors font-brand"
                >
                  <span class="text-primary-600 dark:text-primary-300">
                    grounded
                  </span>
                  <span class="text-accent-500">.</span>
                  <span class="text-gray-900 dark:text-gray-100">tools</span>
                </a>
              </div>

              {/* Row 2: Docs MCP Server + Version */}
              <div class="flex items-center justify-center gap-2">
                <a
                  href="/"
                  class="text-lg font-semibold text-gray-900 dark:text-white hover:text-primary-500 dark:hover:text-primary-400 transition-colors font-brand"
                >
                  Docs MCP Server
                </a>
                {versionString ? (
                  <span
                    safe
                    class="text-sm font-normal text-gray-500 dark:text-slate-400"
                    title={`Version ${versionString}`}
                  >
                    v{versionString}
                  </span>
                ) : null}
              </div>

              {/* Row 3: Update notification */}
              <div class="flex justify-center">
                <span
                  x-show="hasUpdate"
                  x-cloak
                  class="inline-flex items-center gap-2 rounded-full bg-amber-100 dark:bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30"
                  role="status"
                  aria-live="polite"
                >
                  <span class="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-amber-800 dark:text-amber-900 text-xs font-bold">
                    !
                  </span>
                  <a
                    x-bind:href="latestReleaseUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
                  >
                    <span class="mr-1">Update available</span>
                  </a>
                </span>
              </div>
            </div>
          </div>
        </header>

        <div class="container max-w-2xl mx-auto px-4 py-6">
          <main>{children}</main>
        </div>

        {/* Bundled JS (includes Flowbite, HTMX, AlpineJS, and initialization) */}
        <script type="module" src="/assets/main.js"></script>
      </body>
    </html>
  );
};

export default Layout;
