import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";
const configPath = join(homedir(), ".seaagent", "config.yaml");
export async function loadConfig() {
    try {
        const raw = await readFile(configPath, "utf8");
        return (YAML.parse(raw) ?? {});
    }
    catch (error) {
        if (error?.code === "ENOENT") {
            return {};
        }
        throw error;
    }
}
export async function saveConfig(config) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, YAML.stringify(config), "utf8");
}
export function getConfigPath() {
    return configPath;
}
