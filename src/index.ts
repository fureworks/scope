#!/usr/bin/env node

import { Command } from "commander";
import { todayCommand } from "./cli/today.js";
import { switchCommand } from "./cli/switch.js";
import { contextCommand } from "./cli/context.js";
import { statusCommand } from "./cli/status.js";
import { onboardCommand } from "./cli/onboard.js";
import { registerConfigCommand } from "./cli/config.js";
import { reviewCommand } from "./cli/review.js";
import { notificationsCommand } from "./cli/notifications.js";
import { daemonCommand } from "./cli/daemon.js";
import { muteCommand, snoozeCommand } from "./cli/snooze.js";
import { planCommand } from "./cli/plan.js";
import { initCommand } from "./cli/init.js";
import { tuneCommand } from "./cli/tune.js";

const program = new Command();

program
  .name("scope")
  .description("Personal ops CLI — focus on what matters.")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize Scope (create ~/.scope/ and config)")
  .action(initCommand);

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
  .command("review")
  .description("End-of-day summary — what got done, what's carrying over")
  .option("--json", "Output as JSON")
  .action(reviewCommand);

// Config subcommands (repos, calendar, github, projects)
registerConfigCommand(program);

program
  .command("daemon <action>")
  .description("Manage background signal checks (start|stop|status)")
  .action(daemonCommand);

program
  .command("notifications")
  .description("View recent notifications")
  .option("--clear", "Clear all notifications")
  .option("--all", "Show all notifications (not just last 24h)")
  .action(notificationsCommand);

program
  .command("snooze <item>")
  .description("Snooze an item until a future date")
  .requiredOption(
    "--until <date>",
    "Until date: tomorrow, monday..sunday, 3d, 1w, or YYYY-MM-DD"
  )
  .action(snoozeCommand);

program
  .command("mute [item]")
  .description("Mute an item permanently, list mutes, or clear an item")
  .option("--list", "Show muted and snoozed items")
  .option("--clear <item-id>", "Remove an item from muted/snoozed")
  .action(muteCommand);

program
  .command("tune [key] [value]")
  .description("View or adjust scoring weights")
  .option("--show", "Display current weights")
  .option("--reset", "Reset weights to defaults")
  .option("--config", "Open config in $EDITOR")
  .action(tuneCommand);

program
  .command("plan")
  .description("Weekly planning view")
  .option("--no-calendar", "Skip calendar data")
  .option("--json", "Output as JSON")
  .action(planCommand);

program.parse();
