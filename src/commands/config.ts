import { Command } from "commander";
import { getConfigPath, loadConfig, saveConfig } from "../lib/config-store.js";
import { printJSON } from "../lib/output.js";

export function configCommand(): Command {
  const cmd = new Command("config").description("Manage seaagent config");

  cmd
    .command("set")
    .argument("<key>", "endpoint or api-key")
    .argument("<value>")
    .action(async (key: string, value: string) => {
      const config = await loadConfig();
      if (key === "endpoint") {
        config.endpoint = value;
      } else if (key === "api-key") {
        config.apiKey = value;
      } else {
        throw new Error("supported keys: endpoint, api-key");
      }
      await saveConfig(config);
      console.log(`saved ${key} to ${getConfigPath()}`);
    });

  cmd.command("get").action(async () => {
    const config = await loadConfig();
    printJSON({
      ...config,
      apiKey: config.apiKey ? maskSecret(config.apiKey) : undefined,
    });
  });

  cmd.command("path").action(() => {
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
