#!/usr/bin/env node
import { Command } from "commander";
import { agentCommand } from "./commands/agent.js";
import { catalogCommand } from "./commands/catalog.js";
import { chatCommand } from "./commands/chat.js";
import { configCommand } from "./commands/config.js";
import { gameCommand, sandboxCommand } from "./commands/game.js";
import { hookCommand } from "./commands/hook.js";
import { skillCommand } from "./commands/skill.js";
import { systemCommand } from "./commands/system.js";
import { toolCommand } from "./commands/tool.js";
import { addHelpText } from "./lib/help.js";

const program = new Command();

program
  .name("seaagent")
  .description("CLI for agent-gateway registration, discovery, chat, hooks, and sandbox runs")
  .version("0.1.0")
  .showHelpAfterError()
  .showSuggestionAfterError()
  .addCommand(configCommand())
  .addCommand(systemCommand())
  .addCommand(catalogCommand())
  .addCommand(toolCommand())
  .addCommand(skillCommand())
  .addCommand(agentCommand())
  .addCommand(hookCommand())
  .addCommand(sandboxCommand())
  .addCommand(gameCommand())
  .addCommand(chatCommand());

addHelpText(program, `
Configuration:
  seaagent stores connection settings in ~/.seaagent/config.yaml.
  The endpoint may be a gateway base URL or a URL that already includes /agent-v2.
  If /agent-v2 is missing, requests add it automatically.
  Configure endpoint and credentials before calling gateway-backed commands:
    seaagent config set endpoint http://127.0.0.1:8080
    seaagent config set api-key sa-xxxxxxxx
    seaagent config set user-id production-line-123

Common workflows:
  Discover reusable capabilities:
    seaagent catalog list --capability-type skill --status active
    seaagent tool list --search image --status active

  Register resources from JSON/YAML payload files:
    seaagent tool register -f examples/tool-web-fetch.json
    seaagent skill register -f examples/skill-web.json
    seaagent agent register -f examples/agent-web.json

  Run chat with a registered agent or inline runtime config:
    seaagent chat run <agent-id> "hello"
    seaagent chat run --agent-config-file examples/runtime-agent-config.json "Fetch https://example.com"

  Manage sandbox runs:
    seaagent sandbox create --prompt "Create a small React game" --sandbox-template react-game --preview-port 3000
    seaagent sandbox stream <sandbox-run-id>

Output:
  List commands print compact tables. Get/register/update commands print JSON.
  Set SEAAGENT_DEBUG=1 to print HTTP and WebSocket requests.

More help:
  seaagent <command> --help
  seaagent <command> <subcommand> --help
`);

const argv = process.argv.map((arg) => (arg === "-help" ? "--help" : arg));

program.parseAsync(argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
