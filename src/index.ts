#!/usr/bin/env node

import { Command } from "commander";
import { todayCommand } from "./cli/today.js";
import { switchCommand } from "./cli/switch.js";
import { contextCommand } from "./cli/context.js";
import { statusCommand } from "./cli/status.js";
import { onboardCommand } from "./cli/onboard.js";
import { configCommand } from "./cli/config.js";

const program = new Command();

program
  .name("scope")
  .description("Personal ops CLI — focus on what matters.")
  .version("0.1.0");

program
  .command("today")
  .description("What needs your attention right now")
  .option("--no-calendar", "Skip calendar data")
  .option("--json", "Output as JSON")
  .action(todayCommand);

program
  .command("onboard")
  .description("Guided first-time setup")
  .action(onboardCommand);

program
  .command("switch <project>")
  .description("Switch to a project context")
  .action(switchCommand);

program
  .command("context")
  .description("Show current project context")
  .option("--edit", "Open scratchpad in $EDITOR")
  .action(contextCommand);

program
  .command("status")
  .description("Overview of all watched projects")
  .option("--json", "Output as JSON")
  .action(statusCommand);

program
  .command("config [key] [value]")
  .description("View or edit configuration")
  .action(configCommand);

program.parse();
