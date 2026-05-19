import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";

const execFileAsync = promisify(execFile);

type RegistryMutationAction = "register" | "update";
type RegistryMutationResource = "agent" | "skill" | "tool";

export interface RegistryMutationConfirmation {
  action: RegistryMutationAction;
  endpoint: string;
  payload?: unknown;
  payloadPath?: string;
  resource: RegistryMutationResource;
  resourceID?: string;
}

export async function confirmRegistryMutation(options: RegistryMutationConfirmation): Promise<void> {
  const summary = registryMutationSummary(options);
  process.stderr.write(`${summary}\n\n`);

  if (process.platform === "darwin") {
    await confirmWithDesktopDialog(options, summary);
    return;
  }

  if (isAgentManagedRuntime()) {
    throw new Error("registry mutations from agent-managed terminals require desktop confirmation; run the command in your own terminal");
  }

  if (!process.stdin.isTTY) {
    throw new Error("operation requires explicit interactive confirmation");
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question('Type "yes" to continue: ');
    if (answer.trim() !== "yes") {
      throw new Error("operation cancelled");
    }
  } finally {
    rl.close();
  }
}

async function confirmWithDesktopDialog(options: RegistryMutationConfirmation, summary: string): Promise<void> {
  const title = `Confirm seaagent ${options.resource} ${options.action}`;
  const message = `${summary}\n\nApprove this registry mutation?`;
  try {
    await execFileAsync("osascript", [
      "-e",
      `display dialog ${appleScriptString(message)} with title ${appleScriptString(title)} buttons {"Cancel", "Approve"} default button "Cancel" cancel button "Cancel"`,
    ]);
  } catch {
    throw new Error("operation cancelled or desktop confirmation was unavailable");
  }
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function registryMutationSummary(options: RegistryMutationConfirmation): string {
  const lines = [
    `Target: ${options.endpoint}`,
    `Operation: ${options.action} ${options.resource}`,
    `Resource: ${options.resourceID ?? inferResourceID(options.payload) ?? "(not specified)"}`,
  ];
  if (options.payloadPath) {
    lines.push(`Payload: ${options.payloadPath}`);
  }
  const payloadSummary = summarizePayload(options.payload);
  if (payloadSummary) {
    lines.push(`Payload summary: ${payloadSummary}`);
  }
  return lines.join("\n");
}

function inferResourceID(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const explicitID = stringField(payload, "id");
  if (explicitID) {
    return explicitID;
  }
  const ownerOrProvider = stringField(payload, "owner_id") ?? stringField(payload, "provider");
  const name = stringField(payload, "name");
  const version = stringField(payload, "version");
  if (ownerOrProvider && name && version) {
    return `${ownerOrProvider}:${name}:${version}`;
  }
  if (name && version) {
    return `${name}:${version}`;
  }
  return name;
}

function summarizePayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const fields = ["owner_id", "provider", "name", "version", "status", "category"];
  const parts = fields.flatMap((field) => {
    const value = stringField(payload, field);
    return value ? [`${field}=${value}`] : [];
  });
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(object: Record<string, unknown>, key: string): string | undefined {
  const value = object[key];
  if (typeof value === "string" && value) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function isAgentManagedRuntime(): boolean {
  return Object.keys(process.env).some((key) => key.startsWith("CODEX_"));
}
