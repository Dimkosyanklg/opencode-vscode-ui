import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ModelRef, PermissionDecision, UiAttachment, UiState } from "../../shared/protocol.js";
import { AgentPicker } from "./components/AgentPicker.js";
import { Composer, type ComposerHandle } from "./components/Composer.js";
import { HistoryPicker } from "./components/HistoryPicker.js";
import { MessageList } from "./components/MessageList.js";
import { ModelPicker } from "./components/ModelPicker.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
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

  const selectAgent = useCallback((agent: string) => {
    vscode().postMessage({ type: "selectAgent", agent });
  }, []);

  const clearChat = useCallback(() => {
    vscode().postMessage({ type: "clearChat" });
  }, []);

  const refreshModels = useCallback(() => {
    vscode().postMessage({ type: "refreshModels" });
  }, []);

  const openSession = useCallback((sessionID: string) => {
    vscode().postMessage({ type: "openSession", sessionID });
  }, []);

  const deleteSession = useCallback((sessionID: string) => {
    vscode().postMessage({ type: "deleteSession", sessionID });
  }, []);

  const refreshSessions = useCallback((search?: string) => {
    vscode().postMessage({ type: "listSessions", search });
  }, []);

  const replyPermission = useCallback((requestID: string, decision: PermissionDecision) => {
    vscode().postMessage({ type: "replyPermission", requestID, decision });
  }, []);

  const removeAttachment = useCallback((attachment: UiAttachment) => {
    vscode().postMessage({ type: "removeAttachment", uri: attachment.uri, name: attachment.name });
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
          <AgentPicker
            agents={state.agents ?? []}
            selected={state.selectedAgent}
            loading={state.status === "connecting"}
            disabled={state.status !== "ready"}
            onSelect={selectAgent}
          />
          <ModelPicker
            models={state.models}
            selected={state.selectedModel}
            loading={state.modelsLoading || state.status === "connecting"}
            disabled={state.status !== "ready"}
            onSelect={selectModel}
            onRefresh={refreshModels}
          />
          <HistoryPicker
            sessions={state.sessions ?? []}
            activeID={state.sessionID}
            loading={state.sessionsLoading}
            disabled={state.status !== "ready"}
            onOpen={openSession}
            onDelete={deleteSession}
            onRefresh={refreshSessions}
          />
          <button
            className="icon-button"
            title="Clear chat"
            aria-label="Clear chat"
            onClick={clearChat}
            disabled={state.status !== "ready"}
          >
            <ClearIcon />
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

      <PermissionPrompt permissions={state.permissions ?? []} onReply={replyPermission} />

      <Composer
        ref={composer}
        disabled={state.status !== "ready"}
        busy={state.busy}
        attachments={state.attachments ?? []}
        onRemoveAttachment={removeAttachment}
        onSend={send}
        onAbort={abort}
      />
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

function ClearIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.6h10M6.4 4.6V3.3a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v1.3M4.6 4.6l.55 7.5a1 1 0 0 0 1 .93h3.7a1 1 0 0 0 1-.93l.55-7.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
