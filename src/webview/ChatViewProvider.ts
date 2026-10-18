import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { HostToWebview, WebviewToHost } from "../../shared/protocol.js";
import type { SessionController } from "../session/SessionController.js";

/**
 * Renders the sidebar chat webview and bridges its messages to the
 * {@link SessionController} running in the extension host.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "opencode.chat";
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: SessionController,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };
    view.webview.html = this.render(view.webview);

    view.webview.onDidReceiveMessage(async (raw: WebviewToHost) => {
      switch (raw.type) {
        case "ready":
          await this.controller.start();
          this.post({ type: "state", state: this.controller.current });
          break;
        case "send":
          await this.controller.send(raw.text);
          break;
        case "abort":
          await this.controller.abort();
          break;
        case "clearChat":
          await this.controller.clearChat();
          break;
        case "listSessions":
          await this.controller.loadSessions(raw.search);
          break;
        case "openSession":
          await this.controller.openSession(raw.sessionID);
          break;
        case "deleteSession":
          await this.controller.deleteSession(raw.sessionID);
          break;
        case "replyPermission":
          await this.controller.replyPermission(raw.requestID, raw.decision);
          break;
        case "removeAttachment":
          this.controller.removeAttachment(raw.uri, raw.name);
          break;
        case "selectModel":
          await this.controller.selectModel(raw.model);
          break;
        case "selectAgent":
          await this.controller.selectAgent(raw.agent);
          break;
        case "refreshModels":
          await this.controller.refreshModels();
          break;
        case "openServerInfo":
          await vscode.commands.executeCommand("opencode.serverInfo");
          break;
      }
    });
  }

  post(message: HostToWebview): void {
    void this.view?.webview.postMessage(message);
  }

  focusInput(): void {
    this.post({ type: "focusInput" });
  }

  private render(webview: vscode.Webview): string {
    const root = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
    const htmlPath = path.join(root.fsPath, "index.html");

    if (!fs.existsSync(htmlPath)) {
      return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)">
        <h3>OpenCode UI</h3>
        <p>The webview bundle is missing. Run <code>npm run build</code> before launching the extension.</p>
      </body></html>`;
    }

    let html = fs.readFileSync(htmlPath, "utf8");

    // VS Code serves webview resources itself; the crossorigin attribute only
    // gets in the way.
    html = html.replace(/\scrossorigin(="[^"]*")?/g, "");

    // Rewrite `./assets/...` references to webview resource URIs.
    html = html.replace(/(src|href)="([^"]+)"/g, (match, attr: string, url: string) => {
      if (/^(https?:|data:|vscode-webview:|#)/.test(url)) return match;
      const relative = url.replace(/^\.?\//, "");
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(root, relative));
      return `${attr}="${uri}"`;
    });

    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data: https:`,
      "connect-src 'none'",
    ].join("; ");

    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    if (html.includes("</head>")) {
      html = html.replace("</head>", `  ${cspMeta}\n  </head>`);
    } else {
      html = `${cspMeta}\n${html}`;
    }

    return html;
  }
}
