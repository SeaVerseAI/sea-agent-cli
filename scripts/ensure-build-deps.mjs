import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageJSON = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const requiredPackages = ["typescript", "@types/node"];

const missingPackages = requiredPackages.filter((name) => !packageInstalled(name));
if (missingPackages.length > 0) {
  const installSpecs = missingPackages.map((name) => `${name}@${packageJSON.devDependencies?.[name] ?? "latest"}`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  console.error(`[build] Installing missing build dependencies: ${installSpecs.join(" ")}`);
  execFileSync(npm, [
    "install",
    "--ignore-scripts",
    "--no-save",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
    ...installSpecs,
  ], {
    cwd: root,
    stdio: "inherit",
  });
}

function packageInstalled(name) {
  return existsSync(join(root, "node_modules", ...name.split("/"), "package.json"));
}
