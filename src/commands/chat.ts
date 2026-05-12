import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { readPayload } from "../lib/files.js";
import { printJSON } from "../lib/output.js";

export function chatCommand(): Command {
  const cmd = new Command("chat").description("Run and manage chats");

  cmd
    .command("run")
    .argument("[agent-id]")
    .argument("[message...]")
    .option("-f, --agent-config-file <path>", "JSON/YAML runtime agent_config file")
    .option("--no-stream", "disable streaming")
    .option("--ws", "use WebSocket streaming")
    .option("--stream-retries <number>", "stream reconnect attempts after interruption; -1 means unlimited", "-1")
    .option("--retry-delay-ms <number>", "delay before reconnecting an interrupted stream", "1000")
    .action(async (agentID: string | undefined, messageParts: string[] | undefined, options: ChatRunOptions) => {
      const client = await AgentGatewayClient.fromConfig();
      if (!agentID && !options.agentConfigFile) {
        throw new Error("agent-id or --agent-config-file is required");
      }
      if (!options.stream && options.ws) {
        throw new Error("--ws cannot be used with --no-stream");
      }
      const payload = {
        ...(agentID ? { agent_id: agentID } : {}),
        ...(options.agentConfigFile ? { agent_config: await readPayload(options.agentConfigFile) } : {}),
        messages: [{ role: "user", content: (messageParts ?? []).join(" ") }],
        stream: options.stream,
      };
      if (options.stream) {
        const renderer = createChatStreamRenderer();
        try {
          await runChatStreamWithResume(client, payload, Boolean(options.ws), renderer, retryOptionsFromCommand(options));
        } finally {
          renderer.end();
        }
        return;
      }
      printJSON(await client.post("/v1/chat/completions", payload));
    });

  cmd.command("get").argument("<chat-id>").action(async (chatID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.get(`/v1/chats/${encodeURIComponent(chatID)}`));
  });

  cmd.command("events").argument("<chat-id>").option("--after-seq <number>", "after sequence", "0").option("--limit <number>", "limit", "100").action(async (chatID: string, options) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.get(`/v1/chats/${encodeURIComponent(chatID)}/events`, {
      after_seq: options.afterSeq,
      limit: options.limit,
    }));
  });

  cmd.command("stream")
    .argument("<chat-id>")
    .option("--after-seq <number>", "after sequence", "0")
    .option("--ws", "use WebSocket streaming")
    .option("--stream-retries <number>", "stream reconnect attempts after interruption; -1 means unlimited", "-1")
    .option("--retry-delay-ms <number>", "delay before reconnecting an interrupted stream", "1000")
    .action(async (chatID: string, options: ChatStreamOptions) => {
      const client = await AgentGatewayClient.fromConfig();
      const renderer = createChatStreamRenderer(chatID, parseNonNegativeInteger(options.afterSeq, "after-seq"));
      try {
        await resumeExistingChatStream(client, chatID, Boolean(options.ws), renderer, retryOptionsFromCommand(options));
      } finally {
        renderer.end();
      }
    });

  cmd.command("cancel").argument("<chat-id>").action(async (chatID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.post(`/v1/chats/${encodeURIComponent(chatID)}/cancel`));
  });

  return cmd;
}

type ChatRunOptions = {
  agentConfigFile?: string;
  stream: boolean;
  ws?: boolean;
  streamRetries: string;
  retryDelayMs: string;
};

type ChatStreamOptions = {
  afterSeq: string;
  ws?: boolean;
  streamRetries: string;
  retryDelayMs: string;
};

type StreamRetryOptions = {
  maxRetries: number;
  retryDelayMs: number;
};

type ChatStreamSnapshot = {
  runID?: string;
  lastSeq: number;
  terminal: boolean;
};

type ChatStreamRenderer = {
  writeSSEChunk: (chunk: string) => void;
  writeWebSocketMessage: (message: string) => void;
  snapshot: () => ChatStreamSnapshot;
  throwIfFailed: () => void;
  end: () => void;
};

async function runChatStreamWithResume(client: AgentGatewayClient, payload: unknown, useWebSocket: boolean, renderer: ChatStreamRenderer, options: StreamRetryOptions): Promise<void> {
  let initialRequest = true;
  let reconnects = 0;

  while (true) {
    let streamError: Error | undefined;
    try {
      if (initialRequest) {
        if (useWebSocket) {
          await client.websocket("/v1/chat/completions/ws", undefined, payload, renderer.writeWebSocketMessage);
        } else {
          await client.postStream("/v1/chat/completions", payload, renderer.writeSSEChunk);
        }
      } else {
        const snapshot = renderer.snapshot();
        if (!snapshot.runID) {
          throw new Error("stream interrupted before run_id was received");
        }
        await connectExistingChatStream(client, snapshot.runID, snapshot.lastSeq, useWebSocket, renderer);
      }
    } catch (err) {
      streamError = err instanceof Error ? err : new Error(String(err));
    }

    initialRequest = false;
    const snapshot = renderer.snapshot();
    if (snapshot.terminal) {
      renderer.throwIfFailed();
      return;
    }
    if (!snapshot.runID) {
      if (streamError) {
        throw streamError;
      }
      return;
    }
    if (streamError && !isRetryableStreamError(streamError)) {
      throw streamError;
    }
    if (!canRetry(reconnects, options.maxRetries)) {
      throw interruptedStreamError(snapshot.runID, snapshot.lastSeq, streamError);
    }
    reconnects += 1;
    logStreamReconnect(snapshot.runID, snapshot.lastSeq, reconnects, options.maxRetries, streamError);
    await sleep(options.retryDelayMs);
  }
}

async function resumeExistingChatStream(client: AgentGatewayClient, chatID: string, useWebSocket: boolean, renderer: ChatStreamRenderer, options: StreamRetryOptions): Promise<void> {
  let reconnects = 0;

  while (true) {
    let streamError: Error | undefined;
    const snapshot = renderer.snapshot();
    try {
      await connectExistingChatStream(client, chatID, snapshot.lastSeq, useWebSocket, renderer);
    } catch (err) {
      streamError = err instanceof Error ? err : new Error(String(err));
    }

    const latest = renderer.snapshot();
    if (latest.terminal) {
      renderer.throwIfFailed();
      return;
    }
    if (streamError && !isRetryableStreamError(streamError)) {
      throw streamError;
    }
    if (!canRetry(reconnects, options.maxRetries)) {
      throw interruptedStreamError(chatID, latest.lastSeq, streamError);
    }
    reconnects += 1;
    logStreamReconnect(chatID, latest.lastSeq, reconnects, options.maxRetries, streamError);
    await sleep(options.retryDelayMs);
  }
}

async function connectExistingChatStream(client: AgentGatewayClient, runID: string, afterSeq: number, useWebSocket: boolean, renderer: ChatStreamRenderer): Promise<void> {
  if (useWebSocket) {
    await client.websocket(`/v1/chats/${encodeURIComponent(runID)}/ws`, {
      after_seq: afterSeq,
    }, undefined, renderer.writeWebSocketMessage);
    return;
  }
  await client.getStream(`/v1/chats/${encodeURIComponent(runID)}/stream`, {
    after_seq: afterSeq,
  }, renderer.writeSSEChunk);
}

function createChatStreamRenderer(initialRunID?: string, initialSeq = 0): ChatStreamRenderer {
  let buffer = "";
  let wroteText = false;
  let runID = initialRunID;
  let lastSeq = initialSeq;
  let terminal = false;
  let failure: Error | undefined;

  const handleEvent = (event: ChatStreamEvent): void => {
    runID = stringField(event.data, "run_id") || runID;
    if (event.id !== undefined) {
      lastSeq = Math.max(lastSeq, event.id);
    }
    if (event.event === "error") {
      terminal = true;
      failure = errorFromStreamEvent(event);
      return;
    }
    if (isTerminalStreamEvent(event.event)) {
      terminal = true;
    }
    if (event.event === "chat.failed" || event.event === "response.failed" || event.event === "chat.cancelled" || event.event === "response.cancelled") {
      failure = errorFromStreamEvent(event);
    }
    reportChatStreamProgress(event);
    if (renderChatStreamEvent(event, wroteText)) {
      wroteText = true;
    }
  };

  return {
    writeSSEChunk(chunk: string): void {
      buffer += chunk;
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const event of parseSSE(part)) {
          handleEvent(event);
        }
      }
    },
    writeWebSocketMessage(message: string): void {
      handleEvent(parseWebSocketEvent(message));
    },
    snapshot(): ChatStreamSnapshot {
      return { runID, lastSeq, terminal };
    },
    throwIfFailed(): void {
      if (failure) {
        throw failure;
      }
    },
    end(): void {
      if (buffer.trim()) {
        for (const event of parseSSE(buffer)) {
          handleEvent(event);
        }
        buffer = "";
      }
      if (wroteText) {
        process.stdout.write("\n");
      }
    },
  };
}

function renderChatStreamEvent(event: ChatStreamEvent, alreadyRenderedText = false): boolean {
  const chunk = textFromStreamEvent(event, alreadyRenderedText);
  if (!chunk) {
    return false;
  }
  process.stdout.write(chunk);
  return true;
}

type ChatStreamEvent = {
  event: string;
  data: unknown;
  id?: number;
};

function parseSSE(text: string): ChatStreamEvent[] {
  const events: ChatStreamEvent[] = [];
  for (const block of text.split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/);
    let event = "message";
    let id: number | undefined;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      } else if (line.startsWith("id:")) {
        id = parseOptionalSeq(line.slice("id:".length).trim());
      }
    }
    if (dataLines.length === 0) {
      continue;
    }
    const dataText = dataLines.join("\n");
    let data: unknown = dataText;
    try {
      data = JSON.parse(dataText);
    } catch {
      // Keep non-JSON data as raw text.
    }
    events.push({ event, data, id });
  }
  return events;
}

function parseWebSocketEvent(message: string): ChatStreamEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return { event: "message", data: message };
  }
  if (!parsed || typeof parsed !== "object") {
    return { event: "message", data: parsed };
  }
  const object = parsed as Record<string, unknown>;
  const event = typeof object.event === "string" && object.event ? object.event : "message";
  const data = object.data === undefined && event === "error" ? object : object.data;
  return { event, data, id: parseOptionalSeq(object.id) };
}

function textFromStreamEvent(event: ChatStreamEvent, alreadyRenderedText = false): string {
  if (event.event === "response.text.delta" || event.event === "response.output_text.delta") {
    return stringField(event.data, "delta");
  }
  if (event.event === "chat.response" || event.event === "message.delta") {
    return stringField(event.data, "content") || stringField(event.data, "text") || stringField(event.data, "delta");
  }
  if (!alreadyRenderedText && event.event === "response.text.done") {
    return stringField(event.data, "text");
  }
  if (!alreadyRenderedText && event.event === "response.content_part.done") {
    return nestedStringField(event.data, "part", "text");
  }
  return "";
}

function stringField(data: unknown, field: string): string {
  if (!data || typeof data !== "object") {
    return "";
  }
  const value = (data as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function nestedStringField(data: unknown, objectField: string, field: string): string {
  if (!data || typeof data !== "object") {
    return "";
  }
  return stringField((data as Record<string, unknown>)[objectField], field);
}

function reportChatStreamProgress(event: ChatStreamEvent): void {
  if (event.event === "chat.sandbox.creating") {
    const runID = stringField(event.data, "sandbox_run_id") || stringField(event.data, "game_run_id");
    const status = stringField(event.data, "status");
    process.stderr.write(`\n[sandbox:creating${runID ? ` ${runID}` : ""}${status ? ` ${status}` : ""}]\n`);
    return;
  }

  if (event.event === "chat.sandbox.ready") {
    const runID = stringField(event.data, "sandbox_run_id") || stringField(event.data, "game_run_id");
    const previewURL = stringField(event.data, "preview_url");
    const workspaceRoot = stringField(event.data, "workspace_root");
    const details = [runID, workspaceRoot, previewURL].filter(Boolean).join(" ");
    process.stderr.write(`\n[sandbox:ready${details ? ` ${details}` : ""}]\n`);
    return;
  }

  if (event.event === "chat.sandbox.failed") {
    const message = stringField(event.data, "error_message") || stringField(event.data, "message") || "sandbox failed";
    process.stderr.write(`\n[sandbox:failed] ${message}\n`);
    return;
  }

  if (event.event === "chat.progress") {
    const progress = numberField(event.data, "progress");
    const reason = stringField(event.data, "reason");
    const details = progress === undefined ? reason : `${progress}%${reason && reason !== String(progress) ? ` ${reason}` : ""}`;
    process.stderr.write(`\n[progress${details ? ` ${details}` : ""}]\n`);
    return;
  }

  if (event.event === "response.output_item.added") {
    const item = objectField(event.data, "item");
    if (stringField(item, "type") === "function_call") {
      const name = stringField(item, "name") || "tool";
      process.stderr.write(`\n[tool:start ${name}]\n`);
    }
    return;
  }

  if (event.event === "response.output_item.done") {
    const item = objectField(event.data, "item");
    if (stringField(item, "type") !== "function_call") {
      return;
    }
    const name = stringField(item, "name") || "tool";
    const output = stringField(item, "output");
    if (isLikelyToolError(output)) {
      process.stderr.write(`\n[tool:error ${name}] ${previewText(output)}\n`);
    } else if (output && (name === "write_todos" || name === "generate" || name === "compose_video")) {
      process.stderr.write(`\n[tool:done ${name}] ${previewText(output)}\n`);
    }
  }
}

function objectField(data: unknown, field: string): unknown {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  return (data as Record<string, unknown>)[field];
}

function numberField(data: unknown, field: string): number | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const value = (data as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isLikelyToolError(output: string): boolean {
  const parsed = parseJSONLike(output);
  if (parsed && typeof parsed === "object") {
    const object = parsed as Record<string, unknown>;
    if (typeof object.error === "string" && object.error.trim() !== "") {
      return true;
    }
    if (object.error !== undefined && object.error !== null && object.error !== false) {
      return true;
    }
    if (typeof object.status === "string" && /^(failed|error|cancelled)$/i.test(object.status)) {
      return true;
    }
    return false;
  }
  return /\b(error|failed|required|not found)\b/i.test(output);
}

function previewText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

function parseJSONLike(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function isTerminalStreamEvent(event: string): boolean {
  return event === "chat.response"
    || event === "response.completed"
    || event === "chat.failed"
    || event === "response.failed"
    || event === "chat.cancelled"
    || event === "response.cancelled";
}

function errorFromStreamEvent(event: ChatStreamEvent): Error {
  const code = stringField(event.data, "error_code") || stringField(event.data, "code");
  const message = stringField(event.data, "error_message") || stringField(event.data, "message") || stringField(event.data, "error") || JSON.stringify(event.data);
  return new Error(`${code ? `${code}: ` : ""}${message}`);
}

function retryOptionsFromCommand(options: { streamRetries: string; retryDelayMs: string }): StreamRetryOptions {
  const maxRetries = parseInteger(options.streamRetries, "stream-retries");
  if (maxRetries < -1) {
    throw new Error("--stream-retries must be -1 or greater");
  }
  const retryDelayMs = parseNonNegativeInteger(options.retryDelayMs, "retry-delay-ms");
  return { maxRetries, retryDelayMs };
}

function parseNonNegativeInteger(value: string | number, name: string): number {
  const parsed = parseInteger(value, name);
  if (parsed < 0) {
    throw new Error(`--${name} must be 0 or greater`);
  }
  return parsed;
}

function parseInteger(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || String(value).trim() === "" || !/^-?\d+$/.test(String(value).trim())) {
    throw new Error(`--${name} must be an integer`);
  }
  return parsed;
}

function parseOptionalSeq(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  return Number.parseInt(trimmed, 10);
}

function canRetry(reconnects: number, maxRetries: number): boolean {
  return maxRetries < 0 || reconnects < maxRetries;
}

function interruptedStreamError(runID: string, afterSeq: number, cause?: Error): Error {
  const suffix = cause ? `: ${cause.message}` : "";
  return new Error(`stream interrupted for ${runID} after seq ${afterSeq}; resume with: seaagent chat stream ${runID} --after-seq ${afterSeq}${suffix}`);
}

function isRetryableStreamError(error: Error): boolean {
  const match = /^(\d{3}):/.exec(error.message);
  if (!match) {
    return true;
  }
  const status = Number.parseInt(match[1], 10);
  return status === 408 || status === 429 || status >= 500;
}

function logStreamReconnect(runID: string, afterSeq: number, reconnect: number, maxRetries: number, cause?: Error): void {
  const total = maxRetries < 0 ? "unlimited" : String(maxRetries);
  const reason = cause ? ` (${cause.message})` : "";
  process.stderr.write(`\n[stream interrupted; reconnecting ${runID} after seq ${afterSeq}, attempt ${reconnect}/${total}${reason}]\n`);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}
