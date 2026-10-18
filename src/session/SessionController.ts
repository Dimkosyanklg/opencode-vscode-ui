import type {
  ModelRef,
  PermissionDecision,
  TokenUsage,
  ToolStatus,
  UiAgent,
  UiAttachment,
  UiFileSuggestion,
  UiMessage,
  UiModel,
  UiPart,
  UiPermission,
  UiSession,
  UiState,
} from "../../shared/protocol.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OpenCodeHost, type OpenCodeEvent } from "../opencode/host.js";

type Emit = (state: UiState) => void;

type AssistantBuild = {
  id: string;
  model?: ModelRef;
  agent?: string;
  parts: UiPart[];
  textOrdinals: Map<number, number>;
  reasoningOrdinals: Map<number, number>;
  tools: Map<string, number>;
};

/**
 * Owns the OpenCode session for the sidebar chat and projects the server's
 * event stream into a `UiState` snapshot for the webview.
 */
export class SessionController {
  private readonly host: OpenCodeHost;
  private state: UiState;
  private eventsAbort = new AbortController();
  private started = false;
  private subscribed = false;
  private creating?: Promise<string>;
  private sessionsReload?: ReturnType<typeof setTimeout>;
  private assistant = new Map<string, AssistantBuild>();
  private messageIndex = new Map<string, number>();

  constructor(
    private readonly log: (msg: string, ...args: unknown[]) => void,
    private readonly emit: Emit,
    private workspace: string,
  ) {
    this.host = new OpenCodeHost(log);
    this.state = {
      status: "connecting",
      workspace,
      models: [],
      modelsLoading: true,
      agents: [],
      sessions: [],
      permissions: [],
      attachments: [],
      busy: false,
      messages: [],
    };
  }

  get current(): UiState {
    return this.state;
  }

  setWorkspace(dir: string) {
    if (dir === this.workspace) return;
    this.workspace = dir;
    this.state.workspace = dir;
    this.started = false;
    this.state.models = [];
    this.state.agents = [];
    this.state.modelsLoading = true;
    this.state.sessions = [];
    this.state.sessionID = undefined;
    this.state.messages = [];
    this.state.attachments = [];
    void this.start();
  }

  private patch(partial: Partial<UiState>) {
    this.state = { ...this.state, ...partial };
    this.emit(this.state);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.patch({ status: "connecting", statusText: "Starting OpenCode service…", error: undefined });
    try {
      await this.host.connect(() => this.patch({ statusText: "Starting OpenCode service…" }));
      this.patch({ status: "ready", statusText: undefined, serverUrl: this.host.url });
      // Listen for catalog updates before the first fetch so a late model
      // snapshot is picked up automatically.
      this.subscribeEvents();
      await this.loadCatalog();
      // Sessions are created lazily on the first message so that merely
      // opening the sidebar does not litter history with empty chats.
      void this.loadSessions();
    } catch (error) {
      this.started = false;
      this.log("failed to start OpenCode session", error);
      this.patch({ status: "error", statusText: undefined, error: toMessage(error) });
    }
  }

  /**
   * Load models and agents. The server may report an empty model snapshot until
   * plugins settle, so retry a few times before giving up; the UI can also be
   * refreshed manually or automatically via `model.updated`.
   */
  private async loadCatalog(options: { attempts?: number; quiet?: boolean } = {}): Promise<void> {
    const attempts = options.attempts ?? 4;
    let models: UiModel[] = [];
    let agents: UiAgent[] = [];
    let lastError: unknown;

    if (!options.quiet) this.patch({ modelsLoading: true });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const [catalog, agentList] = await Promise.all([
          this.host.listModels(this.workspace),
          this.host.listAgents(this.workspace).catch(() => [] as UiAgent[]),
        ]);
        models = catalog.models;
        if (agentList.length) agents = agentList;
        if (models.length > 0) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt < attempts) await delay(400 * attempt);
    }

    if (models.length === 0) {
      this.log("model catalog is still empty after retries", lastError ? toMessage(lastError) : "");
      this.patch({ modelsLoading: false, agents });
      return;
    }

    let selected = this.state.selectedModel;
    if (!selected || !models.some((m) => sameRef(m.ref, selected!))) {
      selected = await this.resolveDefaultModel(models);
    }
    this.patch({ models, agents, selectedModel: selected, modelsLoading: false });
  }

  private async resolveDefaultModel(models: UiModel[]): Promise<ModelRef | undefined> {
    try {
      const preferred = await this.host.defaultModel(this.workspace);
      if (preferred && models.some((m) => sameRef(m.ref, preferred))) return preferred;
    } catch {
      // ignore — fall back to the first usable model
    }
    const usable = models.find((m) => m.enabled && m.capabilities.tools) ?? models.find((m) => m.enabled) ?? models[0];
    return usable?.ref;
  }

  async refreshModels(): Promise<void> {
    await this.loadCatalog();
    if (this.state.sessionID && this.state.selectedModel) {
      await this.host.switchModel(this.state.sessionID, this.state.selectedModel).catch(() => undefined);
    }
  }

  async ensureSession(): Promise<string> {
    if (this.state.sessionID) return this.state.sessionID;
    if (this.creating) return this.creating;

    this.creating = (async () => {
      const session = await this.host.createSession({
        directory: this.workspace,
        model: this.state.selectedModel,
        agent: this.state.selectedAgent,
      });
      this.patch({ sessionID: session.id, sessionTitle: session.title });
      this.log(`session ready: ${session.id}`);
      return session.id;
    })();

    try {
      return await this.creating;
    } finally {
      this.creating = undefined;
    }
  }

  /**
   * Clear the conversation. The session is dropped rather than recreated, so
   * the next prompt starts a fresh one and the model loses all prior context.
   */
  async clearChat(): Promise<void> {
    const previous = this.state.sessionID;
    if (previous && this.state.busy) {
      void this.host.interrupt(previous).catch(() => undefined);
    }
    this.messageIndex.clear();
    this.assistant.clear();
    this.patch({
      sessionID: undefined,
      sessionTitle: undefined,
      messages: [],
      permissions: [],
      attachments: [],
      busy: false,
      activity: undefined,
      error: undefined,
    });
  }

  // --- attachments -------------------------------------------------------

  /**
   * Stage files for the composer. Each URI is validated against the file
   * system so a stale reference (deleted file, unreadable path) never reaches
   * the prompt.
   */
  async attachFiles(uris: string[]): Promise<void> {
    await this.stageAttachments(uris.map((uri) => ({ uri })));
  }

  /**
   * Stage code selections (from the editor context menu) as file attachments.
   * OpenCode reads a file attachment by URI, so the underlying file is sent
   * while the chip is labelled with the selected line range.
   */
  async attachSelections(selections: Array<{ uri: string; startLine: number; endLine: number }>): Promise<void> {
    await this.stageAttachments(
      selections.map((selection) => ({
        uri: selection.uri,
        range: { start: selection.startLine, end: selection.endLine },
      })),
    );
  }

  private async stageAttachments(entries: Array<{ uri: string; range?: { start: number; end: number } }>): Promise<void> {
    if (!entries.length) return;
    const attachments = [...this.state.attachments];
    let changed = false;
    for (const entry of entries) {
      const attachment = await this.toAttachment(entry.uri, entry.range);
      if (!attachment) {
        this.log("file could not be attached", entry.uri);
        continue;
      }
      if (attachments.some((a) => isSameAttachment(a, attachment))) continue;
      attachments.push(attachment);
      changed = true;
    }
    if (changed) this.patch({ attachments });
  }

  removeAttachment(uri: string, name: string): void {
    this.patch({
      attachments: this.state.attachments.filter((a) => !(a.uri === uri && a.name === name)),
    });
  }

  /** Resolve a partial `@`-mention to workspace files for the composer picker. */
  async searchFiles(query: string): Promise<UiFileSuggestion[]> {
    if (this.state.status !== "ready") return [];
    try {
      return await this.host.findFiles(this.workspace, query, 20);
    } catch (error) {
      this.log("searchFiles failed", error);
      return [];
    }
  }

  private async toAttachment(
    uri: string,
    range?: { start: number; end: number },
  ): Promise<UiAttachment | undefined> {
    const resolved = resolveAttachment(uri);
    if (!resolved) return undefined;
    let stats: fs.Stats;
    try {
      stats = await fs.promises.stat(resolved.fsPath);
    } catch {
      return undefined;
    }
    if (!stats.isFile() && !stats.isDirectory()) return undefined;
    const isDirectory = stats.isDirectory();
    const base = path.basename(resolved.fsPath) || resolved.fsPath;
    const rangeLabel = range ? `:${range.start}${range.end !== range.start ? `-${range.end}` : ""}` : "";
    return {
      uri: resolved.uri,
      name: isDirectory ? `${base}/` : `${base}${rangeLabel}`,
      detail: this.relativeDetail(resolved.fsPath),
      isDirectory,
      lineStart: range?.start,
      lineEnd: range?.end,
    };
  }

  private relativeDetail(fsPath: string): string {
    const rel = path.relative(this.workspace, fsPath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
    return fsPath;
  }

  // --- session history ---------------------------------------------------

  async loadSessions(search?: string): Promise<void> {
    this.patch({ sessionsLoading: true });
    try {
      const res = await this.host.listSessions(this.workspace, { search });
      const sessions = (res.data ?? []).map(
        (s): UiSession => ({
          id: s.id,
          title: s.title ?? "Untitled",
          timeCreated: s.time?.created ?? 0,
          timeUpdated: s.time?.updated ?? 0,
          model: normalizeRef(s.model),
          cost: typeof s.cost === "number" ? s.cost : undefined,
        }),
      );
      this.patch({ sessions, sessionsLoading: false });
    } catch (error) {
      this.log("loadSessions failed", error);
      this.patch({ sessionsLoading: false });
    }
  }

  async openSession(sessionID: string): Promise<void> {
    if (sessionID === this.state.sessionID) return;

    const previous = this.state.sessionID;
    if (previous && this.state.busy) {
      void this.host.interrupt(previous).catch(() => undefined);
    }
    this.messageIndex.clear();
    this.assistant.clear();
    this.patch({
      sessionID,
      sessionTitle: undefined,
      messages: [],
      permissions: [],
      attachments: [],
      busy: false,
      activity: undefined,
      error: undefined,
    });

    try {
      const [session, messages] = await Promise.all([
        this.host.getSession(sessionID).catch(() => undefined),
        this.host.getMessages(sessionID),
      ]);
      if (this.state.sessionID !== sessionID) return; // switched again meanwhile
      const { list, builds } = buildMessagesFromServer(messages as ServerMessage[]);
      this.assistant = builds;
      this.messageIndex = new Map(list.map((m, i) => [m.id, i]));
      this.patch({
        messages: list,
        sessionTitle: session?.title,
        selectedModel: normalizeRef(session?.model) ?? this.state.selectedModel,
      });
      void this.loadPermissions(sessionID);
    } catch (error) {
      this.log("openSession failed", error);
      this.patch({ error: toMessage(error) });
    }
  }

  async deleteSession(sessionID: string): Promise<void> {
    try {
      await this.host.removeSession(sessionID);
    } catch (error) {
      this.log("deleteSession failed", error);
      this.patch({ error: toMessage(error) });
      return;
    }
    if (this.state.sessionID === sessionID) {
      this.messageIndex.clear();
      this.assistant.clear();
      this.patch({
        sessionID: undefined,
        sessionTitle: undefined,
        messages: [],
        permissions: [],
        attachments: [],
        busy: false,
        activity: undefined,
      });
    }
    await this.loadSessions();
  }

  // --- permissions -------------------------------------------------------

  async replyPermission(requestID: string, decision: PermissionDecision): Promise<void> {
    const request = this.state.permissions.find((p) => p.id === requestID);
    if (!request) return;
    // Optimistically drop the prompt; restore it if the reply fails.
    this.patch({ permissions: this.state.permissions.filter((p) => p.id !== requestID) });
    try {
      await this.host.replyPermission(request.sessionID, requestID, decision);
    } catch (error) {
      this.log("replyPermission failed", error);
      this.patch({
        permissions: [...this.state.permissions, request],
        error: toMessage(error),
      });
    }
  }

  private async loadPermissions(sessionID: string): Promise<void> {
    try {
      const list = await this.host.listPermissions(sessionID);
      if (this.state.sessionID !== sessionID) return;
      this.patch({ permissions: (list ?? []).map(toUiPermission) });
    } catch (error) {
      this.log("loadPermissions failed", error);
    }
  }

  private addPermission(permission: UiPermission): void {
    if (this.state.permissions.some((p) => p.id === permission.id)) return;
    this.state.permissions = [...this.state.permissions, permission];
  }

  private scheduleSessionsReload(): void {
    if (this.sessionsReload) clearTimeout(this.sessionsReload);
    this.sessionsReload = setTimeout(() => {
      this.sessionsReload = undefined;
      void this.loadSessions();
    }, 400);
  }

  async selectModel(ref: ModelRef | null): Promise<void> {
    if (!ref) {
      this.patch({ selectedModel: undefined });
      return;
    }
    const model = this.state.models.find((m) => sameRef(m.ref, ref));
    this.patch({ selectedModel: model?.ref ?? ref });
    if (this.state.sessionID) {
      await this.host.switchModel(this.state.sessionID, model?.ref ?? ref).catch((e) => {
        this.log("switchModel failed", e);
        this.patch({ error: toMessage(e) });
      });
    }
  }

  async selectAgent(id: string | null): Promise<void> {
    this.patch({ selectedAgent: id ?? undefined });
    if (this.state.sessionID && id) {
      await this.host.switchAgent(this.state.sessionID, id).catch((e) => this.log("switchAgent failed", e));
    }
  }

  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    const files = this.state.attachments;
    // A prompt needs either text or at least one attachment.
    if (!trimmed && files.length === 0) return;

    // Show the user's message immediately, before any session round-trip.
    const tempId = `local-${Date.now()}`;
    const userMessage: UiMessage = {
      id: tempId,
      role: "user",
      time: Date.now(),
      text: trimmed,
      attachments: files.length ? files : undefined,
    };
    this.pushMessage(userMessage);
    this.patch({ messages: this.state.messages, attachments: [], busy: true, activity: "Thinking…", error: undefined });

    try {
      const sessionID = await this.ensureSession();
      const mentions = await extractMentions(trimmed, this.workspace);
      const promptFiles = dedupePromptFiles([
        ...files.map((a) => ({ uri: a.uri, name: a.name.replace(/\/$/, "") })),
        ...mentions,
      ]);
      const inbox = await this.host.prompt(sessionID, trimmed, promptFiles);
      const realId = inbox?.id;
      if (realId && realId !== tempId) {
        userMessage.id = realId;
        this.messageIndex.delete(tempId);
        this.messageIndex.set(realId, this.state.messages.length - 1);
      }
    } catch (error) {
      this.log("prompt failed", error);
      // Give the attachments back so the user can retry without re-adding them.
      this.patch({ busy: false, activity: undefined, attachments: files, error: toMessage(error) });
    }
  }

  async abort(): Promise<void> {
    if (!this.state.sessionID) return;
    await this.host.interrupt(this.state.sessionID).catch((e) => this.log("interrupt failed", e));
    this.patch({ busy: false, activity: undefined });
  }

  private pushMessage(message: UiMessage) {
    this.messageIndex.set(message.id, this.state.messages.length);
    this.state.messages.push(message);
  }

  private subscribeEvents(): void {
    if (this.subscribed) return;
    this.subscribed = true;
    void this.eventLoop();
  }

  private async eventLoop(): Promise<void> {
    const signal = this.eventsAbort.signal;
    while (!signal.aborted) {
      try {
        for await (const event of this.host.events(signal)) {
          if (signal.aborted) return;
          this.handleEvent(event);
        }
      } catch (error) {
        if (signal.aborted) return;
        this.log("event stream error", error);
      }
      if (signal.aborted) return;
      // The stream is live-only; reconnect after a short delay.
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  dispose(): void {
    this.eventsAbort.abort();
    if (this.sessionsReload) clearTimeout(this.sessionsReload);
  }

  private handleEvent(event: OpenCodeEvent): void {
    const data = (event as { data?: Record<string, unknown> }).data ?? {};
    const sessionID = data.sessionID as string | undefined;

    // The native stream type union is slightly narrower than the durable log,
    // so switch on the raw string to tolerate additional event types.
    const type: string = (event as { type: string }).type;

    // Server-wide events are not tied to the active session and must be handled
    // before the active-session filter below.
    switch (type) {
      case "model.updated":
      case "provider.updated":
      case "agent.updated":
      case "models-dev.refreshed":
        // The model/provider catalog changed (including the initial snapshot
        // settling after server start) — reload it.
        void this.loadCatalog({ attempts: 2, quiet: true });
        return;
      case "session.created":
      case "session.deleted":
      case "session.moved":
        this.scheduleSessionsReload();
        return;
      case "session.renamed":
        if (sessionID && sessionID === this.state.sessionID) {
          this.patch({ sessionTitle: (data.title as string) ?? this.state.sessionTitle });
        }
        this.scheduleSessionsReload();
        return;
    }

    // Ignore events that do not belong to the active session. While a new chat
    // is being created the active id is undefined, so stale events are dropped.
    if (sessionID && sessionID !== this.state.sessionID) return;

    switch (type) {
      case "session.text.started":
        this.ensureAssistant(data.assistantMessageID as string);
        this.ensureTextPart(data.assistantMessageID as string, data.ordinal as number);
        break;
      case "session.text.delta":
        this.appendDelta(data.assistantMessageID as string, data.ordinal as number, "text", data.delta as string);
        break;
      case "session.text.ended":
        this.setText(data.assistantMessageID as string, data.ordinal as number, data.text as string, "text");
        break;
      case "session.reasoning.started":
        this.ensureAssistant(data.assistantMessageID as string);
        this.ensureTextPart(data.assistantMessageID as string, data.ordinal as number, "reasoning");
        break;
      case "session.reasoning.delta":
        this.appendDelta(data.assistantMessageID as string, data.ordinal as number, "reasoning", data.delta as string);
        break;
      case "session.reasoning.ended":
        this.setText(data.assistantMessageID as string, data.ordinal as number, data.text as string, "reasoning");
        break;
      case "session.tool.input.started":
        this.ensureTool(data.assistantMessageID as string, data.id as string, data.name as string);
        break;
      case "session.tool.called":
        this.ensureTool(data.assistantMessageID as string, data.id as string, undefined, data.input, "running");
        break;
      case "session.tool.success":
        this.setToolResult(data.assistantMessageID as string, data.id as string, "completed", data.content, undefined);
        break;
      case "session.tool.failed":
        this.setToolResult(
          data.assistantMessageID as string,
          data.id as string,
          "error",
          data.content,
          structuredError(data.error),
        );
        break;
      case "session.message.content.updated":
        this.reconcileContent(data.assistantMessageID as string, data.content);
        break;
      case "session.model.selected":
        this.patch({ selectedModel: normalizeRef(data.model) });
        break;
      case "session.step.started": {
        const build = this.ensureAssistant(data.assistantMessageID as string);
        build.agent = (data.agent as string) ?? build.agent;
        build.model = normalizeRef(data.model) ?? build.model;
        const message = this.findAssistant(build.id);
        if (message) {
          message.agent = build.agent;
          message.model = build.model;
        }
        break;
      }
      case "session.usage.updated": {
        const usage = data as { tokens?: unknown; cost?: unknown; assistantMessageID?: string };
        const id = usage.assistantMessageID ?? this.lastAssistantId();
        const message = id ? this.findAssistant(id) : undefined;
        if (message) {
          message.tokens = normalizeTokens(usage.tokens);
          message.cost = typeof usage.cost === "number" ? usage.cost : message.cost;
        }
        break;
      }
      case "session.renamed":
        this.patch({ sessionTitle: (data.title as string) ?? this.state.sessionTitle });
        break;
      case "session.execution.started":
        this.patch({ busy: true, activity: "Working…" });
        break;
      case "session.status": {
        const status = data.status as { type?: string } | undefined;
        if (status?.type === "busy") this.patch({ busy: true });
        else if (status?.type === "idle") this.patch({ busy: false, activity: undefined });
        else if (status?.type === "retry") this.patch({ busy: true, activity: "Retrying…" });
        break;
      }
      case "session.execution.succeeded":
      case "session.execution.interrupted":
        this.patch({ busy: false, activity: undefined });
        void this.reconcileFromServer();
        break;
      case "session.execution.failed":
        this.patch({ busy: false, activity: undefined, error: structuredError(data.error) });
        void this.reconcileFromServer();
        break;
      case "session.idle":
        this.patch({ busy: false, activity: undefined });
        void this.reconcileFromServer();
        break;
      case "permission.asked":
        this.addPermission(toUiPermission(data));
        break;
      case "permission.replied":
        this.state.permissions = this.state.permissions.filter((p) => p.id !== (data.requestID as string));
        break;
      default:
        return;
    }
    this.emit(this.state);
  }

  // --- assistant message builders ---------------------------------------

  private ensureAssistant(messageID: string): AssistantBuild {
    let build = this.assistant.get(messageID);
    if (build) return build;
    const model = this.state.selectedModel;
    const agent = this.state.selectedAgent;
    build = {
      id: messageID,
      model,
      agent,
      parts: [],
      textOrdinals: new Map(),
      reasoningOrdinals: new Map(),
      tools: new Map(),
    };
    this.assistant.set(messageID, build);
    // A new assistant turn ends streaming on any previous one.
    for (const message of this.state.messages) {
      if (message.role === "assistant") message.streaming = false;
    }
    const message: UiMessage = {
      id: messageID,
      role: "assistant",
      time: Date.now(),
      model,
      agent,
      parts: build.parts,
      streaming: true,
    };
    this.pushMessage(message);
    return build;
  }

  private findAssistant(messageID: string): Extract<UiMessage, { role: "assistant" }> | undefined {
    const index = this.messageIndex.get(messageID);
    const message = index === undefined ? undefined : this.state.messages[index];
    return message && message.role === "assistant" ? message : undefined;
  }

  private lastAssistantId(): string | undefined {
    for (let i = this.state.messages.length - 1; i >= 0; i -= 1) {
      const message = this.state.messages[i];
      if (message.role === "assistant") return message.id;
    }
    return undefined;
  }

  private ensureTextPart(messageID: string, ordinal: number, kind: "text" | "reasoning" = "text"): UiPart {
    const build = this.ensureAssistant(messageID);
    const map = kind === "text" ? build.textOrdinals : build.reasoningOrdinals;
    const existing = map.get(ordinal);
    if (existing !== undefined) return build.parts[existing];
    const part: UiPart = kind === "text" ? { kind: "text", text: "" } : { kind: "reasoning", text: "" };
    map.set(ordinal, build.parts.length);
    build.parts.push(part);
    return part;
  }

  private appendDelta(messageID: string, ordinal: number, kind: "text" | "reasoning", delta: string) {
    const part = this.ensureTextPart(messageID, ordinal, kind);
    if (part.kind === "text" || part.kind === "reasoning") part.text += delta;
  }

  private setText(messageID: string, ordinal: number, text: string, kind: "text" | "reasoning") {
    const part = this.ensureTextPart(messageID, ordinal, kind);
    if (part.kind === "text" || part.kind === "reasoning") part.text = text;
  }

  private ensureTool(
    messageID: string,
    toolID: string,
    name?: string,
    input?: unknown,
    status: ToolStatus = "running",
  ): UiPart {
    const build = this.ensureAssistant(messageID);
    const existing = build.tools.get(toolID);
    if (existing !== undefined) {
      const part = build.parts[existing];
      if (part.kind === "tool") {
        if (name) part.name = name;
        if (input !== undefined) part.input = input;
        part.status = status;
      }
      return part;
    }
    const part: UiPart = { kind: "tool", id: toolID, name: name ?? "tool", status, input };
    build.tools.set(toolID, build.parts.length);
    build.parts.push(part);
    return part;
  }

  private setToolResult(
    messageID: string,
    toolID: string,
    status: "completed" | "error",
    content: unknown,
    error: string | undefined,
  ) {
    const part = this.ensureTool(messageID, toolID, undefined, undefined, "running");
    if (part.kind !== "tool") return;
    part.status = status;
    part.output = toolText(content);
    if (error) part.error = error;
  }

  private reconcileContent(messageID: string, content: unknown) {
    if (!Array.isArray(content)) return;
    const build = this.ensureAssistant(messageID);
    build.parts.length = 0;
    build.textOrdinals.clear();
    build.reasoningOrdinals.clear();
    build.tools.clear();
    let ordinal = 0;
    for (const item of content) {
      const mapped = mapContentPart(item as Record<string, unknown>);
      if (!mapped) continue;
      if (mapped.kind === "text") build.textOrdinals.set(ordinal++, build.parts.length);
      else if (mapped.kind === "reasoning") build.reasoningOrdinals.set(ordinal++, build.parts.length);
      else if (mapped.kind === "tool") build.tools.set(mapped.id, build.parts.length);
      build.parts.push(mapped);
    }
  }

  /** Re-read the authoritative session state after a turn completes. */
  private async reconcileFromServer(): Promise<void> {
    const sessionID = this.state.sessionID;
    if (!sessionID) return;
    try {
      const [messages, session] = await Promise.all([
        this.host.getMessages(sessionID),
        this.host.getSession(sessionID).catch(() => undefined),
      ]);
      // The user may have started a new chat while this request was in flight.
      if (this.state.sessionID !== sessionID) return;
      const { list, builds } = buildMessagesFromServer(messages as ServerMessage[]);
      this.state.messages = list;
      this.assistant = builds;
      this.messageIndex = new Map(list.map((m, i) => [m.id, i]));
      this.state.busy = false;
      this.state.activity = undefined;
      this.state.sessionTitle = session?.title ?? this.state.sessionTitle;
      this.emit(this.state);
    } catch (error) {
      this.log("reconcile failed", error);
    }
  }
}

type ServerMessage = {
  id: string;
  type: string;
  time?: { created?: number };
  text?: string;
  agent?: string;
  model?: unknown;
  content?: unknown;
  files?: unknown;
};

function buildMessagesFromServer(
  messages: ServerMessage[],
): { list: UiMessage[]; builds: Map<string, AssistantBuild> } {
  const list: UiMessage[] = [];
  const builds = new Map<string, AssistantBuild>();
  const ordered = [...messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
  for (const m of ordered) {
    if (m.type === "user") {
      list.push({
        id: m.id,
        role: "user",
        time: m.time?.created ?? Date.now(),
        text: m.text ?? "",
        attachments: mapServerAttachments(m.files),
      });
      continue;
    }
    if (m.type === "assistant") {
      const build: AssistantBuild = {
        id: m.id,
        model: normalizeRef(m.model),
        agent: m.agent,
        parts: [],
        textOrdinals: new Map(),
        reasoningOrdinals: new Map(),
        tools: new Map(),
      };
      const content = Array.isArray(m.content) ? m.content : [];
      let ordinal = 0;
      for (const item of content) {
        const mapped = mapContentPart(item as Record<string, unknown>);
        if (!mapped) continue;
        if (mapped.kind === "text") build.textOrdinals.set(ordinal++, build.parts.length);
        else if (mapped.kind === "reasoning") build.reasoningOrdinals.set(ordinal++, build.parts.length);
        else if (mapped.kind === "tool") build.tools.set(mapped.id, build.parts.length);
        build.parts.push(mapped);
      }
      builds.set(m.id, build);
      list.push({
        id: m.id,
        role: "assistant",
        time: m.time?.created ?? Date.now(),
        model: build.model,
        agent: build.agent,
        parts: build.parts,
      });
      continue;
    }
    if (m.type === "model-switched") {
      list.push({ id: m.id, role: "notice", time: m.time?.created ?? Date.now(), text: "Model switched", variant: "model" });
    }
  }
  return { list, builds };
}

/** Rebuild attachment chips for a user message loaded from the server. */
function mapServerAttachments(files: unknown): UiAttachment[] | undefined {
  if (!Array.isArray(files) || files.length === 0) return undefined;
  const out: UiAttachment[] = [];
  files.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const file = raw as { name?: unknown; source?: unknown; data?: unknown; mime?: unknown };
    const source = file.source as { type?: unknown; uri?: unknown } | undefined;
    let uri: string | undefined;
    if (source && source.type === "uri" && typeof source.uri === "string") {
      uri = source.uri;
    } else if (typeof file.data === "string") {
      const mime = typeof file.mime === "string" ? file.mime : "application/octet-stream";
      uri = `data:${mime};base64,${file.data}`;
    }
    if (!uri) return;
    const name = typeof file.name === "string" && file.name ? file.name : `attachment ${index + 1}`;
    out.push({ uri, name });
  });
  return out.length ? out : undefined;
}

function mapContentPart(item: Record<string, unknown> | undefined): UiPart | undefined {
  if (!item || typeof item !== "object") return undefined;
  if (item.type === "text") return { kind: "text", text: String(item.text ?? "") };
  if (item.type === "reasoning") return { kind: "reasoning", text: String(item.text ?? "") };
  if (item.type === "tool") {
    const state = (item.state ?? {}) as Record<string, unknown>;
    const status = toolStatus(state.status as string | undefined);
    return {
      kind: "tool",
      id: String(item.id ?? ""),
      name: String(item.name ?? "tool"),
      status,
      input: state.input,
      output: toolText(state.content),
      error: status === "error" ? structuredError(state.error) : undefined,
    };
  }
  return undefined;
}

function toolStatus(status: string | undefined): ToolStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "error":
      return "error";
    case "running":
      return "running";
    default:
      return "pending";
  }
}

function toolText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const item of content) {
    if (item && typeof item === "object" && (item as { type?: string }).type === "text") {
      parts.push(String((item as { text?: string }).text ?? ""));
    }
  }
  return parts.length ? parts.join("\n") : undefined;
}

function structuredError(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const e = error as { message?: string; type?: string };
    return e.message ?? e.type;
  }
  return String(error);
}

function toUiPermission(raw: unknown): UiPermission {
  const r = (raw ?? {}) as Record<string, unknown>;
  const source = r.source as { id?: unknown } | undefined;
  return {
    id: String(r.id ?? ""),
    sessionID: String(r.sessionID ?? ""),
    action: String(r.action ?? "action"),
    resources: Array.isArray(r.resources) ? (r.resources as unknown[]).map(String) : [],
    message: typeof r.message === "string" ? r.message : undefined,
    tool: source && typeof source.id === "string" ? source.id : undefined,
  };
}

function normalizeTokens(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const t = value as { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
  return {
    input: t.input ?? 0,
    output: t.output ?? 0,
    reasoning: t.reasoning ?? 0,
    cacheRead: t.cache?.read ?? 0,
    cacheWrite: t.cache?.write ?? 0,
  };
}

function normalizeRef(value: unknown): ModelRef | undefined {  if (!value || typeof value !== "object") return undefined;
  const ref = value as { id?: unknown; providerID?: unknown; variant?: unknown };
  if (typeof ref.id !== "string" || typeof ref.providerID !== "string") return undefined;
  return {
    id: ref.id,
    providerID: ref.providerID,
    variant: typeof ref.variant === "string" ? ref.variant : undefined,
  };
}

function sameRef(a: ModelRef | undefined, b: ModelRef): boolean {
  return Boolean(a && a.id === b.id && a.providerID === b.providerID);
}

/** Two attachments are the same when they point at the same file/range. */
function isSameAttachment(a: UiAttachment, b: UiAttachment): boolean {
  return Boolean(
    a.uri === b.uri && a.isDirectory === b.isDirectory && a.lineStart === b.lineStart && a.lineEnd === b.lineEnd,
  );
}

/**
 * Normalize a file reference to an absolute path plus a canonical `file:` URL.
 * The Explorer context menu supplies `file:` URLs; absolute paths are accepted
 * as a fallback. Anything else is ignored.
 */
function resolveAttachment(raw: string): { fsPath: string; uri: string } | undefined {
  if (raw.startsWith("file:")) {
    try {
      const fsPath = fileURLToPath(raw);
      return { fsPath, uri: pathToFileURL(fsPath).toString() };
    } catch {
      return undefined;
    }
  }
  if (path.isAbsolute(raw)) {
    return { fsPath: raw, uri: pathToFileURL(raw).toString() };
  }
  return undefined;
}

type PromptFile = {
  uri: string;
  name?: string;
  mention?: { start: number; end: number; text: string };
};

/** Keep the first occurrence of each file so a mentioned+attached file is sent once. */
function dedupePromptFiles(files: PromptFile[]): PromptFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.uri)) return false;
    seen.add(file.uri);
    return true;
  });
}

/**
 * Resolve `@path` tokens in a prompt to workspace files. Only tokens that map
 * to an existing file inside the workspace are returned, so decorators, email
 * addresses and prose are ignored. Positions are relative to `text`.
 */
async function extractMentions(text: string, workspace: string): Promise<PromptFile[]> {
  const pattern = /(^|\s)@([^\s@]+)/g;
  const files: PromptFile[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const relative = match[2];
    const start = match.index + match[1].length;
    const end = start + relative.length + 1;
    const resolved = await resolveMention(workspace, relative);
    if (!resolved) continue;
    files.push({
      uri: pathToFileURL(resolved).toString(),
      name: relative,
      mention: { start, end, text: text.slice(start, end) },
    });
  }
  return files;
}

/** Resolve a workspace-relative mention; reject paths that escape the workspace. */
async function resolveMention(workspace: string, relative: string): Promise<string | undefined> {
  const root = path.resolve(workspace);
  const candidate = path.resolve(root, relative);
  const rel = path.relative(root, candidate);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  try {
    const stats = await fs.promises.stat(candidate);
    return stats.isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
