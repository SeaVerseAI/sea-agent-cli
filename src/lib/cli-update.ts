import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "undici";

const CLI_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLI_CHECK_TIMEOUT_MS = 2_000;
const DEFAULT_NAME = "@seaart/sea-agent-cli";
const DEFAULT_VERSION = "0.1.0";
const DEFAULT_GITHUB_REPO = "SeaVerseAI/sea-agent-cli";
const DEFAULT_GITHUB_BRANCH = "main";
const DEFAULT_INSTALL_SPEC = "git+https://github.com/SeaVerseAI/sea-agent-cli.git";

type CliUpdateCheckCache = {
  lastCheckedAt?: string;
  localCommit?: string;
  remoteCommit?: string;
  status?: CliUpdateStatus["status"];
  error?: string;
};

type CliBuildInfo = {
  name?: string;
  version?: string;
  gitCommit?: string;
  githubRepo?: string;
  githubBranch?: string;
  installSpec?: string;
  builtAt?: string;
};

type CommandResult = {
  output: string;
};

type CommandFailure = Error & {
  output?: string;
};

type RemoteCommit = {
  sha: string;
  htmlURL?: string;
};

export type CliUpdateStatus = {
  name: string;
  currentVersion: string;
  localCommit: string;
  remoteCommit: string;
  remoteURL: string;
  githubRepo: string;
  githubBranch: string;
  installSpec: string;
  cachePath: string;
  checkedAt: string;
  status: "up-to-date" | "update-available" | "unknown";
  updateAvailable: boolean;
  builtAt?: string;
  error?: string;
};

export type CliUpdateResult = {
  updated: boolean;
  installSpec: string;
  command: string;
  packageFile?: string;
  verifiedCommand?: string;
};

export async function maybeNotifyCliUpdate(argv: string[]): Promise<void> {
  if (process.env.SEAAGENT_NO_UPDATE_CHECK === "1") {
    return;
  }
  if (shouldSkipAutoCheck(argv)) {
    return;
  }
  const cache = await readCliCheckCache();
  if (!isCheckDue(cache)) {
    return;
  }

  const status = await getCliUpdateStatus({ timeoutMs: CLI_CHECK_TIMEOUT_MS });
  await writeCliCheckCache({
    lastCheckedAt: status.checkedAt,
    localCommit: status.localCommit,
    remoteCommit: status.remoteCommit,
    status: status.status,
    error: status.error,
  });
  if (!status.updateAvailable) {
    return;
  }
  process.stderr.write(`[update] ${cliUpdateMessage(status)} Run: seaagent self update\n`);
}

export async function getCliUpdateStatus(options: { timeoutMs?: number } = {}): Promise<CliUpdateStatus> {
  const checkedAt = new Date().toISOString();
  const buildInfo = await readCliBuildInfo();
  const githubRepo = buildInfo.githubRepo || DEFAULT_GITHUB_REPO;
  const githubBranch = buildInfo.githubBranch || DEFAULT_GITHUB_BRANCH;
  const installSpec = buildInfo.installSpec || DEFAULT_INSTALL_SPEC;
  const localCommit = buildInfo.gitCommit || "";

  try {
    const remote = await fetchRemoteCommit(githubRepo, githubBranch, options.timeoutMs ?? 10_000);
    const updateAvailable = isRemoteNewer(localCommit, remote.sha);
    return {
      name: buildInfo.name || DEFAULT_NAME,
      currentVersion: buildInfo.version || DEFAULT_VERSION,
      localCommit,
      remoteCommit: remote.sha,
      remoteURL: remote.htmlURL || githubCommitURL(githubRepo, remote.sha),
      githubRepo,
      githubBranch,
      installSpec,
      cachePath: cliUpdateCachePath(),
      checkedAt,
      status: updateAvailable ? "update-available" : "up-to-date",
      updateAvailable,
      builtAt: buildInfo.builtAt,
    };
  } catch (error) {
    return {
      name: buildInfo.name || DEFAULT_NAME,
      currentVersion: buildInfo.version || DEFAULT_VERSION,
      localCommit,
      remoteCommit: "",
      remoteURL: githubBranchURL(githubRepo, githubBranch),
      githubRepo,
      githubBranch,
      installSpec,
      cachePath: cliUpdateCachePath(),
      checkedAt,
      status: "unknown",
      updateAvailable: false,
      builtAt: buildInfo.builtAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function updateCliPackage(): Promise<CliUpdateResult> {
  const buildInfo = await readCliBuildInfo();
  const installSpec = buildInfo.installSpec || DEFAULT_INSTALL_SPEC;
  const command = npmCommand();
  const tempRoot = await mkdtemp(join(tmpdir(), "seaagent-update-"));
  const packDir = join(tempRoot, "pack");
  const verifyPrefix = join(tempRoot, "verify");

  try {
    await mkdir(packDir, { recursive: true });
    process.stderr.write(`[update] Packing ${installSpec} before changing the current install.\n`);
    await runCommand(command, ["pack", installSpec, "--pack-destination", packDir]);
    const packageFile = await findPackedTarball(packDir);

    process.stderr.write("[update] Verifying the package in a temporary npm prefix.\n");
    const verifyArgs = ["install", "-g", "--prefix", verifyPrefix, packageFile];
    await runCommand(command, verifyArgs);
    await runCommand(seaagentBinPath(verifyPrefix), ["--version"], { echoOutput: false });

    const finalArgs = ["install", "-g", "--force", packageFile];
    process.stderr.write("[update] Installing the verified package globally.\n");
    await runCommand(command, finalArgs);
    return {
      updated: true,
      installSpec,
      command: `${command} ${finalArgs.join(" ")}`,
      packageFile,
      verifiedCommand: `${command} ${verifyArgs.join(" ")}`,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function cliUpdateMessage(status: CliUpdateStatus): string {
  const local = status.localCommit ? shortCommit(status.localCommit) : "unknown";
  const remote = shortCommit(status.remoteCommit);
  return `seaagent CLI update available: local ${local}, remote ${status.githubBranch} ${remote}.`;
}

function isRemoteNewer(localCommit: string, remoteCommit: string): boolean {
  if (!remoteCommit) {
    return false;
  }
  if (!localCommit) {
    return true;
  }
  return !remoteCommit.startsWith(localCommit) && !localCommit.startsWith(remoteCommit);
}

async function fetchRemoteCommit(githubRepo: string, githubBranch: string, timeoutMs: number): Promise<RemoteCommit> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await request(`https://api.github.com/repos/${githubRepo}/commits/${encodeURIComponent(githubBranch)}`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "seaagent-cli",
      },
      signal: controller.signal,
    });
    const text = await response.body.text();
    if (response.statusCode >= 400) {
      throw new Error(`GitHub update check failed: ${response.statusCode} ${text.slice(0, 160)}`.trim());
    }
    const parsed = JSON.parse(text) as { sha?: unknown; html_url?: unknown };
    if (typeof parsed.sha !== "string" || parsed.sha === "") {
      throw new Error("GitHub update check response did not include a commit sha");
    }
    return {
      sha: parsed.sha,
      htmlURL: typeof parsed.html_url === "string" ? parsed.html_url : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readCliBuildInfo(): Promise<CliBuildInfo> {
  try {
    const raw = await readFile(resolve(packageRoot(), "dist", "build-info.json"), "utf8");
    return JSON.parse(raw) as CliBuildInfo;
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const raw = await readFile(resolve(packageRoot(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: string; version?: string };
    return {
      name: parsed.name,
      version: parsed.version,
      githubRepo: DEFAULT_GITHUB_REPO,
      githubBranch: DEFAULT_GITHUB_BRANCH,
      installSpec: DEFAULT_INSTALL_SPEC,
    };
  } catch {
    return {};
  }
}

function runCommand(command: string, args: string[], options: { echoOutput?: boolean } = {}): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    let output = "";
    const echoOutput = options.echoOutput ?? true;
    const child = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (echoOutput) {
        process.stdout.write(chunk);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (echoOutput) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise({ output });
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      const error = new Error(`${command} ${args.join(" ")} failed with ${reason}`) as CommandFailure;
      error.output = output;
      reject(error);
    });
  });
}

async function findPackedTarball(packDir: string): Promise<string> {
  const entries = await readdir(packDir);
  const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`Expected one packed seaagent tarball in ${packDir}, found ${tarballs.length}`);
  }
  return join(packDir, tarballs[0]);
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function seaagentBinPath(prefix: string): string {
  return process.platform === "win32"
    ? join(prefix, "seaagent.cmd")
    : join(prefix, "bin", "seaagent");
}

function shouldSkipAutoCheck(argv: string[]): boolean {
  if (argv.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-V")) {
    return true;
  }
  const command = argv.find((arg) => !arg.startsWith("-"));
  return command === "self" || command === "completion";
}

function isCheckDue(cache: CliUpdateCheckCache): boolean {
  if (!cache.lastCheckedAt) {
    return true;
  }
  const lastChecked = Date.parse(cache.lastCheckedAt);
  return !Number.isFinite(lastChecked) || Date.now() - lastChecked >= CLI_CHECK_INTERVAL_MS;
}

async function readCliCheckCache(): Promise<CliUpdateCheckCache> {
  try {
    return JSON.parse(await readFile(cliUpdateCachePath(), "utf8")) as CliUpdateCheckCache;
  } catch {
    return {};
  }
}

async function writeCliCheckCache(cache: CliUpdateCheckCache): Promise<void> {
  const path = cliUpdateCachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache, null, 2), "utf8");
}

function cliUpdateCachePath(): string {
  return join(homedir(), ".seaagent", "cli-update-check.json");
}

function packageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), "..", "..");
}

function shortCommit(commit: string): string {
  return commit ? commit.slice(0, 12) : "";
}

function githubCommitURL(githubRepo: string, commit: string): string {
  return `https://github.com/${githubRepo}/commit/${commit}`;
}

function githubBranchURL(githubRepo: string, branch: string): string {
  return `https://github.com/${githubRepo}/tree/${encodeURIComponent(branch)}`;
}
