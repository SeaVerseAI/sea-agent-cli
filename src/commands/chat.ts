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
    .action(async (agentID: string | undefined, messageParts: string[] | undefined, options: { agentConfigFile?: string; stream: boolean }) => {
      const client = await AgentGatewayClient.fromConfig();
      if (!agentID && !options.agentConfigFile) {
        throw new Error("agent-id or --agent-config-file is required");
      }
      const payload = {
        ...(agentID ? { agent_id: agentID } : {}),
        ...(options.agentConfigFile ? { agent_config: await readPayload(options.agentConfigFile) } : {}),
        messages: [{ role: "user", content: (messageParts ?? []).join(" ") }],
        stream: options.stream,
      };
      if (options.stream) {
        const renderer = createChatStreamRenderer();
        await client.postStream("/v1/chat/completions", payload, renderer.write);
        renderer.end();
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

  cmd.command("cancel").argument("<chat-id>").action(async (chatID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.post(`/v1/chats/${encodeURIComponent(chatID)}/cancel`));
  });

  return cmd;
}

function createChatStreamRenderer(): { write: (chunk: string) => void; end: () => void } {
  let buffer = "";
  let wroteText = false;
  return {
    write(chunk: string): void {
      buffer += chunk;
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (renderChatStreamBlock(part)) {
          wroteText = true;
        }
      }
    },
    end(): void {
      if (buffer.trim() && renderChatStreamBlock(buffer)) {
        wroteText = true;
      }
      if (wroteText) {
        process.stdout.write("\n");
      }
    },
  };
}

function renderChatStreamBlock(block: string): boolean {
  let wroteText = false;
  for (const event of parseSSE(block)) {
    const chunk = textFromSSEEvent(event);
    if (chunk) {
      process.stdout.write(chunk);
      wroteText = true;
    }
  }
  return wroteText;
}

type SSEEvent = {
  event: string;
  data: unknown;
};

function parseSSE(text: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  for (const block of text.split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
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
    events.push({ event, data });
  }
  return events;
}

function textFromSSEEvent(event: SSEEvent): string {
  if (event.event === "response.text.delta" || event.event === "response.output_text.delta") {
    return stringField(event.data, "delta");
  }
  if (event.event === "chat.response" || event.event === "message.delta") {
    return stringField(event.data, "content") || stringField(event.data, "text") || stringField(event.data, "delta");
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
