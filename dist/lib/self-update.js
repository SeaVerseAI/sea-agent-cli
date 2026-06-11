import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;
const SKILL_NAME = "seaagent-cli";
export async function maybeNotifySkillUpdate(argv) {
    if (process.env.SEAAGENT_NO_UPDATE_CHECK === "1") {
        return;
    }
    if (shouldSkipAutoCheck(argv)) {
        return;
    }
    const cache = await readCheckCache();
    if (!isCheckDue(cache)) {
        return;
    }
    const status = await getSkillUpdateStatus();
    await writeCheckCache({
        lastCheckedAt: new Date().toISOString(),
        bundledHash: status.bundledHash,
        localHash: status.localHash,
    });
    if (status.upToDate) {
        return;
    }
    process.stderr.write(`[update] ${skillUpdateMessage(status)} Run: seaagent self update-skill\n`);
}
export async function getSkillUpdateStatus() {
    const bundledPath = bundledSkillPath();
    const localPath = localSkillPath();
    const [bundledHash, localHash] = await Promise.all([
        hashDirectory(bundledPath),
        hashDirectory(localPath),
    ]);
    const [bundledVersion, localVersion] = await Promise.all([
        readSkillVersion(bundledPath),
        readSkillVersion(localPath),
    ]);
    const installed = localHash !== "";
    return {
        skill: SKILL_NAME,
        bundledPath,
        localPath,
        cachePath: checkCachePath(),
        bundledVersion,
        localVersion,
        bundledHash,
        localHash,
        installed,
        upToDate: installed && bundledHash === localHash,
    };
}
export async function updateLocalSkill() {
    const source = bundledSkillPath();
    const target = localSkillPath();
    const parent = dirname(target);
    const tmp = join(parent, `.${SKILL_NAME}.tmp-${process.pid}-${Date.now()}`);
    await mkdir(parent, { recursive: true });
    await rm(tmp, { recursive: true, force: true });
    await cp(source, tmp, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(tmp, target);
    const status = await getSkillUpdateStatus();
    await writeCheckCache({
        lastCheckedAt: new Date().toISOString(),
        bundledHash: status.bundledHash,
        localHash: status.localHash,
    });
    return status;
}
function shouldSkipAutoCheck(argv) {
    if (argv.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-V")) {
        return true;
    }
    const command = argv.find((arg) => !arg.startsWith("-"));
    return command === "self" || command === "completion";
}
function skillUpdateMessage(status) {
    if (!status.installed) {
        const bundled = status.bundledVersion || status.bundledHash.slice(0, 12);
        return `${SKILL_NAME} skill is not installed locally; bundled ${bundled} is available.`;
    }
    if (status.localVersion && status.bundledVersion && status.localVersion !== status.bundledVersion) {
        return `${SKILL_NAME} skill update available: local ${status.localVersion} < bundled ${status.bundledVersion}.`;
    }
    return `${SKILL_NAME} skill differs from the bundled copy.`;
}
function isCheckDue(cache) {
    if (!cache.lastCheckedAt) {
        return true;
    }
    const lastChecked = Date.parse(cache.lastCheckedAt);
    return !Number.isFinite(lastChecked) || Date.now() - lastChecked >= CHECK_INTERVAL_MS;
}
async function readCheckCache() {
    try {
        return JSON.parse(await readFile(checkCachePath(), "utf8"));
    }
    catch (err) {
        if (err?.code === "ENOENT") {
            return {};
        }
        return {};
    }
}
async function writeCheckCache(cache) {
    const path = checkCachePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(cache, null, 2), "utf8");
}
function bundledSkillPath() {
    return resolve(packageRoot(), "skills", SKILL_NAME);
}
function localSkillPath() {
    return join(homedir(), ".codex", "skills", SKILL_NAME);
}
function checkCachePath() {
    return join(homedir(), ".seaagent", "update-check.json");
}
function packageRoot() {
    const currentFile = fileURLToPath(import.meta.url);
    return resolve(dirname(currentFile), "..", "..");
}
async function hashDirectory(path) {
    try {
        const files = await listFiles(path);
        const hash = createHash("sha256");
        for (const file of files) {
            const rel = relative(path, file);
            hash.update(rel);
            hash.update("\0");
            hash.update(await readFile(file));
            hash.update("\0");
        }
        return hash.digest("hex");
    }
    catch (err) {
        if (err?.code === "ENOENT") {
            return "";
        }
        throw err;
    }
}
async function listFiles(path) {
    const entries = await readdir(path, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFiles(child));
        }
        else if (entry.isFile()) {
            files.push(child);
        }
    }
    return files.sort();
}
async function readSkillVersion(path) {
    try {
        const file = join(path, "SKILL.md");
        if (!(await stat(file)).isFile()) {
            return "";
        }
        const raw = await readFile(file, "utf8");
        const match = /^---\n([\s\S]*?)\n---/.exec(raw);
        if (!match) {
            return "";
        }
        const version = /^version:\s*"?([^"\n]+)"?\s*$/m.exec(match[1]);
        return version?.[1]?.trim() ?? "";
    }
    catch (err) {
        if (err?.code === "ENOENT") {
            return "";
        }
        throw err;
    }
}
