import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  assertNativeTarget,
  createMcpbArtifactName,
  createMcpbManifest,
  type McpbPackageMetadata,
  MCPB_TARGETS,
} from "../src/build/mcpb";

const MCPB_CLI = "@anthropic-ai/mcpb@2.1.2";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    env: {
      ...process.env,
      HUSKY: "0",
    },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
}

function copyRequiredPath(relativePath: string, stageDirectory: string): void {
  const source = path.join(projectRoot, relativePath);
  if (!existsSync(source)) {
    throw new Error(`Required build output is missing: ${relativePath}`);
  }
  cpSync(source, path.join(stageDirectory, relativePath), { recursive: true });
}

function readPackageMetadata(): McpbPackageMetadata & Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  ) as McpbPackageMetadata & Record<string, unknown>;
}

function createRuntimePackage(
  packageMetadata: McpbPackageMetadata & Record<string, unknown>,
  lockfile: { packages?: Record<string, { version?: string }> },
): Record<string, unknown> {
  const dependencyVersion = (name: string): string => {
    const version = lockfile.packages?.[`node_modules/${name}`]?.version;
    if (!version) throw new Error(`Missing locked version for ${name}`);
    return version;
  };
  return {
    name: packageMetadata.name,
    version: packageMetadata.version,
    private: true,
    type: "module",
    license: packageMetadata.license,
    engines: packageMetadata.engines,
    dependencies: {
      "@langchain/aws": dependencyVersion("@langchain/aws"),
      "@langchain/core": dependencyVersion("@langchain/core"),
      "@langchain/google-genai": dependencyVersion("@langchain/google-genai"),
      "@langchain/google-vertexai": dependencyVersion("@langchain/google-vertexai"),
      "@langchain/openai": dependencyVersion("@langchain/openai"),
      "@modelcontextprotocol/sdk": dependencyVersion("@modelcontextprotocol/sdk"),
      "better-sqlite3": dependencyVersion("better-sqlite3"),
      "env-paths": dependencyVersion("env-paths"),
      "fuse.js": dependencyVersion("fuse.js"),
      mime: dependencyVersion("mime"),
      semver: dependencyVersion("semver"),
      "sqlite-vec": dependencyVersion("sqlite-vec"),
      yaml: dependencyVersion("yaml"),
      zod: dependencyVersion("zod"),
    },
  };
}

function main(): void {
  const targetLabel = readOption("--target");
  if (!targetLabel || !Object.hasOwn(MCPB_TARGETS, targetLabel)) {
    throw new Error(
      `Use --target with one of: ${Object.keys(MCPB_TARGETS).join(", ")}.`,
    );
  }

  const target = MCPB_TARGETS[targetLabel as keyof typeof MCPB_TARGETS];
  assertNativeTarget(target);

  const packageMetadata = readPackageMetadata();
  const lockfile = JSON.parse(
    readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"),
  ) as { packages?: Record<string, { version?: string }> };
  const outputDirectory = path.resolve(
    readOption("--output-dir") ?? path.join(projectRoot, "artifacts"),
  );
  const artifactPath = path.join(
    outputDirectory,
    createMcpbArtifactName(packageMetadata.version, target),
  );
  const temporaryRoot = path.join(tmpdir(), `grounded-docs-mcpb-${process.pid}`);
  const stageDirectory = path.join(temporaryRoot, "bundle");

  rmSync(temporaryRoot, { recursive: true, force: true });
  mkdirSync(stageDirectory, { recursive: true });
  mkdirSync(outputDirectory, { recursive: true });

  try {
    for (const requiredPath of ["mcpb-dist", "LICENSE"]) {
      copyRequiredPath(requiredPath, stageDirectory);
    }

    writeFileSync(
      path.join(stageDirectory, "package.json"),
      `${JSON.stringify(createRuntimePackage(packageMetadata, lockfile), null, 2)}\n`,
    );
    writeFileSync(
      path.join(stageDirectory, "manifest.json"),
      `${JSON.stringify(createMcpbManifest(packageMetadata, target), null, 2)}\n`,
    );

    run(
      "npm",
      ["install", "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false"],
      stageDirectory,
    );
    run(
      "npx",
      ["-y", MCPB_CLI, "validate", path.join(stageDirectory, "manifest.json")],
      projectRoot,
    );
    run("npx", ["-y", MCPB_CLI, "pack", stageDirectory, artifactPath], projectRoot);
    run("npx", ["-y", MCPB_CLI, "info", artifactPath], projectRoot);

    console.log(`✅ MCPB artifact: ${artifactPath}`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
