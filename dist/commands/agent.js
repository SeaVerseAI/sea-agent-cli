import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { confirmRegistryMutation } from "../lib/confirmation.js";
import { readPayload } from "../lib/files.js";
import { addHelpText, payloadFileHelp } from "../lib/help.js";
import { printJSON, printTable } from "../lib/output.js";
import { withRegisterErrorHint } from "../lib/registry-hints.js";
export function agentCommand() {
    const cmd = addHelpText(new Command("agent").description("Register and inspect agents"), `
Agents bind skills and runtime configuration into runnable gateway resources.
Use immutable agent UUIDs returned by the gateway for update/capabilities/chat.

Agent categories:
  fabric    Normal Fabric scheduler pool
  seaactor  SeaActor scheduler pool

Common list filters:
  --search <value>      Match agent names and metadata
  --status <value>      draft | active | deprecated | disabled | deleted
  --owner-id <value>    Owner/production-line ID
  --category <value>    fabric | seaactor
  --limit <number>      Page size
  --offset <number>     Page offset

${payloadFileHelp}

Examples:
  seaagent agent list --status active
  seaagent agent register -f examples/agent-web.json
  seaagent agent get <agent-id>
  seaagent agent delete <agent-id>
  seaagent agent capabilities <agent-id>
  seaagent chat run <agent-id> "hello"
`);
    cmd
        .command("register")
        .description("Register an agent via /v1/agents/register")
        .requiredOption("-f, --file <path>", "JSON/YAML request file")
        .addHelpText("after", `

Examples:
  seaagent agent register -f examples/agent-web.json
  seaagent agent register -f examples/agent-sandbox.json

Payload notes:
  - category is required by current gateway deployments: fabric or seaactor.
  - Do not send agent_key for new registrations; gateway returns an immutable UUID.
  - Reuse existing skills by putting their immutable UUIDs in skills.
  - Runtime settings belong in config/agent_config.

Minimal payload:
  {
    "name": "weather_assistant",
    "category": "fabric",
    "model": {"default": "claude-sonnet-4-6-seawork"},
    "system_prompt": "You are a concise assistant.",
    "skills": ["<skill-uuid>"],
    "config": {"temperature": 0.2},
    "enabled": true
  }`)
        .action(async (options) => {
        const client = await AgentGatewayClient.fromConfig();
        const payload = await readPayload(options.file);
        await confirmRegistryMutation({
            action: "register",
            endpoint: client.getEndpoint(),
            payload,
            payloadPath: options.file,
            resource: "agent",
        });
        printJSON(await withRegisterErrorHint("agent", "examples/agent-web.json", () => client.post("/v1/agents/register", payload)));
    });
    cmd
        .command("update")
        .description("Update an agent via /v1/agents/{agent-id}")
        .argument("<agent-id>", "agent UUID")
        .requiredOption("-f, --file <path>", "JSON/YAML request file")
        .addHelpText("after", `

Example:
  seaagent agent update <agent-id> -f payloads/agent-update.json`)
        .action(async (agentID, options) => {
        const client = await AgentGatewayClient.fromConfig();
        const payload = await readPayload(options.file);
        await confirmRegistryMutation({
            action: "update",
            endpoint: client.getEndpoint(),
            payload,
            payloadPath: options.file,
            resource: "agent",
            resourceID: agentID,
        });
        printJSON(await client.put(`/v1/agents/${encodeURIComponent(agentID)}`, payload));
    });
    cmd
        .command("delete")
        .description("Delete an agent via /v1/agents/{agent-id}")
        .argument("<agent-id>", "agent UUID")
        .addHelpText("after", `

Example:
  seaagent agent delete <agent-id>

Delete uses the configured user-id as X-User-ID. The gateway only allows the
agent owner to delete the agent.`)
        .action(async (agentID) => {
        const client = await AgentGatewayClient.fromConfig();
        await confirmRegistryMutation({
            action: "delete",
            endpoint: client.getEndpoint(),
            resource: "agent",
            resourceID: agentID,
        });
        printJSON(await client.delete(`/v1/agents/${encodeURIComponent(agentID)}`));
    });
    cmd
        .command("list")
        .description("List agents")
        .option("--search <value>", "search text")
        .option("--status <value>", "draft, active, deprecated, disabled, or deleted")
        .option("--owner-id <value>", "owner ID")
        .option("--category <fabric|seaactor>", "scheduler category")
        .option("--limit <number>", "page size", "20")
        .option("--offset <number>", "page offset", "0")
        .addHelpText("after", `

Examples:
  seaagent agent list --status active
  seaagent agent list --owner-id production-line-123
  seaagent agent list --category fabric --search web --limit 50`)
        .action(async (options) => {
        const client = await AgentGatewayClient.fromConfig();
        const response = await client.get("/v1/agents", {
            search: options.search,
            status: options.status,
            owner_id: options.ownerId,
            category: options.category,
            limit: options.limit,
            offset: options.offset,
        });
        printTable(response.data ?? response);
    });
    cmd
        .command("get")
        .description("Get one agent by immutable UUID")
        .argument("<agent-id>", "agent UUID")
        .action(async (agentID) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.get(`/v1/agents/${encodeURIComponent(agentID)}`));
    });
    cmd
        .command("capabilities")
        .description("Show resolved skills and tools available to an agent")
        .argument("<agent-id>", "agent UUID")
        .addHelpText("after", `

Run this after agent or skill changes to verify what the worker will see.

Example:
  seaagent agent capabilities <agent-id>`)
        .action(async (agentID) => {
        const client = await AgentGatewayClient.fromConfig();
        printJSON(await client.get(`/v1/agents/${encodeURIComponent(agentID)}/capabilities`));
    });
    return cmd;
}
