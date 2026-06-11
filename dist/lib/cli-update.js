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
export async function maybeNotifyCliUpdate(argv) {
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
export async function getCliUpdateStatus(options = {}) {
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
    }
    catch (error) {
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
export async function updateCliPackage() {
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
    }
    finally {
        await rm(tempRoot, { recursive: true, force: true });
    }
}
function cliUpdateMessage(status) {
    const local = status.localCommit ? shortCommit(status.localCommit) : "unknown";
    const remote = shortCommit(status.remoteCommit);
    return `seaagent CLI update available: local ${local}, remote ${status.githubBranch} ${remote}.`;
}
function isRemoteNewer(localCommit, remoteCommit) {
    if (!remoteCommit) {
        return false;
    }
    if (!localCommit) {
        return true;
    }
    return !remoteCommit.startsWith(localCommit) && !localCommit.startsWith(remoteCommit);
}
async function fetchRemoteCommit(githubRepo, githubBranch, timeoutMs) {
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
        const parsed = JSON.parse(text);
        if (typeof parsed.sha !== "string" || parsed.sha === "") {
            throw new Error("GitHub update check response did not include a commit sha");
        }
        return {
            sha: parsed.sha,
            htmlURL: typeof parsed.html_url === "string" ? parsed.html_url : undefined,
        };
    }
    finally {
        clearTimeout(timer);
    }
}
async function readCliBuildInfo() {
    try {
        const raw = await readFile(resolve(packageRoot(), "dist", "build-info.json"), "utf8");
        return JSON.parse(raw);
    }
    catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }
    try {
        const raw = await readFile(resolve(packageRoot(), "package.json"), "utf8");
        const parsed = JSON.parse(raw);
        return {
            name: parsed.name,
            version: parsed.version,
            githubRepo: DEFAULT_GITHUB_REPO,
            githubBranch: DEFAULT_GITHUB_BRANCH,
            installSpec: DEFAULT_INSTALL_SPEC,
        };
    }
    catch {
        return {};
    }
}
function runCommand(command, args, options = {}) {
    return new Promise((resolvePromise, reject) => {
        let output = "";
        const echoOutput = options.echoOutput ?? true;
        const child = spawn(command, args, {
            stdio: ["inherit", "pipe", "pipe"],
        });
        child.stdout?.on("data", (chunk) => {
            output += chunk.toString("utf8");
            if (echoOutput) {
                process.stdout.write(chunk);
            }
        });
        child.stderr?.on("data", (chunk) => {
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
            const error = new Error(`${command} ${args.join(" ")} failed with ${reason}`);
            error.output = output;
            reject(error);
        });
    });
}
async function findPackedTarball(packDir) {
    const entries = await readdir(packDir);
    const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
    if (tarballs.length !== 1) {
        throw new Error(`Expected one packed seaagent tarball in ${packDir}, found ${tarballs.length}`);
    }
    return join(packDir, tarballs[0]);
}
function npmCommand() {
    return process.platform === "win32" ? "npm.cmd" : "npm";
}
function seaagentBinPath(prefix) {
    return process.platform === "win32"
        ? join(prefix, "seaagent.cmd")
        : join(prefix, "bin", "seaagent");
}
function shouldSkipAutoCheck(argv) {
    if (argv.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-V")) {
        return true;
    }
    const command = argv.find((arg) => !arg.startsWith("-"));
    return command === "self" || command === "completion";
}
function isCheckDue(cache) {
    if (!cache.lastCheckedAt) {
        return true;
    }
    const lastChecked = Date.parse(cache.lastCheckedAt);
    return !Number.isFinite(lastChecked) || Date.now() - lastChecked >= CLI_CHECK_INTERVAL_MS;
}
async function readCliCheckCache() {
    try {
        return JSON.parse(await readFile(cliUpdateCachePath(), "utf8"));
    }
    catch {
        return {};
    }
}
async function writeCliCheckCache(cache) {
    const path = cliUpdateCachePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(cache, null, 2), "utf8");
}
function cliUpdateCachePath() {
    return join(homedir(), ".seaagent", "cli-update-check.json");
}
function packageRoot() {
    const currentFile = fileURLToPath(import.meta.url);
    return resolve(dirname(currentFile), "..", "..");
}
function shortCommit(commit) {
    return commit ? commit.slice(0, 12) : "";
}
function githubCommitURL(githubRepo, commit) {
    return `https://github.com/${githubRepo}/commit/${commit}`;
}
function githubBranchURL(githubRepo, branch) {
    return `https://github.com/${githubRepo}/tree/${encodeURIComponent(branch)}`;
}
