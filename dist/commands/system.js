import { Command } from "commander";
import { AgentGatewayClient } from "../lib/client.js";
import { addHelpText } from "../lib/help.js";
export function systemCommand() {
    const cmd = addHelpText(new Command("system").description("Inspect gateway health and metrics"), `
Examples:
  seaagent system health
  seaagent system metrics

Notes:
  These commands use the configured endpoint from ~/.seaagent/config.yaml.
`);
    cmd.command("health").description("GET /health").action(async () => {
        const client = await AgentGatewayClient.fromConfig();
        console.log(await client.getText("/health"));
    });
    cmd.command("metrics").description("GET /metrics").action(async () => {
        const client = await AgentGatewayClient.fromConfig();
        console.log(await client.getText("/metrics"));
    });
    return cmd;
}
