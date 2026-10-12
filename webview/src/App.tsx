import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ModelRef, UiState } from "../../shared/protocol.js";
import { Composer, type ComposerHandle } from "./components/Composer.js";
import { MessageList } from "./components/MessageList.js";
import { ModelPicker } from "./components/ModelPicker.js";
import { onHostMessage, vscode } from "./vscode.js";

export function App(): React.ReactElement {
  const [state, setState] = useState<UiState | null>(null);
  const composer = useRef<ComposerHandle>(null);

  useEffect(() => {
    const off = onHostMessage((message) => {
      if (message.type === "state") setState(message.state);
      else if (message.type === "focusInput") composer.current?.focus();
    });
    vscode().postMessage({ type: "ready" });
    return off;
  }, []);

  const send = useCallback((text: string) => {
    vscode().postMessage({ type: "send", text });
  }, []);

  const abort = useCallback(() => {
    vscode().postMessage({ type: "abort" });
  }, []);

  const selectModel = useCallback((model: ModelRef | null) => {
    vscode().postMessage({ type: "selectModel", model });
  }, []);

  const newSession = useCallback(() => {
    vscode().postMessage({ type: "newSession" });
  }, []);

  const refreshModels = useCallback(() => {
    vscode().postMessage({ type: "refreshModels" });
  }, []);

  if (!state) {
    return (
      <div className="app app--loading">
        <div className="spinner" aria-label="Loading" />
        <span>Connecting to OpenCode…</span>
      </div>
    );
  }

  const workspaceName = state.workspace.split(/[\\/]/).filter(Boolean).pop() ?? state.workspace;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__row">
          <ModelPicker
            models={state.models}
            selected={state.selectedModel}
            disabled={state.status !== "ready"}
            onSelect={selectModel}
            onRefresh={refreshModels}
          />
          <button
            className="icon-button"
            title="New chat"
            aria-label="New chat"
            onClick={newSession}
            disabled={state.status !== "ready"}
          >
            <NewChatIcon />
          </button>
        </div>
        <div className="topbar__sub">
          <span className="workspace" title={state.workspace}>
            {workspaceName}
          </span>
          {state.sessionTitle ? <span className="session-title">{state.sessionTitle}</span> : null}
          <StatusDot state={state} />
        </div>
      </header>

      <main className="chat">
        {state.status !== "ready" ? (
          <div className="notice">
            <span>{state.status === "error" ? "Failed to start OpenCode" : "Starting OpenCode service…"}</span>
            {state.error ? <pre className="notice__error">{state.error}</pre> : null}
          </div>
        ) : state.messages.length === 0 ? (
          <div className="empty">
            <div className="empty__logo">◇</div>
            <h2>How can I help?</h2>
            <p>Ask a question about this workspace, or request a change.</p>
          </div>
        ) : (
          <MessageList messages={state.messages} busy={state.busy} activity={state.activity} />
        )}
      </main>

      <Composer ref={composer} disabled={state.status !== "ready"} busy={state.busy} onSend={send} onAbort={abort} />
    </div>
  );
}

function StatusDot({ state }: { state: UiState }): React.ReactElement {
  const label =
    state.status === "ready"
      ? state.busy
        ? state.activity ?? "Working…"
        : "Ready"
      : state.statusText ?? (state.status === "error" ? "Error" : "Connecting…");
  return (
    <span className={`status status--${state.status}${state.busy ? " status--busy" : ""}`} title={state.error ?? label}>
      <span className="status__dot" />
      <span className="status__label">{label}</span>
    </span>
  );
}

function NewChatIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
