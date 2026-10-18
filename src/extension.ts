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
    vscode.commands.registerCommand("opencode.addToChat", async (resource?: vscode.Uri, resources?: vscode.Uri[]) => {
      const uris = (resources && resources.length ? resources : resource ? [resource] : []).filter(
        (uri) => uri && uri.scheme === "file",
      );
      if (uris.length === 0) return;
      await controller.attachFiles(uris.map((uri) => uri.toString()));
      await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
      provider.focusInput();
    }),
    vscode.commands.registerCommand("opencode.addSelectionToChat", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const ranges = selectionRanges(editor);
      if (!ranges.length) return;
      const uri = editor.document.uri.toString();
      await controller.attachSelections(
        ranges.map((range) => ({ uri, startLine: range.start, endLine: range.end })),
      );
      await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
      provider.focusInput();
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

/**
 * Collect the 1-based line ranges of every non-empty selection in the editor.
 * A selection ending at column 0 of the next line does not include that line.
 */
function selectionRanges(editor: vscode.TextEditor): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const selection of editor.selections) {
    if (selection.isEmpty) continue;
    const start = selection.start.line + 1;
    let end = selection.end.line + 1;
    if (selection.end.character === 0 && selection.end.line > selection.start.line) end -= 1;
    ranges.push({ start, end });
  }
  return ranges;
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
