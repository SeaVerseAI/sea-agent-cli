import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { AgentGatewayClient } from "../lib/client.js";
import { printJSON } from "../lib/output.js";

export function gameCommand(): Command {
  return sandboxRunCommand("game", "/v1/game/runs", "Inspect and manage sandbox runs via legacy /v1/game/runs routes");
}

export function sandboxCommand(): Command {
  return sandboxRunCommand("sandbox", "/v1/sandbox/runs", "Inspect and manage sandbox runs");
}

function sandboxRunCommand(name: string, basePath: string, description: string): Command {
  const cmd = new Command(name).description(description);

  cmd
    .command("create")
    .description(`Create a sandbox run via ${basePath}`)
    .requiredOption("--prompt <text>", "run prompt")
    .option("--template-id <id>", "sandbox template id")
    .option("--sandbox-template <id>", "sandbox template alias")
    .option("--preview-port <number>", "preview port")
    .option("--workspace-root <path>", "workspace root", "/agent-workspace")
    .option("--user-id <id>", "user id")
    .option("--conversation-id <id>", "conversation id")
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

  cmd.command("get").argument("<run-id>").action(async (runID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.get(runPath(basePath, runID)));
  });

  cmd.command("events")
    .argument("<run-id>")
    .option("--after-seq <number>", "after sequence", "0")
    .option("--limit <number>", "limit", "100")
    .action(async (runID: string, options) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.get(`${runPath(basePath, runID)}/events`, {
        after_seq: options.afterSeq,
        limit: options.limit,
      }));
    });

  cmd.command("stream")
    .argument("<run-id>")
    .option("--after-seq <number>", "after sequence", "0")
    .action(async (runID: string, options) => {
      const client = await AgentGatewayClient.fromConfig();
      await client.getStream(`${runPath(basePath, runID)}/stream`, {
        after_seq: options.afterSeq,
      }, (chunk) => process.stdout.write(chunk));
    });

  cmd.command("logs")
    .argument("<run-id>")
    .option("--limit <number>", "limit", "100")
    .action(async (runID: string, options) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.get(`${runPath(basePath, runID)}/logs`, {
        limit: options.limit,
      }));
    });

  cmd.command("files")
    .argument("<run-id>")
    .option("--path <path>", "workspace path")
    .action(async (runID: string, options) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.get(`${runPath(basePath, runID)}/files`, {
        path: options.path,
      }));
    });

  cmd.command("read")
    .argument("<run-id>")
    .requiredOption("--path <path>", "workspace file path")
    .action(async (runID: string, options) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.get(`${runPath(basePath, runID)}/files/content`, {
        path: options.path,
      }));
    });

  cmd.command("archive")
    .argument("<run-id>")
    .requiredOption("--path <path>", "workspace path to archive")
    .option("-o, --output <path>", "write archive to file instead of stdout")
    .action(async (runID: string, options) => {
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
    .argument("<run-id>")
    .requiredOption("-c, --command <command>", "shell command to run inside the sandbox workspace")
    .option("--cwd <path>", "working directory")
    .option("--timeout <seconds>", "command timeout in seconds")
    .option("--env <key=value...>", "environment variables")
    .action(async (runID: string, options) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.post(`${runPath(basePath, runID)}/commands`, {
        command: options.command,
        cwd: options.cwd,
        timeout: optionalNumber(options.timeout),
        env: parseEnv(options.env),
      }));
    });

  cmd.command("refresh").argument("<run-id>").action(async (runID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.post(`${runPath(basePath, runID)}/refresh`));
  });

  cmd.command("resume").argument("<run-id>").action(async (runID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.post(`${runPath(basePath, runID)}/resume`));
  });

  cmd.command("delete").argument("<run-id>").action(async (runID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.delete(runPath(basePath, runID)));
  });

  return cmd;
}

function runPath(basePath: string, runID: string): string {
  return `${basePath}/${encodeURIComponent(runID)}`;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`expected number, got ${value}`);
  }
  return number;
}

function parseEnv(values: unknown): Record<string, string> | undefined {
  if (values === undefined) {
    return undefined;
  }
  const items = Array.isArray(values) ? values : [values];
  const env: Record<string, string> = {};
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
