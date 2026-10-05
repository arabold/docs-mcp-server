/**
 * CLI shim for the preflight check.
 *
 * Keeping CLI effects in a dedicated entry point lets the preflight module be
 * imported by the benchmark orchestrator without running the CLI.
 */
import { runPreflightCli } from "../preflight";

runPreflightCli().catch((err) => {
  console.error(err);
  process.exit(1);
});
