import { request, type Dispatcher } from "undici";
import { loadConfig } from "./config-store.js";

export class AgentGatewayClient {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string,
  ) {}

  static async fromConfig(): Promise<AgentGatewayClient> {
    const config = await loadConfig();
    if (!config.endpoint) {
      throw new Error("endpoint is not configured. Run: agentctl config set endpoint <url>");
    }
    return new AgentGatewayClient(config.endpoint, config.apiKey);
  }

  async get(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    const url = this.buildURL(path, query);
    return this.requestJSON("GET", url);
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    return this.requestJSON("POST", this.buildURL(path), body);
  }

  async postText(path: string, body?: unknown): Promise<string> {
    return this.requestText("POST", this.buildURL(path), body);
  }

  async postStream(path: string, body: unknown, onChunk: (chunk: string) => void): Promise<void> {
    await this.requestStream("POST", this.buildURL(path), body, onChunk);
  }

  async put(path: string, body?: unknown): Promise<unknown> {
    return this.requestJSON("PUT", this.buildURL(path), body);
  }

  private buildURL(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const base = new URL(this.endpoint);
    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    const relativePath = path.replace(/^\/+/, "");
    base.pathname = `${basePath}${relativePath}`.replace(/\/{2,}/g, "/");
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") {
        base.searchParams.set(key, String(value));
      }
    }
    return base.toString();
  }

  private async requestJSON(method: Dispatcher.HttpMethod, url: string, body?: unknown): Promise<unknown> {
    const text = await this.requestText(method, url, body, "application/json");
    const parsed = parseJSONResponse(text, url);
    return parsed;
  }

  private async requestText(method: Dispatcher.HttpMethod, url: string, body?: unknown, accept = "*/*"): Promise<string> {
    const { headers, payload } = this.buildRequest(method, url, body, accept);
    const response = await request(url, {
      method,
      headers,
      body: payload,
    });
    const text = await response.body.text();
    if (response.statusCode >= 400) {
      throw new Error(`${response.statusCode}: ${errorMessageFromResponse(text)}`);
    }
    return text;
  }

  private async requestStream(method: Dispatcher.HttpMethod, url: string, body: unknown, onChunk: (chunk: string) => void): Promise<void> {
    const { headers, payload } = this.buildRequest(method, url, body, "text/event-stream");
    const response = await request(url, {
      method,
      headers,
      body: payload,
    });
    if (response.statusCode >= 400) {
      const text = await response.body.text();
      throw new Error(`${response.statusCode}: ${errorMessageFromResponse(text)}`);
    }

    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      onChunk(decoder.decode(chunk, { stream: true }));
    }
    const rest = decoder.decode();
    if (rest) {
      onChunk(rest);
    }
  }

  private buildRequest(method: Dispatcher.HttpMethod, url: string, body: unknown, accept = "*/*"): { headers: Record<string, string>; payload?: string } {
    const headers: Record<string, string> = {
      accept,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    if (process.env.AGENTCTL_DEBUG === "1") {
      console.error(`${method} ${url}`);
    }
    return { headers, payload };
  }
}

function errorMessageFromResponse(text: string): string {
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  return typeof parsed === "object" && parsed && "error" in parsed ? String((parsed as any).error) : text;
}

function parseJSONResponse(text: string, url: string): unknown {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`expected JSON response from ${url}, got: ${preview}`);
  }
}
