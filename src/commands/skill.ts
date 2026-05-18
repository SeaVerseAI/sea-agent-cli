import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { readPayload } from "../lib/files.js";
import { printJSON, printTable } from "../lib/output.js";

export function skillCommand(): Command {
  const cmd = new Command("skill").description("Register and inspect skills");

  cmd
    .command("register")
    .description("Register a skill via /v1/skills/register")
    .requiredOption("-f, --file <path>", "JSON/YAML request file")
    .action(async (options: { file: string }) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.post("/v1/skills/register", await readPayload(options.file)));
    });

  cmd
    .command("tool-register")
    .description("Register a Tool used by a Skill")
    .requiredOption("-f, --file <path>", "JSON/YAML request file")
    .action(async (options: { file: string }) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.post("/v1/tools/register", await readPayload(options.file)));
    });

  cmd
    .command("list")
    .option("--search <value>")
    .option("--status <value>")
    .option("--source-kind <value>")
    .option("--public <true|false>")
    .option("--provider <value>")
    .option("--limit <number>", "page size", "20")
    .option("--offset <number>", "page offset", "0")
    .action(async (options) => {
      const client = await AgentGatewayClient.fromConfig();
      const response = await client.get("/v1/skills", {
        search: options.search,
        status: options.status,
        source_kind: options.sourceKind,
        public: options.public,
        provider: options.provider,
        limit: options.limit,
        offset: options.offset,
      });
      printTable((response as any).data ?? response);
    });

  cmd.command("get").argument("<skill-id>").action(async (skillID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.get(`/v1/skills/${encodeURIComponent(skillID)}`));
  });

  cmd
    .command("update")
    .description("Update a skill via /v1/skills/{skill-id}")
    .argument("<skill-id>")
    .requiredOption("-f, --file <path>", "JSON/YAML request file")
    .action(async (skillID: string, options: { file: string }) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.put(`/v1/skills/${encodeURIComponent(skillID)}`, await readPayload(options.file)));
    });

  cmd
    .command("delete")
    .description("Delete a skill via /v1/skills/{skill-id}")
    .argument("<skill-id>")
    .action(async (skillID: string) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.delete(`/v1/skills/${encodeURIComponent(skillID)}`));
    });

  return cmd;
}
