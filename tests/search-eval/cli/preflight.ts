/**
 * CLI shim for the preflight check.
 *
 * Lives in its own file because vite-node sets `process.argv[1]` to its own
 * binary path rather than the script path, so the conventional
 * `if (import.meta.url === ...)` main-guard can't reliably distinguish
 * "imported" from "executed directly." Splitting CLI from library sidesteps
 * the detection problem entirely.
 */
import { runPreflightCli } from "../preflight";

runPreflightCli().catch((err) => {
  console.error(err);
  process.exit(1);
});
