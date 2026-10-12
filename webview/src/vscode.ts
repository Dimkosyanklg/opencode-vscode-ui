import type { HostToWebview, WebviewToHost } from "../../shared/protocol.js";

type VsCodeApi = {
  postMessage(message: WebviewToHost): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): void;
};

declare function acquireVsCodeApi(): VsCodeApi;

let instance: VsCodeApi | undefined;

/** Access the VS Code webview API singleton. */
export function vscode(): VsCodeApi {
  if (!instance) instance = acquireVsCodeApi();
  return instance;
}

/** Subscribe to messages pushed from the extension host. */
export function onHostMessage(handler: (message: HostToWebview) => void): () => void {
  const listener = (event: MessageEvent<HostToWebview>) => handler(event.data);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
