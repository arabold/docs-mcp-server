import { createContext, runInContext } from "node:vm";
import { type DOMWindow, JSDOM } from "jsdom";
import { logger } from "../../utils/logger";

/**
 * Options for executing JavaScript in a sandboxed JSDOM environment.
 */
export interface SandboxExecutionOptions {
  /** The source URL to associate with the JSDOM instance. */
  url: string;
  /** Maximum execution time for all scripts in milliseconds. Defaults to 5000. */
  timeout?: number;
  /** Initial HTML content. */
  html: string;
  /** Optional callback to fetch external script content. */
  fetchScriptContent?: (url: string) => Promise<string | null>; // Returns null on fetch failure
}

/**
 * Result of executing JavaScript in a sandboxed JSDOM environment.
 */
export interface SandboxExecutionResult {
  /** The final HTML content after script execution. */
  finalHtml: string;
  /** Any errors encountered during script execution. */
  errors: Error[];
}

const DEFAULT_TIMEOUT = 5000; // 5 seconds

/**
 * Executes JavaScript found within an HTML string inside a secure JSDOM sandbox.
 * Uses Node.js `vm` module for sandboxing.
 *
 * @param options - The execution options.
 * @returns A promise resolving to the execution result.
 */
export async function executeJsInSandbox(
  options: SandboxExecutionOptions,
): Promise<SandboxExecutionResult> {
  const { html, url, timeout = DEFAULT_TIMEOUT } = options;
  const errors: Error[] = [];
  let jsdom: JSDOM | undefined;

  try {
    logger.debug(`Creating JSDOM sandbox for ${url}`);
    // Create JSDOM instance *without* running scripts immediately
    jsdom = new JSDOM(html, {
      url,
      runScripts: "outside-only", // We'll run scripts manually in the VM
      pretendToBeVisual: true, // Helps with some scripts expecting a visual environment
      // Consider adding resources: "usable" if scripts need to fetch external resources,
      // but be aware of security implications.
    });

    const { window } = jsdom;

    // Create a VM context with the JSDOM window globals
    // Note: This provides access to the DOM, but not Node.js globals by default
    const context = createContext({
      ...window, // Spread window properties into the context
      window, // Provide window object itself
      document: window.document,
      // Add other globals if needed, e.g., console, setTimeout, etc.
      // Be cautious about exposing potentially harmful APIs.
      console: {
        log: (...args: unknown[]) => logger.debug(`Sandbox log: ${JSON.stringify(args)}`),
        warn: (...args: unknown[]) =>
          logger.debug(`Sandbox warn: ${JSON.stringify(args)}`),
        error: (...args: unknown[]) =>
          logger.debug(`Sandbox error: ${JSON.stringify(args)}`),
      },
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: window.setInterval.bind(window),
      clearInterval: window.clearInterval.bind(window),
    });

    // Find all script elements in the document
    const scripts = Array.from(window.document.querySelectorAll("script"));
    logger.debug(`Found ${scripts.length} script(s) to execute in sandbox for ${url}`);

    for (const script of scripts) {
      const scriptSrc = script.src;
      const scriptType =
        script.type?.toLowerCase().split(";")[0].trim() || "text/javascript"; // Default to JavaScript if type is not specified
      let scriptContentToExecute: string | null = null;
      let scriptSourceDescription = "inline script"; // For logging

      if (scriptSrc) {
        scriptSourceDescription = `external script (src=${scriptSrc})`;
        if (!options.fetchScriptContent) {
          logger.warn(
            `Skipping ${scriptSourceDescription} in sandbox for ${url}: No fetchScriptContent callback provided.`,
          );
          continue;
        }

        let resolvedUrl: string;
        try {
          resolvedUrl = new URL(scriptSrc, url).toString();
          logger.debug(
            `Attempting to fetch ${scriptSourceDescription} from ${resolvedUrl}`,
          );
        } catch (urlError) {
          const message = urlError instanceof Error ? urlError.message : String(urlError);
          logger.warn(
            `Skipping ${scriptSourceDescription}: Invalid URL format - ${message}`,
          );
          errors.push(
            new Error(`Invalid script URL ${scriptSrc} on page ${url}: ${message}`, {
              cause: urlError,
            }),
          );
          continue;
        }

        try {
          scriptContentToExecute = await options.fetchScriptContent(resolvedUrl);
          if (scriptContentToExecute === null) {
            // Fetch callback already logged the specific error and added to context.errors
            logger.warn(
              `Skipping execution of ${scriptSourceDescription} from ${resolvedUrl} due to fetch failure or invalid content.`,
            );
            // Error should have been added by the callback, no need to add again here.
            continue;
          }
          logger.debug(
            `Successfully fetched ${scriptSourceDescription} from ${resolvedUrl}`,
          );
        } catch (fetchError) {
          // Catch errors from the fetchScriptContent callback itself
          const message =
            fetchError instanceof Error ? fetchError.message : String(fetchError);
          logger.error(
            `Error during fetch callback for ${scriptSourceDescription} from ${resolvedUrl}: ${message}`,
          );
          errors.push(
            new Error(`Fetch callback failed for script ${resolvedUrl}: ${message}`, {
              cause: fetchError,
            }),
          );
          continue; // Skip execution if fetch callback throws
        }
      } else {
        // Inline script
        scriptContentToExecute = script.textContent || "";
        if (!scriptContentToExecute.trim()) {
          continue; // Skip empty inline scripts
        }
      }

      // Execute the script (either inline or fetched external)
      const allowedMimeTypes = [
        "application/javascript",
        "text/javascript",
        "application/x-javascript",
      ];
      if (allowedMimeTypes.includes(scriptType) && scriptContentToExecute !== null) {
        logger.debug(`Executing ${scriptSourceDescription} in sandbox for ${url}`);
        try {
          runInContext(scriptContentToExecute, context, {
            timeout,
            displayErrors: true,
          });
        } catch (error) {
          const executionError =
            error instanceof Error
              ? error
              : new Error(`Script execution failed: ${String(error)}`);
          logger.error(
            `Error executing ${scriptSourceDescription} in sandbox for ${url}: ${executionError.message}`,
          );
          // Add context about which script failed
          const errorWithContext = new Error(
            `Error executing ${scriptSourceDescription} from ${scriptSrc || "inline"}: ${executionError.message}`,
            { cause: executionError },
          );
          errors.push(errorWithContext);
          // Continue with other scripts even if one fails
        }
      }
    }

    // Serialize the final state of the DOM after script execution
    const finalHtml = jsdom.serialize();
    logger.debug(`Sandbox execution finished for ${url}`);

    return {
      finalHtml,
      errors,
    };
  } catch (error) {
    const setupError =
      error instanceof Error
        ? error
        : new Error(`Sandbox setup failed: ${String(error)}`);
    logger.error(`Error setting up sandbox for ${url}: ${setupError.message}`);
    // Always wrap the error to provide context
    const wrappedError = new Error(
      `Sandbox setup failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
    logger.error(wrappedError.message); // Log the wrapped error message
    errors.push(wrappedError);
    // If setup fails, return the original HTML and any errors
    return {
      finalHtml: html,
      errors,
    };
  } finally {
    // Clean up the JSDOM window to free resources, especially if timers were set
    jsdom?.window?.close();
  }
}
