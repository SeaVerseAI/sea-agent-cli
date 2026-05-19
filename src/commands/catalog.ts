import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { printTable } from "../lib/output.js";

export function catalogCommand(): Command {
  const cmd = new Command("catalog").description("Discover tools and skills");

  cmd
    .command("list")
    .description("List catalog entries via /v1/catalog")
    .option("--capability-type <value>", "tool or skill")
    .option("--search <value>")
    .option("--status <value>")
    .option("--public <true|false>")
    .option("--provider <value>")
    .option("--limit <number>", "page size", "20")
    .option("--offset <number>", "page offset", "0")
    .action(async (options) => {
      const client = await AgentGatewayClient.fromConfig();
      const response = await client.get("/v1/catalog", {
        capability_type: options.capabilityType,
        search: options.search,
        status: options.status,
        public: options.public,
        provider: options.provider,
        limit: options.limit,
        offset: options.offset,
      });
      printTable((response as any).data?.items ?? (response as any).data ?? response);
    });

  return cmd;
}
