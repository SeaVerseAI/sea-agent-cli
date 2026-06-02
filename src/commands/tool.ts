import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { confirmRegistryMutation } from "../lib/confirmation.js";
import { readPayload } from "../lib/files.js";
import { addHelpText, commonListHelp, payloadFileHelp } from "../lib/help.js";
import { printJSON, printTable } from "../lib/output.js";
import { warnProviderNormalized, withRegisterErrorHint } from "../lib/registry-hints.js";

export function toolCommand(): Command {
  const cmd = addHelpText(new Command("tool").description("Register and inspect tools used by skills"), `
Tools describe executable capabilities that skills can bind to.
Use immutable tool UUIDs returned by the gateway for get/update/resolve.

${commonListHelp}

${payloadFileHelp}

Examples:
  seaagent tool list --status active
  seaagent tool list --search web --provider web-tools-mcp
  seaagent tool register -f examples/tool-web-fetch.json
  seaagent tool get <tool-id>
  seaagent tool resolve <tool-id>
`);

  cmd
    .command("register")
    .description("Register a tool via /v1/tools/register")
    .requiredOption("-f, --file <path>", "JSON/YAML request file")
    .addHelpText("after", `

Examples:
  seaagent tool register -f examples/tool-web-fetch.json
  seaagent tool register --file payloads/tool.yaml

The payload should describe runtime behavior. Avoid display-only metadata unless
the target gateway deployment still requires it.

Payload notes:
  - provider may be normalized by the gateway to an internal provider UUID.
    Use the returned provider value for later --provider filters.
  - service_name is optional but recommended for HTTP tools that share one
    backing service. When omitted, gateway derives it from the endpoint host.
  - inject_user_credentials is gateway-managed and should not be provided.`)
    .action(async (options: { file: string }) => {
      const client = await AgentGatewayClient.fromConfig();
      const payload = await readPayload(options.file);
      await confirmRegistryMutation({
        action: "register",
        endpoint: client.getEndpoint(),
        payload,
        payloadPath: options.file,
        resource: "tool",
      });
      const response = await withRegisterErrorHint("tool", "examples/tool-web-fetch.json", () => client.post("/v1/tools/register", payload));
      warnProviderNormalized("tool", payload, response);
      printJSON(response);
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
    .option("--search <value>", "search text")
    .option("--status <value>", "draft, active, deprecated, disabled, or deleted")
    .option("--public <true|false>", "filter by public visibility when supported")
    .option("--provider <value>", "provider namespace")
    .option("--limit <number>", "page size", "20")
    .option("--offset <number>", "page offset", "0")
    .addHelpText("after", `

Examples:
  seaagent tool list --status active
  seaagent tool list --search image --status active --limit 50
  seaagent tool list --provider web-tools-mcp --public true`)
    .action(list);

  cmd
    .command("find")
    .description("Alias of list with search filters")
    .option("--search <value>", "search text")
    .option("--status <value>", "draft, active, deprecated, disabled, or deleted")
    .option("--public <true|false>", "filter by public visibility when supported")
    .option("--provider <value>", "provider namespace")
    .option("--limit <number>", "page size", "20")
    .option("--offset <number>", "page offset", "0")
    .action(list);

  cmd.command("get").description("Get one tool by immutable UUID").argument("<tool-id>", "tool UUID").action(async (toolID: string) => {
    const client = await AgentGatewayClient.fromConfig();
    printJSON(await client.get(`/v1/tools/${encodeURIComponent(toolID)}`));
  });

  cmd
    .command("update")
    .description("Update a tool via /v1/tools/{tool-id}")
    .argument("<tool-id>", "tool UUID")
    .requiredOption("-f, --file <path>", "JSON/YAML request file")
    .addHelpText("after", `

Examples:
  seaagent tool update <tool-id> -f payloads/tool-update.json`)
    .action(async (toolID: string, options: { file: string }) => {
      const client = await AgentGatewayClient.fromConfig();
      const payload = await readPayload(options.file);
      await confirmRegistryMutation({
        action: "update",
        endpoint: client.getEndpoint(),
        payload,
        payloadPath: options.file,
        resource: "tool",
        resourceID: toolID,
      });
      printJSON(await client.put(`/v1/tools/${encodeURIComponent(toolID)}`, payload));
    });

  cmd
    .command("resolve")
    .description("Resolve a tool's current runtime config")
    .argument("<tool-id>", "tool UUID")
    .addHelpText("after", `

Use resolve before binding a tool into a skill. It prints the normalized runtime
metadata that Agent Worker receives.`)
    .action(async (toolID: string) => {
      const client = await AgentGatewayClient.fromConfig();
      printJSON(await client.get(`/v1/tools/${encodeURIComponent(toolID)}/resolve`));
    });

  return cmd;
}
