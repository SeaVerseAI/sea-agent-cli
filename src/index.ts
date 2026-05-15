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

const program = new Command();

program
  .name("seaagent")
  .description("CLI for agent-gateway")
  .version("0.1.0")
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

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
