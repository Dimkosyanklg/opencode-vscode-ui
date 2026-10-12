import type {
  ModelRef,
  TokenUsage,
  ToolStatus,
  UiAgent,
  UiMessage,
  UiModel,
  UiPart,
  UiSession,
  UiState,
} from "../../shared/protocol.js";
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
      busy: false,
      activity: undefined,
      error: undefined,
    });
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
        busy: false,
        activity: undefined,
      });
    }
    await this.loadSessions();
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
    if (!trimmed) return;

    // Show the user's message immediately, before any session round-trip.
    const tempId = `local-${Date.now()}`;
    const userMessage: UiMessage = { id: tempId, role: "user", time: Date.now(), text: trimmed };
    this.pushMessage(userMessage);
    this.patch({ messages: this.state.messages, busy: true, activity: "Thinking…", error: undefined });

    try {
      const sessionID = await this.ensureSession();
      const inbox = await this.host.prompt(sessionID, trimmed);
      const realId = inbox?.id;
      if (realId && realId !== tempId) {
        userMessage.id = realId;
        this.messageIndex.delete(tempId);
        this.messageIndex.set(realId, this.state.messages.length - 1);
      }
    } catch (error) {
      this.log("prompt failed", error);
      this.patch({ busy: false, activity: undefined, error: toMessage(error) });
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
};

function buildMessagesFromServer(
  messages: ServerMessage[],
): { list: UiMessage[]; builds: Map<string, AssistantBuild> } {
  const list: UiMessage[] = [];
  const builds = new Map<string, AssistantBuild>();
  const ordered = [...messages].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));
  for (const m of ordered) {
    if (m.type === "user") {
      list.push({ id: m.id, role: "user", time: m.time?.created ?? Date.now(), text: m.text ?? "" });
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
