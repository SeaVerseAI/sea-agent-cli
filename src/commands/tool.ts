import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { readPayload } from "../lib/files.js";
import { printJSON, printTable } from "../lib/output.js";

export function toolCommand(): Command {
  const cmd = new Command("tool").description("Register and inspect tools used by skills");

  cmd
    .command("register")
    .description("Register a tool via /v1/tools/register")
    .requiredOption("-f, --file <path>", "JSON/YAML request file")
    .action(async (options: { file: string }) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.post("/v1/tools/register", await readPayload(options.file)));
    });

  const list = async (options: any) => {
    const client = await AgentGatewayClient.fromConfig();
    const response = await client.get("/v1/tools", {
      search: options.search,
      status: options.status,
      public: options.public,
      provider: options.provider,
      limit: options.limit,
      offset: options.offset,
    });
    printTable((response as any).data ?? response);
  };

  cmd
    .command("list")
    .description("List tools")
    .option("--search <value>")
    .option("--status <value>")
    .option("--public <true|false>")
    .option("--provider <value>")
    .option("--limit <number>", "page size", "20")
    .option("--offset <number>", "page offset", "0")
    .action(list);

  cmd
    .command("find")
    .description("Alias of list with search filters")
    .option("--search <value>")
    .option("--status <value>")
    .option("--public <true|false>")
    .option("--provider <value>")
    .option("--limit <number>", "page size", "20")
    .option("--offset <number>", "page offset", "0")
    .action(list);

  cmd.command("get").argument("<tool-id>").action(async (toolID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.get(`/v1/tools/${encodeURIComponent(toolID)}`));
  });

  cmd
    .command("update")
    .description("Update a tool via /v1/tools/{tool-id}")
    .argument("<tool-id>")
    .requiredOption("-f, --file <path>", "JSON/YAML request file")
    .action(async (toolID: string, options: { file: string }) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.put(`/v1/tools/${encodeURIComponent(toolID)}`, await readPayload(options.file)));
    });

  cmd
    .command("delete")
    .description("Delete a tool via /v1/tools/{tool-id}")
    .argument("<tool-id>")
    .requiredOption("--operator-id <id>", "operator id used for ownership validation")
    .action(async (toolID: string, options: { operatorId: string }) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.delete(`/v1/tools/${encodeURIComponent(toolID)}`, {
        operator_id: options.operatorId,
      }));
    });

  cmd
    .command("resolve")
    .description("Resolve a tool's current runtime config")
    .argument("<tool-id>")
    .action(async (toolID: string) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.get(`/v1/tools/${encodeURIComponent(toolID)}/resolve`));
    });

  return cmd;
}
