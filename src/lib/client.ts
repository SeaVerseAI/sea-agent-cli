import { request, WebSocket, type Dispatcher } from "undici";
import { loadConfig } from "./config-store.js";

export class AgentGatewayClient {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey?: string,
  ) {}

  static async fromConfig(): Promise<AgentGatewayClient> {
    const config = await loadConfig();
    if (!config.endpoint) {
      throw new Error("endpoint is not configured. Run: seaagent config set endpoint <url>");
    }
    return new AgentGatewayClient(config.endpoint, config.apiKey);
  }

  async get(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    const url = this.buildURL(path, query);
    return this.requestJSON("GET", url);
  }

  async getText(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<string> {
    return this.requestText("GET", this.buildURL(path, query));
  }

  async getStream(path: string, query: Record<string, string | number | boolean | undefined> | undefined, onChunk: (chunk: string) => void): Promise<void> {
    await this.requestStream("GET", this.buildURL(path, query), undefined, onChunk);
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

  async websocket(path: string, query: Record<string, string | number | boolean | undefined> | undefined, initialMessage: unknown, onMessage: (message: string) => void): Promise<void> {
    const url = this.buildWebSocketURL(path, query);
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    if (isDebugEnabled()) {
      console.error(`WS ${url}`);
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let opened = false;
      const ws = new WebSocket(url, { headers });

      const settle = (err?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };

      ws.addEventListener("open", () => {
        opened = true;
        if (initialMessage !== undefined) {
          ws.send(JSON.stringify(initialMessage));
        }
      });
      ws.addEventListener("message", (event) => {
        try {
          onMessage(webSocketMessageToString(event.data));
        } catch (err) {
          if (ws.readyState === ws.OPEN) {
            ws.close();
          }
          settle(err instanceof Error ? err : new Error(String(err)));
        }
      });
      ws.addEventListener("error", (event) => {
        settle(new Error(errorMessageFromWebSocketEvent(event)));
      });
      ws.addEventListener("close", (event) => {
        if (!opened) {
          settle(new Error(`websocket connection closed before open: ${event.code} ${event.reason}`.trim()));
          return;
        }
        if (event.code !== 1000 && event.code !== 1005) {
          settle(new Error(`websocket connection closed: ${event.code} ${event.reason}`.trim()));
          return;
        }
        settle();
      });
    });
  }

  async put(path: string, body?: unknown): Promise<unknown> {
    return this.requestJSON("PUT", this.buildURL(path), body);
  }

  async delete(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.requestJSON("DELETE", this.buildURL(path, query));
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

  private buildWebSocketURL(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(this.buildURL(path, query));
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    }
    return url.toString();
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
    if (isDebugEnabled()) {
      console.error(`${method} ${url}`);
    }
    return { headers, payload };
  }
}

function isDebugEnabled(): boolean {
  return process.env.SEAAGENT_DEBUG === "1" || process.env.AGENTCTL_DEBUG === "1";
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

function webSocketMessageToString(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return String(data);
}

function errorMessageFromWebSocketEvent(event: Event): string {
  if ("message" in event && typeof event.message === "string" && event.message) {
    return event.message;
  }
  if ("error" in event && event.error instanceof Error) {
    return event.error.message;
  }
  return "websocket error";
}
