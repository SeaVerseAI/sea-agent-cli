import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline/promises";
const execFileAsync = promisify(execFile);
export async function confirmRegistryMutation(options) {
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
    }
    finally {
        rl.close();
    }
}
async function confirmWithDesktopDialog(options, summary) {
    const title = `Confirm seaagent ${options.resource} ${options.action}`;
    const message = `${summary}\n\nApprove this registry mutation?`;
    try {
        await execFileAsync("osascript", [
            "-e",
            `display dialog ${appleScriptString(message)} with title ${appleScriptString(title)} buttons {"Cancel", "Approve"} default button "Cancel" cancel button "Cancel"`,
        ]);
    }
    catch {
        throw new Error("operation cancelled or desktop confirmation was unavailable");
    }
}
function appleScriptString(value) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function registryMutationSummary(options) {
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
function inferResourceID(payload) {
    if (!isRecord(payload)) {
        return undefined;
    }
    const explicitID = stringField(payload, "id");
    if (explicitID) {
        return explicitID;
    }
    const ownerOrProvider = stringField(payload, "owner_id") ?? stringField(payload, "provider");
    const name = stringField(payload, "name");
    if (ownerOrProvider && name) {
        return `${ownerOrProvider}:${name}`;
    }
    return name;
}
function summarizePayload(payload) {
    if (!isRecord(payload)) {
        return undefined;
    }
    const fields = ["owner_id", "provider", "name", "status", "category"];
    const parts = fields.flatMap((field) => {
        const value = stringField(payload, field);
        return value ? [`${field}=${value}`] : [];
    });
    return parts.length > 0 ? parts.join(", ") : undefined;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringField(object, key) {
    const value = object[key];
    if (typeof value === "string" && value) {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return undefined;
}
function isAgentManagedRuntime() {
    return Object.keys(process.env).some((key) => key.startsWith("CODEX_"));
}
