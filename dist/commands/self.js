import { Command } from "commander";
import { getCliUpdateStatus, updateCliPackage } from "../lib/cli-update.js";
import { addHelpText } from "../lib/help.js";
import { printJSON } from "../lib/output.js";
import { getSkillUpdateStatus, updateLocalSkill } from "../lib/self-update.js";
export function selfCommand() {
    const cmd = addHelpText(new Command("self").description("Check and update local CLI package and support files"), `
Self commands check this installed CLI package and bundled local support files.
Automatic CLI update checks run at most daily and only print update notices to stderr.
Automatic skill checks run at most every 2 hours and only print update notices to stderr.

Examples:
  seaagent self check-update
  seaagent self update
  seaagent self check
  seaagent self update-skill
`);
    cmd
        .command("check-update")
        .description("Check whether a newer seaagent CLI is available on GitHub")
        .action(async () => {
        printJSON(await getCliUpdateStatus());
    });
    cmd
        .command("update")
        .description("Update this CLI from GitHub after verifying the package")
        .action(async () => {
        const status = await getCliUpdateStatus();
        if (status.status === "up-to-date") {
            printJSON({
                updated: false,
                reason: "already up to date",
                localCommit: status.localCommit,
                remoteCommit: status.remoteCommit,
                installSpec: status.installSpec,
            });
            return;
        }
        process.stderr.write(`Running verified update from ${status.installSpec}\n`);
        printJSON(await updateCliPackage());
    });
    cmd
        .command("check")
        .description("Check local seaagent-cli skill freshness")
        .action(async () => {
        printJSON(await getSkillUpdateStatus());
    });
    cmd
        .command("update-skill")
        .description("Install bundled seaagent-cli skill into ~/.codex/skills")
        .action(async () => {
        const status = await updateLocalSkill();
        printJSON({
            updated: status.upToDate,
            skill: status.skill,
            version: status.bundledVersion,
            path: status.localPath,
            hash: status.localHash,
        });
    });
    return cmd;
}
