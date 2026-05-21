import { Command } from "commander";
import { getConfigPath, loadConfig, saveConfig } from "../lib/config-store.js";
import { addHelpText } from "../lib/help.js";
import { printJSON } from "../lib/output.js";

export function configCommand(): Command {
  const cmd = addHelpText(new Command("config").description("Manage seaagent config"), `
Config file:
  ~/.seaagent/config.yaml

Supported keys:
  endpoint   Gateway base URL or URL with /agent-v2, for example http://127.0.0.1:8080
  api-key    Sent as Authorization: Bearer <api-key>
  user-id    Sent as X-User-ID for ownership-sensitive registry operations

Endpoint compatibility:
  If endpoint does not include /agent-v2, requests automatically use /agent-v2.

Examples:
  seaagent config set endpoint http://127.0.0.1:8080
  seaagent config set endpoint http://127.0.0.1:8080/agent-v2
  seaagent config set api-key sa-xxxxxxxx
  seaagent config set user-id production-line-123
  seaagent config get
  seaagent config path
`);

  cmd
    .command("set")
    .description("Set one config value in ~/.seaagent/config.yaml")
    .argument("<key>", "endpoint, api-key, or user-id")
    .argument("<value>", "value to store")
    .action(async (key: string, value: string) => {
      const config = await loadConfig();
      if (key === "endpoint") {
        config.endpoint = value;
      } else if (key === "api-key") {
        config.apiKey = value;
      } else if (key === "user-id") {
        config.userId = value;
      } else {
        throw new Error("supported keys: endpoint, api-key, user-id");
      }
      await saveConfig(config);
      console.log(`saved ${key} to ${getConfigPath()}`);
    });

  cmd.command("get").description("Print config as JSON, masking apiKey").action(async () => {
    const config = await loadConfig();
    printJSON({
      endpoint: config.endpoint ?? null,
      apiKey: config.apiKey ? maskSecret(config.apiKey) : null,
      userId: config.userId ?? null,
      warnings: config.userId ? [] : ["user-id is not configured; registry register/update/delete commands may use gateway defaults for ownership."],
    });
  });

  cmd.command("path").description("Print the config file path").action(() => {
    console.log(getConfigPath());
  });

  return cmd;
}

function maskSecret(value: string): string {
  if (value.length <= 10) {
    return "********";
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
