import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { addHelpText, commonListHelp } from "../lib/help.js";
import { printTable } from "../lib/output.js";
export function catalogCommand() {
    const cmd = addHelpText(new Command("catalog").description("Discover tools and skills"), `
Use catalog for read-only discovery across registered tools and skills.

${commonListHelp}

Examples:
  seaagent catalog list
  seaagent catalog list --capability-type tool --status active --provider web-tools-mcp
  seaagent catalog list --capability-type skill --search media --limit 50
`);
    cmd
        .command("list")
        .description("List catalog entries via /v1/catalog")
        .option("--capability-type <tool|skill>", "filter by capability type")
        .option("--search <value>", "search text")
        .option("--status <value>", "draft, active, deprecated, disabled, or deleted")
        .option("--public <true|false>", "filter by public visibility when supported")
        .option("--provider <value>", "provider namespace")
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
        printTable(response.data?.items ?? response.data ?? response);
    });
    return cmd;
}
