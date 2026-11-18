import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ScraperAccessPolicy } from "../../utils/accessPolicy";
import { logger } from "../../utils/logger";
import { startObscuraProxy } from "./obscuraProxy";

/** A local CDP listener and the lifecycle of its browser process. */
export interface ObscuraServer {
  endpoint: string;
  token: string;
  isRunning: () => boolean;
  close: () => Promise<void>;
}

const children = new Set<ChildProcess>();
const stopChildren = () => {
  for (const child of children) child.kill("SIGKILL");
};

/**
 * Starts a scrape's browser process with an isolated, authenticated CDP endpoint.
 * @param policy - Outbound access policy for all requests made by the browser.
 * @param timeoutMs - Maximum time to wait for the CDP listener to start.
 * @returns The running server and its cleanup function.
 */
export async function startObscura(
  policy: ScraperAccessPolicy,
  timeoutMs: number,
): Promise<ObscuraServer> {
  const executable = process.env.OBSCURA_EXECUTABLE_PATH || "obscura";
  const directory = await mkdtemp(path.join(tmpdir(), "grounded-docs-obscura-"));
  const readyFile = path.join(directory, "ready.json");
  try {
    const proxy = await startObscuraProxy(policy);
    try {
      const token = randomBytes(32).toString("hex");
      /**
       * The proxy enforces the project's allowlist and private-network rules.
       * Obscura must accept private destinations that those rules permit.
       */
      const child = spawn(
        executable,
        [
          "serve",
          "--host",
          "127.0.0.1",
          "--port",
          "0",
          "--ready-file",
          readyFile,
          "--proxy",
          proxy.url,
          "--allow-private-network",
          "--quiet",
        ],
        {
          env: { ...process.env, OBSCURA_CDP_TOKEN: token },
          stdio: "ignore",
          windowsHide: true,
        },
      );
      child.on("error", (error) => {
        logger.debug(`Obscura process error: ${error}`);
      });
      if (children.size === 0) process.once("exit", stopChildren);
      children.add(child);
      const exited = new Promise<void>((resolve) => {
        child.once("close", () => {
          children.delete(child);
          if (children.size === 0) process.removeListener("exit", stopChildren);
          proxy.close();
          resolve();
        });
      });
      const isRunning = () =>
        child.pid !== undefined &&
        child.exitCode === null &&
        child.signalCode === null &&
        !child.killed;
      const close = async () => {
        proxy.close();
        if (isRunning()) child.kill("SIGKILL");
        await exited;
      };

      try {
        await once(child, "spawn");
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (!isRunning()) {
            throw new Error(
              `Obscura exited (${child.exitCode ?? child.signalCode ?? "no PID"})`,
            );
          }
          const ready = await readFile(readyFile, "utf8").catch(
            (error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return undefined;
              throw error;
            },
          );
          if (ready) {
            const record: {
              pid?: number;
              host?: string;
              port?: number;
              websocket_path?: string;
            } = JSON.parse(ready);
            const port = record.port;
            if (
              record.pid !== child.pid ||
              record.host !== "127.0.0.1" ||
              record.websocket_path !== "/devtools/browser" ||
              port === undefined ||
              !Number.isInteger(port) ||
              port < 1 ||
              port > 65535
            ) {
              throw new Error("Obscura published an invalid CDP endpoint");
            }
            return {
              endpoint: `ws://127.0.0.1:${port}/devtools/browser`,
              token,
              isRunning,
              close,
            };
          }
          await delay(25);
        }
        throw new Error(`Obscura did not start within ${timeoutMs}ms`);
      } catch (error) {
        await close();
        throw error;
      }
    } catch (error) {
      proxy.close();
      throw error;
    }
  } catch (error) {
    throw new Error(
      `Could not start Obscura (${executable}). Install Obscura v0.2.7 or set OBSCURA_EXECUTABLE_PATH: ${error}`,
      { cause: error },
    );
  } finally {
    await rm(directory, { recursive: true, force: true }).catch((error) => {
      logger.debug(`Could not remove Obscura's readiness directory: ${error}`);
    });
  }
}
