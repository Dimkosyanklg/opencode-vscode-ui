/**
 * Shared contract between the VS Code extension host and the webview UI.
 *
 * The extension host owns the source of truth (connection, session, streaming
 * state) and pushes a full `UiState` snapshot to the webview. The webview is a
 * pure renderer that sends user intents back.
 */

export type ModelRef = {
  id: string;
  providerID: string;
  variant?: string;
};

export type ModelCost = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type UiModel = {
  /** `providerID/id` — stable key used across the bridge. */
  key: string;
  ref: ModelRef;
  name: string;
  providerID: string;
  providerName: string;
  family?: string;
  variants: string[];
  capabilities: {
    tools: boolean;
    input: string[];
    output: string[];
  };
  cost?: ModelCost;
  limit: {
    context: number;
    output: number;
  };
  status: "alpha" | "beta" | "deprecated" | "active";
  enabled: boolean;
};

export type UiAgent = {
  id: string;
  name: string;
  description?: string;
  mode: string;
};

export type TokenUsage = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

export type ToolStatus = "pending" | "running" | "completed" | "error";

export type UiPart =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      status: ToolStatus;
      input?: unknown;
      /** Human-readable tool result (text output). */
      output?: string;
      error?: string;
    }
  | { kind: "compaction"; text: string };

export type UiMessage =
  | { id: string; role: "user"; time: number; text: string }
  | {
      id: string;
      role: "assistant";
      time: number;
      agent?: string;
      model?: ModelRef;
      parts: UiPart[];
      cost?: number;
      tokens?: TokenUsage;
      finish?: string;
      error?: string;
      streaming?: boolean;
    }
  | { id: string; role: "notice"; time: number; text: string; variant?: "model" | "agent" | "info" };

export type ConnectionStatus = "connecting" | "ready" | "error";

export type UiState = {
  status: ConnectionStatus;
  /** Human readable detail for the current status (server start, errors...). */
  statusText?: string;
  serverUrl?: string;
  workspace: string;
  sessionID?: string;
  sessionTitle?: string;
  /** The model/provider catalog is being (re)loaded. */
  modelsLoading?: boolean;
  models: UiModel[];
  selectedModel?: ModelRef;
  agents: UiAgent[];
  selectedAgent?: string;
  /** The assistant is currently generating. */
  busy: boolean;
  /** Short description of what is happening right now. */
  activity?: string;
  messages: UiMessage[];
  error?: string;
};

/** Intents sent from the webview to the extension host. */
export type WebviewToHost =
  | { type: "ready" }
  | { type: "send"; text: string }
  | { type: "abort" }
  | { type: "clearChat" }
  | { type: "selectModel"; model: ModelRef | null }
  | { type: "selectAgent"; agent: string | null }
  | { type: "refreshModels" }
  | { type: "openServerInfo" };

/** Messages pushed from the extension host to the webview. */
export type HostToWebview =
  | { type: "state"; state: UiState }
  | { type: "focusInput" };
