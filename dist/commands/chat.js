import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { readPayload } from "../lib/files.js";
import { addHelpText } from "../lib/help.js";
import { printJSON } from "../lib/output.js";
export function chatCommand() {
    const cmd = addHelpText(new Command("chat").description("Run and manage chats"), `
Chat can run against a registered agent UUID or an inline runtime agent_config file.
Streaming is enabled by default. Use --no-stream when another agent needs raw JSON.

Examples:
  seaagent chat run <agent-id> "hello"
  seaagent chat run --no-stream <agent-id> "return JSON"
  seaagent chat run --ws <agent-id> "stream over WebSocket"
  seaagent chat run --agent-config-file examples/runtime-agent-config.json "Fetch https://example.com"
  seaagent chat run --messages-file examples/chat-multimodal.json <agent-id>
  seaagent chat events <chat-id> --after-seq 12
  seaagent chat stream <chat-id> --after-seq 12
`);
    cmd
        .command("run")
        .description("Create a chat completion and optionally stream events")
        .argument("[agent-id]", "registered agent UUID; optional when --agent-config-file is used")
        .argument("[message...]", "user message text")
        .option("-f, --agent-config-file <path>", "JSON/YAML runtime agent_config file")
        .option("--messages-file <path>", "JSON/YAML messages array or full chat payload file")
        .option("--no-stream", "disable streaming")
        .option("--ws", "use WebSocket streaming")
        .option("--stream-retries <number>", "stream reconnect attempts after interruption; -1 means unlimited", "-1")
        .option("--retry-delay-ms <number>", "delay before reconnecting an interrupted stream", "1000")
        .addHelpText("after", `

Examples:
  seaagent chat run <agent-id> "Search recent AI news"
  seaagent chat run --no-stream <agent-id> "Use one sentence"
  seaagent chat run --ws <agent-id> "Stream with WebSocket"
  seaagent chat run --stream-retries 5 <agent-id> "Reconnect at most five times"
  seaagent chat run --agent-config-file examples/runtime-agent-config.json "Fetch https://example.com"
  seaagent chat run --messages-file examples/chat-multimodal.json <agent-id>

Notes:
  - Either [agent-id] or --agent-config-file is required.
  - --messages-file accepts a messages array or an object with a messages field.
  - With streaming enabled, stdout contains assistant text; stderr contains run_id, progress, tool status, and terminal usage when available.
  - With --no-stream, stdout is gateway JSON enriched with response.message.content when stored events are available.`)
        .action(async (agentID, messageParts, options) => {
        const client = await AgentGatewayClient.fromConfig();
        if (!agentID && !options.agentConfigFile) {
            throw new Error("agent-id or --agent-config-file is required");
        }
        if (!options.stream && options.ws) {
            throw new Error("--ws cannot be used with --no-stream");
        }
        const messages = await chatMessagesFromCommand(messageParts, options.messagesFile);
        const payload = {
            ...(agentID ? { agent_id: agentID } : {}),
            ...(options.agentConfigFile ? { agent_config: await readPayload(options.agentConfigFile) } : {}),
            messages,
            stream: options.stream,
        };
        if (options.stream) {
            const renderer = createChatStreamRenderer();
            try {
                await runChatStreamWithResume(client, payload, Boolean(options.ws), renderer, retryOptionsFromCommand(options));
            }
            finally {
                renderer.end();
            }
            return;
        }
        printJSON(await completeNonStreamingChatResponse(client, await client.post("/v1/chat/completions", payload)));
    });
    cmd.command("get").description("Get chat run metadata and current state").argument("<chat-id>", "chat/run UUID").action(async (chatID) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.get(`/v1/chats/${encodeURIComponent(chatID)}`));
    });
    cmd.command("events").description("List stored chat events as JSON").argument("<chat-id>", "chat/run UUID").option("--after-seq <number>", "return events after this sequence", "0").option("--limit <number>", "maximum events to return", "1000").addHelpText("after", `

Example:
  seaagent chat events <chat-id> --after-seq 12 --limit 1000`).action(async (chatID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        const afterSeq = parseNonNegativeInteger(options.afterSeq, "after-seq");
        const limit = parsePositiveInteger(options.limit, "limit");
        const response = await getChatEvents(client, chatID, afterSeq, limit);
        warnIfChatEventsTruncated(response, limit, afterSeq);
        printJSON(response);
    });
    cmd.command("stream")
        .description("Resume streaming an existing chat")
        .argument("<chat-id>", "chat/run UUID")
        .option("--after-seq <number>", "resume after this event sequence", "0")
        .option("--ws", "use WebSocket streaming")
        .option("--stream-retries <number>", "stream reconnect attempts after interruption; -1 means unlimited", "-1")
        .option("--retry-delay-ms <number>", "delay before reconnecting an interrupted stream", "1000")
        .addHelpText("after", `

Examples:
  seaagent chat stream <chat-id>
  seaagent chat stream <chat-id> --after-seq 12
  seaagent chat stream --ws <chat-id> --after-seq 12`)
        .action(async (chatID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        const renderer = createChatStreamRenderer(chatID, parseNonNegativeInteger(options.afterSeq, "after-seq"));
        try {
            await resumeExistingChatStream(client, chatID, Boolean(options.ws), renderer, retryOptionsFromCommand(options));
        }
        finally {
            renderer.end();
        }
    });
    cmd.command("cancel").description("Cancel a running chat").argument("<chat-id>", "chat/run UUID").action(async (chatID) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.post(`/v1/chats/${encodeURIComponent(chatID)}/cancel`));
    });
    return cmd;
}
const CHAT_EVENTS_PAGE_LIMIT = 1000;
async function chatMessagesFromCommand(messageParts, messagesFile) {
    if (!messagesFile) {
        return [{ role: "user", content: (messageParts ?? []).join(" ") }];
    }
    const payload = await readPayload(messagesFile);
    const messages = Array.isArray(payload) ? payload : objectMessages(payload);
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error("--messages-file must contain a non-empty messages array");
    }
    return messages;
}
function objectMessages(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value.messages;
}
async function completeNonStreamingChatResponse(client, response) {
    const runID = findRunID(response);
    if (!runID) {
        return response;
    }
    let events;
    try {
        events = await getAllChatEvents(client, runID);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[warning] could not load chat events for ${runID}; --no-stream response was not enriched: ${message}\n`);
        return response;
    }
    const content = collectAssistantText(events);
    const failure = collectFailure(events);
    if (!content && !failure) {
        return response;
    }
    const target = responseObjectWithRunID(response, runID);
    if (!target) {
        return response;
    }
    const responseObject = ensureObjectProperty(target, "response");
    if (content) {
        const message = ensureObjectProperty(responseObject, "message");
        message.content = content;
    }
    if (failure) {
        responseObject.error = compactObject({
            code: failure.code,
            message: failure.message,
            type: failure.type,
        });
        target.error_code = failure.code;
        target.error_message = failure.message;
    }
    return response;
}
async function getAllChatEvents(client, chatID) {
    const events = [];
    let afterSeq = 0;
    while (true) {
        const response = await getChatEvents(client, chatID, afterSeq, CHAT_EVENTS_PAGE_LIMIT);
        events.push(...storedEventsFromResponse(response));
        const items = itemsFromChatEventsResponse(response);
        if (items.length < CHAT_EVENTS_PAGE_LIMIT) {
            return events;
        }
        const nextAfterSeq = lastReturnedEventSeq(response, afterSeq);
        if (nextAfterSeq <= afterSeq) {
            process.stderr.write(`[warning] stopped paging chat events for ${chatID}; could not determine the next --after-seq value\n`);
            return events;
        }
        afterSeq = nextAfterSeq;
    }
}
async function getChatEvents(client, chatID, afterSeq, limit) {
    return client.get(`/v1/chats/${encodeURIComponent(chatID)}/events`, {
        after_seq: afterSeq,
        limit,
    });
}
function warnIfChatEventsTruncated(response, limit, afterSeq) {
    const items = itemsFromChatEventsResponse(response);
    if (items.length !== limit) {
        return;
    }
    const nextAfterSeq = lastReturnedEventSeq(response, afterSeq);
    process.stderr.write(`[warning] returned exactly --limit (${limit}) events; use --after-seq ${nextAfterSeq} for more\n`);
}
function storedEventsFromResponse(response) {
    const events = [];
    for (const item of itemsFromChatEventsResponse(response)) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const record = item;
        const seq = parseOptionalSeq(record.seq);
        if (typeof record.raw_sse === "string") {
            for (const event of parseSSE(record.raw_sse)) {
                events.push({ ...event, id: event.id ?? seq });
            }
            continue;
        }
        if (typeof record.event === "string") {
            events.push({ event: record.event, data: record.data, id: seq });
        }
    }
    return events;
}
function collectAssistantText(events) {
    let text = "";
    let wroteText = false;
    for (const event of events) {
        const chunk = textFromStreamEvent(event, wroteText);
        if (!chunk) {
            continue;
        }
        text += chunk;
        wroteText = true;
    }
    return text;
}
function collectFailure(events) {
    let failure;
    for (const event of events) {
        if (event.event === "error" || event.event === "chat.failed" || event.event === "response.failed" || event.event === "chat.cancelled" || event.event === "response.cancelled") {
            failure = failureFromStreamEvent(event);
        }
    }
    return failure;
}
function itemsFromChatEventsResponse(response) {
    const data = objectField(response, "data");
    const items = Array.isArray(objectField(response, "items"))
        ? objectField(response, "items")
        : objectField(data, "items");
    return Array.isArray(items) ? items : [];
}
function lastReturnedEventSeq(response, fallbackAfterSeq) {
    const items = itemsFromChatEventsResponse(response);
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (!item || typeof item !== "object") {
            continue;
        }
        const seq = parseOptionalSeq(item.seq);
        if (seq !== undefined) {
            return seq;
        }
    }
    return fallbackAfterSeq + items.length;
}
function findRunID(value) {
    if (!value || typeof value !== "object") {
        return "";
    }
    const direct = stringField(value, "run_id");
    if (direct) {
        return direct;
    }
    return findRunID(objectField(value, "data")) || findRunID(objectField(value, "response"));
}
function responseObjectWithRunID(value, runID) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const object = value;
    if (stringField(object, "run_id") === runID) {
        return object;
    }
    return responseObjectWithRunID(object.data, runID) || responseObjectWithRunID(object.response, runID);
}
function ensureObjectProperty(object, field) {
    const value = object[field];
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    const next = {};
    object[field] = next;
    return next;
}
function compactObject(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== ""));
}
async function runChatStreamWithResume(client, payload, useWebSocket, renderer, options) {
    let initialRequest = true;
    let reconnects = 0;
    while (true) {
        let streamError;
        try {
            if (initialRequest) {
                if (useWebSocket) {
                    await client.websocket("/v1/chat/completions/ws", undefined, payload, renderer.writeWebSocketMessage);
                }
                else {
                    await client.postStream("/v1/chat/completions", payload, renderer.writeSSEChunk);
                }
            }
            else {
                const snapshot = renderer.snapshot();
                if (!snapshot.runID) {
                    throw new Error("stream interrupted before run_id was received");
                }
                await connectExistingChatStream(client, snapshot.runID, snapshot.lastSeq, useWebSocket, renderer);
            }
        }
        catch (err) {
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
async function resumeExistingChatStream(client, chatID, useWebSocket, renderer, options) {
    let reconnects = 0;
    while (true) {
        let streamError;
        const snapshot = renderer.snapshot();
        try {
            await connectExistingChatStream(client, chatID, snapshot.lastSeq, useWebSocket, renderer);
        }
        catch (err) {
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
async function connectExistingChatStream(client, runID, afterSeq, useWebSocket, renderer) {
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
function createChatStreamRenderer(initialRunID, initialSeq = 0) {
    let buffer = "";
    let wroteText = false;
    let runID = initialRunID;
    let reportedRunID = false;
    let lastSeq = initialSeq;
    let terminal = false;
    let failure;
    let usage;
    const handleEvent = (event) => {
        runID = stringField(event.data, "run_id") || runID;
        if (runID && !reportedRunID) {
            process.stderr.write(`\n[run_id ${runID}]\n`);
            reportedRunID = true;
        }
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
            usage = usageFromStreamEvent(event) || usage;
        }
        if (event.event === "chat.failed" || event.event === "response.failed" || event.event === "chat.cancelled" || event.event === "response.cancelled") {
            failure = errorFromStreamEvent(event);
        }
        reportChatStreamProgress(event);
        if (renderChatStreamEvent(event, wroteText)) {
            wroteText = true;
        }
    };
    if (runID) {
        process.stderr.write(`\n[run_id ${runID}]\n`);
        reportedRunID = true;
    }
    return {
        writeSSEChunk(chunk) {
            buffer += chunk;
            const parts = buffer.split(/\r?\n\r?\n/);
            buffer = parts.pop() ?? "";
            for (const part of parts) {
                for (const event of parseSSE(part)) {
                    handleEvent(event);
                }
            }
        },
        writeWebSocketMessage(message) {
            handleEvent(parseWebSocketEvent(message));
        },
        snapshot() {
            return { runID, lastSeq, terminal };
        },
        throwIfFailed() {
            if (failure) {
                throw failure;
            }
        },
        end() {
            if (buffer.trim()) {
                for (const event of parseSSE(buffer)) {
                    handleEvent(event);
                }
                buffer = "";
            }
            if (wroteText) {
                process.stdout.write("\n");
            }
            if (usage) {
                process.stderr.write(`${formatUsageForDisplay(usage)}\n`);
            }
        },
    };
}
function renderChatStreamEvent(event, alreadyRenderedText = false) {
    const chunk = textFromStreamEvent(event, alreadyRenderedText);
    if (!chunk) {
        return false;
    }
    process.stdout.write(chunk);
    return true;
}
function parseSSE(text) {
    const events = [];
    for (const block of text.split(/\r?\n\r?\n+/)) {
        const lines = block.split(/\r?\n/);
        let event = "message";
        let id;
        const dataLines = [];
        for (const line of lines) {
            if (line.startsWith("event:")) {
                event = line.slice("event:".length).trim();
            }
            else if (line.startsWith("data:")) {
                dataLines.push(line.slice("data:".length).trimStart());
            }
            else if (line.startsWith("id:")) {
                id = parseOptionalSeq(line.slice("id:".length).trim());
            }
        }
        if (dataLines.length === 0) {
            continue;
        }
        const dataText = dataLines.join("\n");
        let data = dataText;
        try {
            data = JSON.parse(dataText);
        }
        catch {
            // Keep non-JSON data as raw text.
        }
        events.push({ event, data, id });
    }
    return events;
}
function parseWebSocketEvent(message) {
    let parsed;
    try {
        parsed = JSON.parse(message);
    }
    catch {
        return { event: "message", data: message };
    }
    if (!parsed || typeof parsed !== "object") {
        return { event: "message", data: parsed };
    }
    const object = parsed;
    const event = typeof object.event === "string" && object.event ? object.event : "message";
    const data = object.data === undefined && event === "error" ? object : object.data;
    return { event, data, id: parseOptionalSeq(object.id) };
}
function textFromStreamEvent(event, alreadyRenderedText = false) {
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
function stringField(data, field) {
    if (!data || typeof data !== "object") {
        return "";
    }
    const value = data[field];
    return typeof value === "string" ? value : "";
}
function nestedStringField(data, objectField, field) {
    if (!data || typeof data !== "object") {
        return "";
    }
    return stringField(data[objectField], field);
}
function reportChatStreamProgress(event) {
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
        }
        else if (output && (name === "write_todos" || name === "generate" || name === "compose_video")) {
            process.stderr.write(`\n[tool:done ${name}] ${previewText(output)}\n`);
        }
    }
}
function objectField(data, field) {
    if (!data || typeof data !== "object") {
        return undefined;
    }
    return data[field];
}
function numberField(data, field) {
    if (!data || typeof data !== "object") {
        return undefined;
    }
    const value = data[field];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function isLikelyToolError(output) {
    const parsed = parseJSONLike(output);
    if (parsed && typeof parsed === "object") {
        const object = parsed;
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
function previewText(text) {
    return text.replace(/\s+/g, " ").trim().slice(0, 240);
}
function parseJSONLike(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return undefined;
    }
}
function usageFromStreamEvent(event) {
    for (const path of [
        "usage",
        "response.usage",
        "response.response.usage",
        "data.usage",
        "data.response.usage",
        "data.response.response.usage",
    ]) {
        const usage = normalizeUsage(nestedValue(event.data, path));
        if (usage) {
            return usage;
        }
    }
    return undefined;
}
function normalizeUsage(value) {
    if (!value) {
        return undefined;
    }
    if (typeof value === "string") {
        const parsed = parseJSONLike(value);
        return normalizeUsage(parsed);
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    if (Object.keys(value).length === 0) {
        return undefined;
    }
    return value;
}
function nestedValue(data, path) {
    let current = data;
    for (const field of path.split(".")) {
        if (!current || typeof current !== "object") {
            return undefined;
        }
        current = current[field];
    }
    return current;
}
function formatUsageForDisplay(usage) {
    const preferredFields = [
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
        "cost",
        "total_cost",
    ];
    const parts = preferredFields
        .filter((field) => usage[field] !== undefined)
        .map((field) => `${field}=${formatUsageValue(usage[field])}`);
    if (parts.length > 0) {
        return `[usage ${parts.join(" ")}]`;
    }
    return `[usage ${JSON.stringify(usage)}]`;
}
function formatUsageValue(value) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return JSON.stringify(value);
}
function isTerminalStreamEvent(event) {
    return event === "chat.response"
        || event === "response.completed"
        || event === "chat.failed"
        || event === "response.failed"
        || event === "chat.cancelled"
        || event === "response.cancelled";
}
function errorFromStreamEvent(event) {
    const failure = failureFromStreamEvent(event);
    return new Error(`${failure.code ? `${failure.code}: ` : ""}${failure.message}`);
}
function failureFromStreamEvent(event) {
    const response = objectField(event.data, "response");
    const error = objectField(response, "error") || objectField(event.data, "error");
    const code = stringField(event.data, "error_code") || stringField(event.data, "code") || stringField(error, "code");
    const message = stringField(event.data, "error_message")
        || stringField(event.data, "message")
        || stringField(error, "message")
        || stringField(event.data, "error")
        || JSON.stringify(event.data);
    const type = stringField(error, "type") || stringField(event.data, "type");
    return { code: code || undefined, message, type: type || undefined };
}
function retryOptionsFromCommand(options) {
    const maxRetries = parseInteger(options.streamRetries, "stream-retries");
    if (maxRetries < -1) {
        throw new Error("--stream-retries must be -1 or greater");
    }
    const retryDelayMs = parseNonNegativeInteger(options.retryDelayMs, "retry-delay-ms");
    return { maxRetries, retryDelayMs };
}
function parseNonNegativeInteger(value, name) {
    const parsed = parseInteger(value, name);
    if (parsed < 0) {
        throw new Error(`--${name} must be 0 or greater`);
    }
    return parsed;
}
function parsePositiveInteger(value, name) {
    const parsed = parseInteger(value, name);
    if (parsed <= 0) {
        throw new Error(`--${name} must be greater than 0`);
    }
    return parsed;
}
function parseInteger(value, name) {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || String(value).trim() === "" || !/^-?\d+$/.test(String(value).trim())) {
        throw new Error(`--${name} must be an integer`);
    }
    return parsed;
}
function parseOptionalSeq(value) {
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
function canRetry(reconnects, maxRetries) {
    return maxRetries < 0 || reconnects < maxRetries;
}
function interruptedStreamError(runID, afterSeq, cause) {
    const suffix = cause ? `: ${cause.message}` : "";
    return new Error(`stream interrupted for ${runID} after seq ${afterSeq}; resume with: seaagent chat stream ${runID} --after-seq ${afterSeq}${suffix}`);
}
function isRetryableStreamError(error) {
    const match = /^(\d{3}):/.exec(error.message);
    if (!match) {
        return true;
    }
    const status = Number.parseInt(match[1], 10);
    return status === 408 || status === 429 || status >= 500;
}
function logStreamReconnect(runID, afterSeq, reconnect, maxRetries, cause) {
    const total = maxRetries < 0 ? "unlimited" : String(maxRetries);
    const reason = cause ? ` (${cause.message})` : "";
    process.stderr.write(`\n[stream interrupted; reconnecting ${runID} after seq ${afterSeq}, attempt ${reconnect}/${total}${reason}]\n`);
}
async function sleep(ms) {
    if (ms <= 0) {
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
}
