import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import type { Endpoint } from "@opencode/client/service";
import type { ModelRef, UiAgent, UiFileSuggestion, UiModel } from "../../shared/protocol.js";

type Client = ReturnType<typeof OpenCode.make>;
export type OpenCodeEvent = Awaited<ReturnType<Client["event"]["subscribe"]>> extends AsyncIterable<infer T>
  ? T
  : never;

export type Logger = (message: string, ...args: unknown[]) => void;

/**
 * Thin wrapper around the official `@opencode/client` that owns the connection
 * to the local OpenCode background service.
 */
export class OpenCodeHost {
  private client?: Client;
  private endpoint?: Endpoint;
  private connecting?: Promise<Client>;

  constructor(private readonly log: Logger) {}

  get connected(): boolean {
    return this.client !== undefined;
  }

  get url(): string | undefined {
    return this.endpoint?.url;
  }

  /** Discover or start the local OpenCode service and return a ready client. */
  async connect(onStart?: () => void): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      this.log("ensuring local OpenCode service...");
      const endpoint = await Service.ensure({
        onStart: (reason, previousVersion) => {
          this.log(`starting OpenCode service (${reason}${previousVersion ? `, previous ${previousVersion}` : ""})`);
          onStart?.();
        },
      });
      this.endpoint = endpoint;
      this.log(`connected to OpenCode at ${endpoint.url}`);
      const client = OpenCode.make({
        baseUrl: endpoint.url,
        headers: Service.headers(endpoint),
      });
      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private get c(): Client {
    if (!this.client) throw new Error("OpenCode is not connected yet");
    return this.client;
  }

  async serverInfo() {
    return this.c.server.info();
  }

  async listModels(directory: string): Promise<{ models: UiModel[]; providers: Map<string, string> }> {
    const [modelsRes, providersRes] = await Promise.all([
      this.c.model.list({ location: { directory } }),
      this.c.provider.list({ location: { directory } }).catch(() => ({ data: [] as Array<{ id: string; name: string }> })),
    ]);

    const providers = new Map<string, string>();
    for (const provider of providersRes.data ?? []) providers.set(provider.id, provider.name);

    const models = (modelsRes.data ?? []).map((m) => toUiModel(m, providers.get(m.providerID) ?? m.providerID));
    return { models, providers };
  }

  async listAgents(directory: string): Promise<UiAgent[]> {    const res = await this.c.agent.list({ location: { directory } });
    const agents = (res.data ?? []) as Array<{ id: string; name: string; description?: string; mode: string }>;
    return agents
      .filter((a) => a.mode !== "subagent")
      .map((a) => ({ id: a.id, name: a.name, description: a.description, mode: a.mode }));
  }

  async defaultModel(directory: string): Promise<ModelRef | undefined> {
    const res = await this.c.model.default({ location: { directory } });
    const model = res.data;
    if (!model) return undefined;
    return { id: model.id, providerID: model.providerID };
  }

  async createSession(input: {
    directory: string;
    model?: ModelRef;
    agent?: string;
    title?: string;
  }) {
    return this.c.session.create({
      location: { directory: input.directory },
      model: input.model,
      agent: input.agent,
      title: input.title,
    });
  }

  async switchModel(sessionID: string, model: ModelRef) {
    await this.c.session.switchModel({ sessionID, model });
  }

  async switchAgent(sessionID: string, agent: string) {
    await this.c.session.switchAgent({ sessionID, agent });
  }

  async prompt(
    sessionID: string,
    text: string,
    files?: Array<{
      uri: string;
      name?: string;
      mention?: { start: number; end: number; text: string };
    }>,
  ) {
    return this.c.session.prompt({ sessionID, text, files });
  }

  /** Fuzzy file lookup used by the composer's `@`-mention picker. */
  async findFiles(directory: string, query: string, limit = 20): Promise<UiFileSuggestion[]> {
    const res = await this.c.file.find({
      location: { directory },
      query,
      type: "file",
      limit,
    });
    return (res.data ?? [])
      .filter((entry) => entry.type === "file")
      .map((entry) => {
        const filePath = entry.path.split("\\").join("/").replace(/^\.\//, "");
        return { path: filePath, name: filePath.split("/").pop() ?? filePath };
      });
  }

  async interrupt(sessionID: string) {
    return this.c.session.interrupt({ sessionID });
  }

  async getSession(sessionID: string) {
    return this.c.session.get({ sessionID });
  }

  async getMessages(sessionID: string) {
    const res = await this.c.message.list({ sessionID, order: "asc" });
    return res.data ?? [];
  }

  async listSessions(directory: string, options?: { limit?: number; search?: string; cursor?: string }) {
    return this.c.session.list({
      directory,
      order: "desc",
      limit: options?.limit ?? 40,
      search: options?.search,
      cursor: options?.cursor,
    });
  }

  async removeSession(sessionID: string) {
    await this.c.session.remove({ sessionID });
  }

  async renameSession(sessionID: string, title: string) {
    await this.c.session.update({ sessionID, title });
  }

  async listPermissions(sessionID: string) {
    return this.c.permission.list({ sessionID });
  }

  async replyPermission(
    sessionID: string,
    requestID: string,
    decision: "once" | "always" | "reject",
    message?: string,
  ) {
    await this.c.permission.reply({ sessionID, requestID, decision, message });
  }

  events(signal?: AbortSignal): AsyncIterable<OpenCodeEvent> {
    return this.c.event.subscribe(signal ? { signal } : undefined);
  }
}

function toUiModel(m: any, providerName: string): UiModel {
  const cost = Array.isArray(m.cost) ? m.cost[0] : undefined;
  return {
    key: `${m.providerID}/${m.id}`,
    ref: { id: m.id, providerID: m.providerID },
    name: m.name,
    providerID: m.providerID,
    providerName,
    family: m.family,
    variants: (m.variants ?? []).map((v: { id: string }) => v.id),
    capabilities: {
      tools: Boolean(m.capabilities?.tools),
      input: m.capabilities?.input ?? ["text"],
      output: m.capabilities?.output ?? ["text"],
    },
    cost: cost
      ? {
          input: cost.input ?? 0,
          output: cost.output ?? 0,
          cacheRead: cost.cache?.read ?? 0,
          cacheWrite: cost.cache?.write ?? 0,
        }
      : undefined,
    limit: {
      context: m.limit?.context ?? 0,
      output: m.limit?.output ?? 0,
    },
    status: m.status ?? "active",
    enabled: m.enabled ?? true,
  };
}

export type { Client };
