import chalk from "chalk";
import { loadConfig, configExists } from "../store/config.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export async function configCommand(
  key?: string,
  value?: string
): Promise<void> {
  if (!configExists()) {
    console.log(
      chalk.yellow("\n  No config found. Run `scope onboard` to get started.\n")
    );
    return;
  }

  // If no args, show config file contents
  if (!key) {
    const configPath = join(homedir(), ".scope", "config.toml");
    try {
      const content = readFileSync(configPath, "utf-8");
      console.log("");
      console.log(chalk.bold("  ~/.scope/config.toml"));
      console.log(chalk.dim("  ─────────────────────\n"));
      console.log(
        content
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")
      );
      console.log("");
    } catch {
      console.log(chalk.yellow("\n  Could not read config file.\n"));
    }
    return;
  }

  // Subcommands
  switch (key) {
    case "git":
      console.log(chalk.dim("\n  To manage repos, edit ~/.scope/config.toml"));
      console.log(chalk.dim("  or re-run: scope onboard\n"));
      break;
    case "calendar":
      console.log(
        chalk.dim("\n  To set up calendar, install gws:")
      );
      console.log(
        chalk.dim("  npm install -g @googleworkspace/cli")
      );
      console.log(chalk.dim("  Then re-run: scope onboard\n"));
      break;
    case "projects":
      const config = loadConfig();
      console.log(chalk.bold("\n  Projects:"));
      for (const [name, project] of Object.entries(config.projects)) {
        console.log(`  ${name} → ${project.path}`);
      }
      console.log(chalk.dim("\n  Edit: ~/.scope/config.toml\n"));
      break;
    default:
      console.log(chalk.yellow(`\n  Unknown config key: ${key}`));
      console.log(chalk.dim("  Available: git, calendar, projects\n"));
  }
}
