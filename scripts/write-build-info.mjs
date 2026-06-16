import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageJSON = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const buildInfo = {
  name: packageJSON.name,
  version: packageJSON.version,
  gitCommit: process.env.npm_package_gitHead || git(["rev-parse", "HEAD"]),
  githubRepo: "SeaArt-Infra/sea-agent-cli",
  githubBranch: "main",
  installSpec: "git+https://github.com/SeaArt-Infra/sea-agent-cli.git",
  builtAt: new Date().toISOString(),
};

const target = join(root, "dist", "build-info.json");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");
