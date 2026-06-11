import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { readPayload } from "../lib/files.js";
import { addHelpText, payloadFileHelp } from "../lib/help.js";
import { printJSON, printTable } from "../lib/output.js";
export function hookCommand() {
    const cmd = addHelpText(new Command("hook").description("Register and manage Agent Worker hooks for the configured API key"), `
Hooks are owned by the configured API key. Hook payload files do not include
api_key; the CLI sends the configured key as Authorization: Bearer <api-key>.

${payloadFileHelp}

Examples:
  seaagent hook register -f examples/hook.json
  seaagent hook list
  seaagent hook get <hook-id>
`);
    cmd
        .command("register")
        .description("Register or update the hook for the configured API key")
        .requiredOption("-f, --file <path>", "JSON/YAML hook payload file")
        .addHelpText("after", `

Example:
  seaagent hook register -f examples/hook.json`)
        .action(async (options) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.post("/v1/hooks/register", await readPayload(options.file)));
    });
    cmd
        .command("list")
        .description("List hooks for the configured API key")
        .option("--search <value>", "search text")
        .option("--limit <number>", "page size", "20")
        .option("--offset <number>", "page offset", "0")
        .action(async (options) => {
        const client = await AgentGatewayClient.fromConfig();
        const response = await client.get("/v1/hooks", {
            search: options.search,
            limit: options.limit,
            offset: options.offset,
        });
        printTable(response.data ?? response);
    });
    cmd
        .command("get")
        .description("Get a hook owned by the configured API key")
        .argument("<hook-id>", "hook UUID")
        .action(async (hookID) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.get(`/v1/hooks/${encodeURIComponent(hookID)}`));
    });
    cmd
        .command("update")
        .description("Update a hook owned by the configured API key")
        .argument("<hook-id>", "hook UUID")
        .requiredOption("-f, --file <path>", "JSON/YAML hook payload file")
        .addHelpText("after", `

Example:
  seaagent hook update <hook-id> -f payloads/hook-update.json`)
        .action(async (hookID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.put(`/v1/hooks/${encodeURIComponent(hookID)}`, await readPayload(options.file)));
    });
    cmd
        .command("delete")
        .description("Delete a hook owned by the configured API key")
        .argument("<hook-id>", "hook UUID")
        .action(async (hookID) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.delete(`/v1/hooks/${encodeURIComponent(hookID)}`));
    });
    return cmd;
}
