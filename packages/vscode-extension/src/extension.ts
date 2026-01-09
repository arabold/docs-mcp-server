import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import * as fs from "fs";

let serverProcess: cp.ChildProcessWithoutNullStreams | undefined;
let serverPort: number | undefined;

// Theme mapping script to inject into Webview
const themeScript = `
  (function() {
    // 1. Get reference to Iframe
    const iframe = document.querySelector('iframe');
    
    function resolveTheme() {
        const body = document.body;
        const isDark = body.classList.contains('vscode-dark');
        const style = window.getComputedStyle(body);
        
        return {
            mode: isDark ? 'dark' : 'light',
            vars: {
                '--color-primary-500': style.getPropertyValue('--vscode-button-background').trim(),
                '--color-primary-600': style.getPropertyValue('--vscode-button-hoverBackground').trim(), 
                '--color-surface-50': style.getPropertyValue('--vscode-editor-background').trim(), 
                '--color-text-900': style.getPropertyValue('--vscode-editor-foreground').trim(),
                '--color-text-500': style.getPropertyValue('--vscode-descriptionForeground').trim(),
                '--color-border': style.getPropertyValue('--vscode-widget-border').trim(),
            }
        };
    }
    
    function updateTheme() {
        if (!iframe || !iframe.contentWindow) return;
        const themeData = resolveTheme();
        iframe.contentWindow.postMessage({ type: 'theme', ...themeData }, '*');
    }

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    
    if (iframe) {
        iframe.onload = updateTheme;
        setTimeout(updateTheme, 500); // Retry just in case
    }
  })();
`;

// ... (imports)

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Grounded Docs");
  outputChannel.appendLine("Extension activating...");

  // 1. Resolve Server Path
  const resolvedPath = await resolveServerPath(context);
  if (!resolvedPath) {
    outputChannel.appendLine("Could not find server entry point.");
    vscode.window.showErrorMessage("Grounded Docs: Could not find server entry point.");
    return;
  }
  const serverPath = resolvedPath;
  const serverDir = path.dirname(serverPath);
  const packageJsonPath = path.join(serverDir, "package.json");
  const nodeModulesPath = path.join(serverDir, "node_modules");

  // Check if dependencies need installation
  if (fs.existsSync(packageJsonPath) && !fs.existsSync(nodeModulesPath)) {
    const selection = await vscode.window.showInformationMessage(
      "Grounded Docs detected missing dependencies. Install them now?",
      "Install",
      "Cancel",
    );

    if (selection !== "Install") {
      vscode.window.showWarningMessage(
        "Grounded Docs might fail to start without dependencies.",
      );
    } else {
      await installDependencies(serverDir, outputChannel);
    }
  }

  // 3. Start Server
  try {
    serverPort = await startServer(serverPath, outputChannel);
    outputChannel.appendLine(`Server started on port ${serverPort}`);
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to start Grounded Docs Server: ${e}`);
    return;
  }

  // 3. Register MCP Provider
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("docs-mcp-server", {
      provideMcpServerDefinitions: async () => {
        return [
          {
            label: "Grounded Docs",
            type: "sse",
            uri: vscode.Uri.parse(`http://localhost:${serverPort}/sse`),
            headers: {},
          },
        ];
      },
    }),
  );

  // 4. Register Webview Command
  context.subscriptions.push(
    vscode.commands.registerCommand("docs.openDashboard", () => {
      const panel = vscode.window.createWebviewPanel(
        "docsDashboard",
        "Grounded Docs Dashboard",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );
      panel.webview.html = getWebviewContent(serverPort!);
    }),
  );

  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ) => {
    // Helper to fetch from local server
    const fetchSearch = async (query: string) => {
      try {
        const response = await fetch(
          `http://localhost:${serverPort}/api/search?q=${encodeURIComponent(query)}`,
        );
        if (!response.ok) throw new Error(response.statusText);
        const data = (await response.json()) as { results: any[] };
        return data.results;
      } catch (e) {
        return [];
      }
    };

    if (request.command === "search") {
      stream.progress("Searching documentation...");
      const results = await fetchSearch(request.prompt);

      if (results.length === 0) {
        stream.markdown("No results found.");
      } else {
        stream.markdown(`### Search Results for "${request.prompt}"\n\n`);
        for (const res of results) {
          // Assuming structure of result has title, url, snippet
          const title = res.metadata?.title || res.url || "Untitled";
          const url = res.url || "#";
          const snippet = res.content?.slice(0, 200).replace(/\n/g, " ") + "...";
          stream.markdown(`- [${title}](${url})\n  _${snippet}_\n\n`);
        }
      }
      return;
    }

    // Default or "ask" command: RAG
    if (request.command === "ask" || !request.command) {
      stream.progress("Thinking...");

      // 1. Search first to get context
      const results = await fetchSearch(request.prompt);
      const contextText = results
        .map(
          (r: any) =>
            `Title: ${r.metadata?.title}\nURL: ${r.url}\nContent: ${r.content.slice(0, 500)}...`,
        )
        .join("\n\n");

      try {
        const [model] = await vscode.lm.selectChatModels({
          vendor: "copilot",
          family: "gpt-4o",
        });

        if (model) {
          const messages = [
            vscode.LanguageModelChatMessage.User(`
              You are the Grounded Docs agent.
              User Question: "${request.prompt}"
              
              Here is some relevant documentation context found on the server:
              ${contextText ? contextText : "No relevant documentation found."}
              
              Answer the user's question using the context provided. 
              If the context doesn't have the answer, say so, but try to be helpful.
              Always cite your sources if you use the context.
            `),
          ];

          const chatResponse = await model.sendRequest(messages, {}, token);
          for await (const fragment of chatResponse.text) {
            stream.markdown(fragment);
          }
        } else {
          stream.markdown(
            "Please ensure GitHub Copilot is active and a compatible model is available.",
          );
        }
      } catch (err) {
        stream.markdown(`Error: ${err}`);
      }
    }
  };

  const participant = vscode.chat.createChatParticipant("docs.chatParticipant", handler);
  participant.iconPath = vscode.Uri.file(
    path.join(context.extensionPath, "assets", "icon.png"),
  ); // Ensure you have an icon or remove this
  context.subscriptions.push(participant);
}

export function deactivate() {
  if (serverProcess) {
    serverProcess.kill();
  }
}

async function resolveServerPath(
  context: vscode.ExtensionContext,
): Promise<string | null> {
  // Check bundled path
  let potentialPath = path.join(context.extensionPath, "server", "index.js");
  if (fs.existsSync(potentialPath)) return potentialPath;

  // Check dev path (../../dist/index.js)
  potentialPath = path.join(context.extensionPath, "..", "..", "dist", "index.js");
  if (fs.existsSync(potentialPath)) return potentialPath;

  return null;
}

// ... (startServer implementation updated below)

async function startServer(
  scriptPath: string,
  output: vscode.OutputChannel,
): Promise<number> {
  const config = vscode.workspace.getConfiguration("docs-mcp-server");
  const configuredPort = config.get<number>("port") || 0;
  const storePath = config.get<string>("storePath") || "";

  // If no explicit configuration, try to find node in common locations
  // This is necessary because VS Code on macOS doesn't always inherit shell PATH
  let runtimePath = config.get<string>("runtimePath");
  let runtimeDir = "";

  if (!runtimePath) {
    const { node } = await findNodeAndNpm();
    runtimePath = node;
    runtimeDir = path.dirname(node);
  } else {
    runtimeDir = path.dirname(runtimePath);
  }

  return new Promise((resolve, reject) => {
    const args = ["--port", configuredPort.toString(), "--protocol", "http"];
    if (storePath) {
      args.push("--store-path", storePath);
    }

    output.appendLine(`Spawning server: ${runtimePath} ${scriptPath} ${args.join(" ")}`);

    // Prepare environment with node in PATH
    const env = { ...process.env };
    if (runtimeDir) {
      env.PATH = runtimeDir + path.delimiter + (env.PATH || "");
    }

    serverProcess = cp.spawn(runtimePath!, [scriptPath, ...args], { env });

    serverProcess.stdout.on("data", (data) => {
      const line = data.toString();
      output.append(line);

      // Parse port from log: "available at http://127.0.0.1:51234" or similar
      // RegEx specific to our server's log output: "available at .*:(?<port>\d+)"
      const match = line.match(/available at .*?:(\d+)/);
      if (match && match[1]) {
        resolve(parseInt(match[1]));
      }
    });

    serverProcess.stderr.on("data", (data) => {
      output.append(`[ERR] ${data.toString()}`);
    });

    serverProcess.on("error", (err) => {
      reject(err);
    });

    serverProcess.on("exit", (code) => {
      output.appendLine(`Server exited with code ${code}`);
    });
  });
}

async function findNodeAndNpm(): Promise<{ node: string; npm: string }> {
  // 1. Check if tools are in PATH
  let node = "node";
  let npm = "npm";

  try {
    cp.execSync("node --version");
  } catch (e) {
    node = ""; // Not in path
  }

  try {
    cp.execSync("npm --version");
  } catch (e) {
    npm = ""; // Not in path
  }

  if (node && npm) return { node, npm };

  // 2. Check common paths if not found
  const commonPaths = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"];

  // Add NVM paths dynamically
  const nvmBase = path.join(process.env.HOME || "", ".nvm", "versions", "node");
  if (fs.existsSync(nvmBase)) {
    try {
      const versions = fs.readdirSync(nvmBase).sort().reverse();
      for (const v of versions) {
        commonPaths.push(path.join(nvmBase, v, "bin"));
      }
    } catch (e) {}
  }

  // Try hardcoded guesses as last resort
  commonPaths.push(process.env.HOME + "/.nvm/versions/node/v22.20.0/bin");
  commonPaths.push(process.env.HOME + "/.nvm/versions/node/v20.0.0/bin");

  for (const dir of commonPaths) {
    const nodePath = path.join(dir, "node");
    const npmPath = path.join(dir, "npm");

    if (!node && fs.existsSync(nodePath)) {
      node = nodePath;
    }
    if (!npm && fs.existsSync(npmPath)) {
      npm = npmPath;
    }
  }

  // Fallbacks
  return {
    node: node || "node",
    npm: npm || "npm",
  };
}

function getWebviewContent(port: number) {
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Docs Dashboard</title>
        <style>
            body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; background-color: transparent; }
            iframe { width: 100%; height: 100%; border: none; }
        </style>
    </head>
    <body>
        <iframe src="http://localhost:${port}/"></iframe>
        <script>
            ${themeScript}
        </script>
    </body>
    </html>`;
}

async function installDependencies(
  cwd: string,
  output: vscode.OutputChannel,
): Promise<void> {
  const { node, npm } = await findNodeAndNpm();

  return new Promise(async (resolve, reject) => {
    output.show();
    output.appendLine(`Installing dependencies in ${cwd}...`);
    output.appendLine(`Using npm: ${npm}`);
    output.appendLine(`Using node: ${node}`);

    // Create environment with node directory in PATH
    const env = { ...process.env };
    const nodeDir = path.dirname(node);
    if (nodeDir && nodeDir !== ".") {
      const newPath = nodeDir + path.delimiter + (env.PATH || "");
      env.PATH = newPath;
      output.appendLine(`Updated PATH for install: ${newPath}`);
    }

    const installProcess = cp.spawn(npm, ["ci", "--omit=dev"], {
      cwd,
      shell: true,
      env,
    });

    installProcess.stdout.on("data", (data) => output.append(data.toString()));
    installProcess.stderr.on("data", (data) => output.append(data.toString()));

    installProcess.on("exit", (code) => {
      if (code === 0) {
        output.appendLine("Dependencies installed successfully.");
        resolve();
      } else {
        output.appendLine(`npm install failed with code ${code}`);
        reject(new Error(`npm install failed with code ${code}`));
      }
    });

    installProcess.on("error", (err) => {
      output.appendLine(`Failed to spawn npm: ${err.message}`);
      reject(err);
    });
  });
}
