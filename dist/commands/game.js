import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { AgentGatewayClient } from "../lib/client.js";
import { addHelpText } from "../lib/help.js";
import { printJSON } from "../lib/output.js";
export function gameCommand() {
    return sandboxRunCommand("game", "/v1/game/runs", "Inspect and manage sandbox runs via legacy /v1/game/runs routes");
}
export function sandboxCommand() {
    return sandboxRunCommand("sandbox", "/v1/sandbox/runs", "Inspect and manage sandbox runs");
}
function sandboxRunCommand(name, basePath, description) {
    const cmd = addHelpText(new Command(name).description(description), `
Sandbox commands manage remote workspace runs. Use 'sandbox' for new workflows.
The 'game' command is a legacy alias that uses /v1/game/runs routes.

Examples:
  seaagent ${name} create --prompt "Create a small React game" --sandbox-template react-game --preview-port 3000
  seaagent ${name} stream <run-id>
  seaagent ${name} logs <run-id> --limit 100
  seaagent ${name} files <run-id> --path /agent-workspace
  seaagent ${name} read <run-id> --path /agent-workspace/package.json
  seaagent ${name} archive <run-id> --path /agent-workspace -o workspace.tgz
  seaagent ${name} command <run-id> -c "npm test" --cwd /agent-workspace --timeout 60
`);
    cmd
        .command("create")
        .description(`Create a sandbox run via ${basePath}`)
        .requiredOption("--prompt <text>", "task prompt for the sandbox worker")
        .option("--template-id <id>", "sandbox template id")
        .option("--sandbox-template <id>", "sandbox template alias, for example react-game")
        .option("--preview-port <number>", "preview port exposed by the generated app")
        .option("--workspace-root <path>", "workspace root", "/agent-workspace")
        .option("--user-id <id>", "user id")
        .option("--conversation-id <id>", "conversation id")
        .addHelpText("after", `

Examples:
  seaagent ${name} create --prompt "Create a small React game"
  seaagent ${name} create --prompt "Build a landing page" --sandbox-template react-game --preview-port 3000
  seaagent ${name} create --prompt "Continue this task" --conversation-id conv_123 --user-id user_123`)
        .action(async (options) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.post(basePath, {
            prompt: options.prompt,
            template_id: options.templateId,
            sandbox_template: options.sandboxTemplate,
            preview_port: optionalNumber(options.previewPort),
            workspace_root: options.workspaceRoot,
            user_id: options.userId,
            conversation_id: options.conversationId,
        }));
    });
    cmd.command("get").description("Get sandbox run metadata and status").argument("<run-id>", "sandbox run UUID").action(async (runID) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.get(runPath(basePath, runID)));
    });
    cmd.command("events")
        .description("List stored sandbox events as JSON")
        .argument("<run-id>", "sandbox run UUID")
        .option("--after-seq <number>", "return events after this sequence", "0")
        .option("--limit <number>", "maximum events to return", "100")
        .action(async (runID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.get(`${runPath(basePath, runID)}/events`, {
            after_seq: options.afterSeq,
            limit: options.limit,
        }));
    });
    cmd.command("stream")
        .description("Stream sandbox events")
        .argument("<run-id>", "sandbox run UUID")
        .option("--after-seq <number>", "resume after this event sequence", "0")
        .action(async (runID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        await client.getStream(`${runPath(basePath, runID)}/stream`, {
            after_seq: options.afterSeq,
        }, (chunk) => process.stdout.write(chunk));
    });
    cmd.command("logs")
        .description("Get sandbox logs")
        .argument("<run-id>", "sandbox run UUID")
        .option("--limit <number>", "maximum log lines/items to return", "100")
        .action(async (runID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.get(`${runPath(basePath, runID)}/logs`, {
            limit: options.limit,
        }));
    });
    cmd.command("files")
        .description("List files under a sandbox workspace path")
        .argument("<run-id>", "sandbox run UUID")
        .option("--path <path>", "workspace path")
        .action(async (runID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.get(`${runPath(basePath, runID)}/files`, {
            path: options.path,
        }));
    });
    cmd.command("read")
        .description("Read one file from the sandbox workspace")
        .argument("<run-id>", "sandbox run UUID")
        .requiredOption("--path <path>", "workspace file path")
        .action(async (runID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.get(`${runPath(basePath, runID)}/files/content`, {
            path: options.path,
        }));
    });
    cmd.command("archive")
        .description("Download a workspace path as an archive")
        .argument("<run-id>", "sandbox run UUID")
        .requiredOption("--path <path>", "workspace path to archive")
        .option("-o, --output <path>", "write archive to file instead of stdout")
        .addHelpText("after", `

Examples:
  seaagent ${name} archive <run-id> --path /agent-workspace -o workspace.tgz
  seaagent ${name} archive <run-id> --path /agent-workspace/src > src.tgz`)
        .action(async (runID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        const data = await client.getBytes(`${runPath(basePath, runID)}/files/archive`, {
            path: options.path,
        });
        if (options.output) {
            await writeFile(options.output, data);
            console.log(`wrote ${data.length} bytes to ${options.output}`);
            return;
        }
        process.stdout.write(data);
    });
    cmd.command("command")
        .description("Run a shell command inside the sandbox workspace")
        .argument("<run-id>", "sandbox run UUID")
        .requiredOption("-c, --command <command>", "shell command to run inside the sandbox workspace")
        .option("--cwd <path>", "working directory")
        .option("--timeout <seconds>", "command timeout in seconds")
        .option("--env <key=value...>", "environment variables")
        .addHelpText("after", `

Examples:
  seaagent ${name} command <run-id> -c "pwd && ls" --cwd /agent-workspace
  seaagent ${name} command <run-id> -c "npm test" --timeout 120 --env NODE_ENV=test`)
        .action(async (runID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.post(`${runPath(basePath, runID)}/commands`, {
            command: options.command,
            cwd: options.cwd,
            timeout: optionalNumber(options.timeout),
            env: parseEnv(options.env),
        }));
    });
    cmd.command("refresh").description("Refresh sandbox run state from the worker").argument("<run-id>", "sandbox run UUID").action(async (runID) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.post(`${runPath(basePath, runID)}/refresh`));
    });
    cmd.command("resume").description("Resume a paused or interrupted sandbox run").argument("<run-id>", "sandbox run UUID").action(async (runID) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.post(`${runPath(basePath, runID)}/resume`));
    });
    cmd.command("delete").description("Delete a sandbox run").argument("<run-id>", "sandbox run UUID").action(async (runID) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.delete(runPath(basePath, runID)));
    });
    return cmd;
}
function runPath(basePath, runID) {
    return `${basePath}/${encodeURIComponent(runID)}`;
}
function optionalNumber(value) {
    if (value === undefined || value === "") {
        return undefined;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new Error(`expected number, got ${value}`);
    }
    return number;
}
function parseEnv(values) {
    if (values === undefined) {
        return undefined;
    }
    const items = Array.isArray(values) ? values : [values];
    const env = {};
    for (const item of items) {
        if (typeof item !== "string") {
            throw new Error(`expected env key=value, got ${String(item)}`);
        }
        const index = item.indexOf("=");
        if (index <= 0) {
            throw new Error(`expected env key=value, got ${item}`);
        }
        env[item.slice(0, index)] = item.slice(index + 1);
    }
    return env;
}
