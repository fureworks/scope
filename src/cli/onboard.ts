import chalk from "chalk";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ScopeConfig, saveConfig, ensureScopeDir } from "../store/config.js";

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function checkCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export async function onboardCommand(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("");
  console.log(chalk.bold("  Welcome to Scope — let's get you set up.\n"));

  const config: ScopeConfig = {
    repos: [],
    projects: {},
    calendar: { enabled: false, backend: "gws" },
  };

  // Step 1: Git repos
  console.log(chalk.bold("  Step 1/4: Git repos"));
  console.log(chalk.dim("  ─────────────────────"));

  let addingRepos = true;
  while (addingRepos) {
    const repoPath = await ask(
      rl,
      "  ? Add a repo path (or 'done' to continue): "
    );

    if (repoPath.toLowerCase() === "done" || repoPath === "") {
      addingRepos = false;
    } else {
      const resolved = resolve(repoPath.replace(/^~/, process.env.HOME || "~"));
      if (existsSync(resolved)) {
        config.repos.push(resolved);
        console.log(chalk.green(`    ✓ Added ${resolved}`));
      } else {
        console.log(chalk.yellow(`    ✗ Path not found: ${resolved}`));
      }
    }
  }

  console.log(
    chalk.green(`\n  ✓ Watching ${config.repos.length} repo${config.repos.length !== 1 ? "s" : ""}\n`)
  );

  // Step 2: GitHub CLI
  console.log(chalk.bold("  Step 2/4: GitHub CLI"));
  console.log(chalk.dim("  ─────────────────────"));

  const hasGh = checkCommand("gh");
  if (hasGh) {
    console.log(chalk.green("  Checking for gh CLI... ✓ Found"));
    try {
      const authStatus = execSync("gh auth status 2>&1", {
        encoding: "utf-8",
      });
      if (authStatus.includes("Logged in")) {
        console.log(chalk.green("  Checking auth... ✓ Logged in"));
      } else {
        console.log(
          chalk.yellow("  Checking auth... ✗ Not authenticated")
        );
        console.log(chalk.dim("  Run 'gh auth login' to enable PR data\n"));
      }
    } catch {
      console.log(chalk.yellow("  Checking auth... ✗ Not authenticated"));
      console.log(chalk.dim("  Run 'gh auth login' to enable PR data\n"));
    }
  } else {
    console.log(chalk.yellow("  gh CLI not found — PR data will be skipped"));
    console.log(chalk.dim("  Install: https://cli.github.com/\n"));
  }

  console.log(chalk.green("  ✓ GitHub PR data " + (hasGh ? "available" : "skipped") + "\n"));

  // Step 3: Google Calendar
  console.log(chalk.bold("  Step 3/4: Google Calendar (optional)"));
  console.log(chalk.dim("  ─────────────────────"));

  const hasGws = checkCommand("gws");
  if (hasGws) {
    console.log(chalk.green("  Checking for gws CLI... ✓ Found"));
    const enableCal = await ask(
      rl,
      "  ? Enable calendar integration? (Y/n): "
    );
    if (enableCal.toLowerCase() !== "n") {
      config.calendar.enabled = true;
      console.log(chalk.green("\n  ✓ Calendar enabled\n"));
    } else {
      console.log(chalk.dim("\n  Calendar skipped. Enable later with 'scope config calendar'\n"));
    }
  } else {
    console.log(chalk.yellow("  gws CLI not found — calendar will be skipped"));
    console.log(chalk.dim("  Install: npm install -g @googleworkspace/cli"));
    console.log(chalk.dim("  Enable later with 'scope config calendar'\n"));
  }

  // Step 4: First project
  console.log(chalk.bold("  Step 4/4: Projects"));
  console.log(chalk.dim("  ─────────────────────"));

  const projectName = await ask(rl, "  ? Name your first project: ");
  if (projectName) {
    const projectPath = await ask(
      rl,
      `  ? Working directory for '${projectName}': `
    );
    const resolvedPath = resolve(
      (projectPath || ".").replace(/^~/, process.env.HOME || "~")
    );
    config.projects[projectName] = { path: resolvedPath };
    console.log(
      chalk.green(`\n  ✓ Project "${projectName}" created\n`)
    );
  }

  // Save
  ensureScopeDir();
  saveConfig(config);

  console.log(chalk.dim("  ─────────────────────"));
  console.log(chalk.bold.green("  Setup complete!"));
  console.log(chalk.dim(`  Config saved to ~/.scope/config.toml\n`));
  console.log(`  Try: ${chalk.bold("scope today")}\n`);

  rl.close();
}
