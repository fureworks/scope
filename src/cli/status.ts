import chalk from "chalk";
import { loadConfig, configExists } from "../store/config.js";
import { scanAllRepos } from "../sources/git.js";

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  if (!configExists()) {
    console.log(
      chalk.yellow("  Scope isn't set up yet. Run `scope onboard` to get started.\n")
    );
    return;
  }

  const config = loadConfig();
  const gitSignals = await scanAllRepos(config.repos);

  if (options.json) {
    console.log(JSON.stringify({ repos: gitSignals, config }, null, 2));
    return;
  }

  console.log("");
  console.log(chalk.bold("  Scope Status"));
  console.log(chalk.dim("  ─────────────────────\n"));

  // Repos
  console.log(chalk.bold("  Repos"));
  if (gitSignals.length === 0) {
    console.log(chalk.dim("  No repos configured or accessible.\n"));
  } else {
    for (const signal of gitSignals) {
      const status: string[] = [];
      if (signal.uncommittedFiles > 0) {
        status.push(
          chalk.yellow(`${signal.uncommittedFiles} uncommitted`)
        );
      }
      if (signal.openPRs.length > 0) {
        status.push(chalk.blue(`${signal.openPRs.length} PRs`));
      }
      if (signal.staleBranches.length > 0) {
        status.push(
          chalk.dim(`${signal.staleBranches.length} stale branches`)
        );
      }
      if (status.length === 0) {
        status.push(chalk.green("clean"));
      }

      console.log(
        `  ${signal.repo} ${chalk.dim(`(${signal.branch})`)} — ${status.join(", ")}`
      );
    }
    console.log("");
  }

  // Projects
  const projectNames = Object.keys(config.projects);
  if (projectNames.length > 0) {
    console.log(chalk.bold("  Projects"));
    for (const name of projectNames) {
      const p = config.projects[name];
      console.log(`  ${name} ${chalk.dim(`→ ${p.path}`)}`);
    }
    console.log("");
  }

  // Calendar
  console.log(chalk.bold("  Integrations"));
  console.log(
    `  Calendar: ${config.calendar.enabled ? chalk.green("enabled") : chalk.dim("disabled")}`
  );
  console.log("");
}
