import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { printJSON } from "../lib/output.js";

export function gameCommand(): Command {
  const cmd = new Command("game").description("Inspect and manage sandbox game runs");

  cmd
    .command("create")
    .description("Create a sandbox run via /v1/game/runs")
    .requiredOption("--prompt <text>", "run prompt")
    .option("--template-id <id>", "sandbox template id")
    .option("--preview-port <number>", "preview port")
    .option("--workspace-root <path>", "workspace root", "/agent-workspace")
    .action(async (options) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.post("/v1/game/runs", {
        prompt: options.prompt,
        template_id: options.templateId,
        preview_port: optionalNumber(options.previewPort),
        workspace_root: options.workspaceRoot,
      }));
    });

  cmd.command("get").argument("<run-id>").action(async (runID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.get(`/v1/game/runs/${encodeURIComponent(runID)}`));
  });

  cmd.command("events")
    .argument("<run-id>")
    .option("--after-seq <number>", "after sequence", "0")
    .option("--limit <number>", "limit", "100")
    .action(async (runID: string, options) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.get(`/v1/game/runs/${encodeURIComponent(runID)}/events`, {
        after_seq: options.afterSeq,
        limit: options.limit,
      }));
    });

  cmd.command("logs").argument("<run-id>").action(async (runID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.get(`/v1/game/runs/${encodeURIComponent(runID)}/logs`));
  });

  cmd.command("command")
    .argument("<run-id>")
    .requiredOption("-c, --command <command>", "shell command to run inside the sandbox workspace")
    .option("--cwd <path>", "working directory")
    .option("--timeout <seconds>", "command timeout in seconds")
    .action(async (runID: string, options) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.post(`/v1/game/runs/${encodeURIComponent(runID)}/commands`, {
        command: options.command,
        cwd: options.cwd,
        timeout: optionalNumber(options.timeout),
      }));
    });

  cmd.command("refresh").argument("<run-id>").action(async (runID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.post(`/v1/game/runs/${encodeURIComponent(runID)}/refresh`));
  });

  cmd.command("delete").argument("<run-id>").action(async (runID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.delete(`/v1/game/runs/${encodeURIComponent(runID)}`));
  });

  return cmd;
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
