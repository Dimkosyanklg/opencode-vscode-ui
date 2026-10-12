import * as vscode from "vscode";
import type { ModelRef } from "../shared/protocol.js";
import { SessionController } from "./session/SessionController.js";
import { ChatViewProvider } from "./webview/ChatViewProvider.js";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("OpenCode UI");
  context.subscriptions.push(output);
  const log = (message: string, ...args: unknown[]) => {
    const suffix = args.length ? ` ${args.map((a) => safeString(a)).join(" ")}` : "";
    output.appendLine(`${new Date().toISOString()} ${message}${suffix}`);
  };

  const workspace = currentWorkspace();
  const controller = new SessionController(log, (state) => provider.post({ type: "state", state }), workspace);
  const provider = new ChatViewProvider(context.extensionUri, controller);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode.clearChat", async () => {
      await controller.clearChat();
      provider.focusInput();
    }),
    vscode.commands.registerCommand("opencode.selectModel", async () => {
      await pickModel(controller);
    }),
    vscode.commands.registerCommand("opencode.serverInfo", async () => {
      const state = controller.current;
      if (state.status === "ready" && state.serverUrl) {
        vscode.window.showInformationMessage(`OpenCode service: ${state.serverUrl}`);
      } else if (state.status === "error") {
        vscode.window.showErrorMessage(`OpenCode: ${state.error ?? "not connected"}`);
      } else {
        vscode.window.showInformationMessage(`OpenCode: ${state.statusText ?? state.status}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      controller.setWorkspace(currentWorkspace());
    }),
    { dispose: () => controller.dispose() },
  );
}

export function deactivate(): void {
  // Nothing to clean up: subscriptions are disposed by VS Code.
}

async function pickModel(controller: SessionController): Promise<void> {
  const state = controller.current;
  if (state.status !== "ready") {
    vscode.window.showWarningMessage("OpenCode is still connecting…");
    return;
  }

  const current = state.selectedModel;
  const pick = await vscode.window.showQuickPick(
    state.models.map((m) => ({
      label: m.name,
      description: m.providerName + (m.enabled ? "" : " · disabled"),
      detail:
        `${formatTokens(m.limit.context)} context · ${m.capabilities.tools ? "tools" : "no tools"}` +
        (m.cost && m.cost.input > 0 ? ` · $${m.cost.input}/M in, $${m.cost.output}/M out` : " · free"),
      model: m.ref,
      picked: Boolean(current && current.id === m.ref.id && current.providerID === m.ref.providerID),
    })),
    { title: "Select OpenCode model", placeHolder: "Choose the model for this chat" },
  );
  if (!pick) return;
  await controller.selectModel(pick.model as ModelRef);
}

function currentWorkspace(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) return folders[0].uri.fsPath;
  return process.cwd();
}

function formatTokens(value: number): string {
  if (!value) return "?";
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

function safeString(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
