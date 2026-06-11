import { readFile } from "node:fs/promises";
import YAML from "yaml";
export async function readPayload(path) {
    const raw = await readFile(path, "utf8");
    if (path.endsWith(".yaml") || path.endsWith(".yml")) {
        return YAML.parse(raw);
    }
    return JSON.parse(raw);
}
