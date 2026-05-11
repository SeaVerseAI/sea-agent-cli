import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";
import type { Config } from "../types.js";

const configPath = join(homedir(), ".seaagent", "config.yaml");

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(configPath, "utf8");
    return (YAML.parse(raw) ?? {}) as Config;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, YAML.stringify(config), "utf8");
}

export function getConfigPath(): string {
  return configPath;
}
