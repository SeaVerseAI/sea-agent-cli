import { request, WebSocket } from "undici";
import { loadConfig } from "./config-store.js";
export class AgentGatewayClient {
    apiKey;
    userId;
    endpoint;
    constructor(endpoint, apiKey, userId) {
        this.apiKey = apiKey;
        this.userId = userId;
        this.endpoint = normalizeAgentGatewayEndpoint(endpoint);
    }
    static async fromConfig() {
        const config = await loadConfig();
        if (!config.endpoint) {
            throw new Error("endpoint is not configured. Run: seaagent config set endpoint <url>");
        }
        return new AgentGatewayClient(config.endpoint, config.apiKey, config.userId);
    }
    getEndpoint() {
        return this.endpoint;
    }
    async get(path, query) {
        const url = this.buildURL(path, query);
        return this.requestJSON("GET", url);
    }
    async getText(path, query) {
        return this.requestText("GET", this.buildURL(path, query));
    }
    async getBytes(path, query) {
        return this.requestBytes("GET", this.buildURL(path, query));
    }
    async getStream(path, query, onChunk) {
        await this.requestStream("GET", this.buildURL(path, query), undefined, onChunk);
    }
    async post(path, body) {
        return this.requestJSON("POST", this.buildURL(path), body);
    }
    async postText(path, body) {
        return this.requestText("POST", this.buildURL(path), body);
    }
    async postStream(path, body, onChunk) {
        await this.requestStream("POST", this.buildURL(path), body, onChunk);
    }
    async websocket(path, query, initialMessage, onMessage) {
        const url = this.buildWebSocketURL(path, query);
        const headers = {};
        if (this.apiKey) {
            headers.authorization = `Bearer ${this.apiKey}`;
        }
        if (this.userId) {
            headers["X-User-ID"] = this.userId;
        }
        if (isDebugEnabled()) {
            console.error(`WS ${url}`);
        }
        await new Promise((resolve, reject) => {
            let settled = false;
            let opened = false;
            const ws = new WebSocket(url, { headers });
            const settle = (err) => {
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
                }
                catch (err) {
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
    async put(path, body) {
        return this.requestJSON("PUT", this.buildURL(path), body);
    }
    async delete(path, query) {
        return this.requestJSON("DELETE", this.buildURL(path, query));
    }
    buildURL(path, query) {
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
    buildWebSocketURL(path, query) {
        const url = new URL(this.buildURL(path, query));
        if (url.protocol === "http:") {
            url.protocol = "ws:";
        }
        else if (url.protocol === "https:") {
            url.protocol = "wss:";
        }
        return url.toString();
    }
    async requestJSON(method, url, body) {
        const text = await this.requestText(method, url, body, "application/json");
        const parsed = parseJSONResponse(text, url);
        return parsed;
    }
    async requestText(method, url, body, accept = "*/*") {
        const { headers, payload } = this.buildRequest(method, url, body, accept);
        const response = await request(url, {
            method,
            headers,
            body: payload,
        }).catch((err) => {
            throw requestFailureError(method, url, err);
        });
        const text = await response.body.text();
        if (response.statusCode >= 400) {
            throw new Error(`${response.statusCode}: ${errorMessageFromResponse(text)}`);
        }
        return text;
    }
    async requestBytes(method, url, body, accept = "*/*") {
        const { headers, payload } = this.buildRequest(method, url, body, accept);
        const response = await request(url, {
            method,
            headers,
            body: payload,
        }).catch((err) => {
            throw requestFailureError(method, url, err);
        });
        const arrayBuffer = await response.body.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (response.statusCode >= 400) {
            throw new Error(`${response.statusCode}: ${errorMessageFromResponse(buffer.toString("utf8"))}`);
        }
        return buffer;
    }
    async requestStream(method, url, body, onChunk) {
        const { headers, payload } = this.buildRequest(method, url, body, "text/event-stream");
        const response = await request(url, {
            method,
            headers,
            body: payload,
        }).catch((err) => {
            throw requestFailureError(method, url, err);
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
    buildRequest(method, url, body, accept = "*/*") {
        const headers = {
            accept,
        };
        let payload;
        if (body !== undefined) {
            headers["content-type"] = "application/json";
            payload = JSON.stringify(body);
        }
        if (this.apiKey) {
            headers.authorization = `Bearer ${this.apiKey}`;
        }
        if (this.userId) {
            headers["X-User-ID"] = this.userId;
        }
        if (isDebugEnabled()) {
            console.error(`${method} ${url}`);
        }
        return { headers, payload };
    }
}
export function normalizeAgentGatewayEndpoint(endpoint) {
    if (endpoint.trim() === "") {
        return endpoint;
    }
    let url;
    try {
        url = new URL(endpoint);
    }
    catch {
        return endpoint;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.includes("agent-v2")) {
        segments.push("agent-v2");
    }
    url.pathname = `/${segments.join("/")}`;
    return url.toString();
}
function isDebugEnabled() {
    return process.env.SEAAGENT_DEBUG === "1";
}
function requestFailureError(method, url, err) {
    const message = err instanceof Error ? err.message : String(err);
    const target = safeURLPreview(url);
    return new Error(`${message}; request failed for ${method} ${target}. Check endpoint with 'seaagent config get', run 'seaagent system health', then retry.`);
}
function safeURLPreview(url) {
    try {
        const parsed = new URL(url);
        parsed.search = "";
        return parsed.toString();
    }
    catch {
        return url;
    }
}
function errorMessageFromResponse(text) {
    let parsed;
    try {
        parsed = text ? JSON.parse(text) : {};
    }
    catch {
        parsed = {};
    }
    if (!parsed || typeof parsed !== "object") {
        return text;
    }
    const object = parsed;
    const parts = [
        stringField(object, "error"),
        stringField(object, "message"),
        stringField(object, "detail"),
        formatDetails(object.details),
        formatDetails(object.errors),
    ].filter(Boolean);
    if (parts.length === 0) {
        return text;
    }
    return Array.from(new Set(parts)).join("; ");
}
function stringField(object, field) {
    const value = object[field];
    return typeof value === "string" ? value : "";
}
function formatDetails(value) {
    if (value === undefined || value === null || value === "") {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        const parts = value.map(formatDetails).filter(Boolean);
        return parts.join("; ");
    }
    if (typeof value === "object") {
        const object = value;
        const message = stringField(object, "message") || stringField(object, "msg") || stringField(object, "error") || stringField(object, "detail");
        const field = stringField(object, "field") || stringField(object, "path") || formatPath(object.loc);
        if (message && field) {
            return `${field}: ${message}`;
        }
        if (message) {
            return message;
        }
        try {
            return JSON.stringify(value);
        }
        catch {
            return String(value);
        }
    }
    return String(value);
}
function formatPath(value) {
    if (typeof value === "string") {
        return value;
    }
    if (!Array.isArray(value)) {
        return "";
    }
    return value.map((part) => String(part)).filter(Boolean).join(".");
}
function parseJSONResponse(text, url) {
    if (!text) {
        return {};
    }
    try {
        return JSON.parse(text);
    }
    catch {
        const preview = text.replace(/\s+/g, " ").slice(0, 240);
        throw new Error(`expected JSON response from ${url}, got: ${preview}`);
    }
}
function webSocketMessageToString(data) {
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
function errorMessageFromWebSocketEvent(event) {
    if ("message" in event && typeof event.message === "string" && event.message) {
        return event.message;
    }
    if ("error" in event && event.error instanceof Error) {
        return event.error.message;
    }
    return "websocket error";
}
