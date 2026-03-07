import chalk from "chalk";
import { loadConfig, saveConfig, DEFAULT_WEIGHTS, ScoringWeights } from "../store/config.js";

interface TuneOptions {
  show?: boolean;
  reset?: boolean;
  config?: boolean;
}

const VALID_KEYS = ["staleness", "blocking", "timePressure", "effort"] as const;

export async function tuneCommand(
  key: string | undefined,
  value: string | undefined,
  options: TuneOptions
): Promise<void> {
  const config = loadConfig();

  if (options.show || (!key && !options.reset && !options.config)) {
    console.log("");
    console.log(chalk.bold("  Scoring Weights"));
    console.log(chalk.dim("  ───────────────"));
    for (const [k, v] of Object.entries(config.weights)) {
      const isDefault = v === DEFAULT_WEIGHTS[k as keyof ScoringWeights];
      const label = isDefault ? chalk.dim("(default)") : chalk.yellow("(custom)");
      console.log(`  ${k}: ${v} ${label}`);
    }
    console.log("");
    console.log(chalk.dim("  Multipliers on raw scores. 1.0 = default. Higher = more priority."));
    console.log(chalk.dim("  Example: scope tune staleness 1.5 → stale items rank higher\n"));
    return;
  }

  if (options.reset) {
    config.weights = { ...DEFAULT_WEIGHTS };
    saveConfig(config);
    console.log("  ✓ Weights reset to defaults.\n");
    return;
  }

  if (options.config) {
    const editor = process.env.EDITOR || process.env.VISUAL || "vi";
    const { execSync } = await import("node:child_process");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const configPath = join(homedir(), ".scope", "config.toml");
    try {
      execSync(`${editor} ${configPath}`, { stdio: "inherit" });
      console.log("  ✓ Config saved.\n");
    } catch {
      console.log(chalk.red("  Failed to open editor.\n"));
    }
    return;
  }

  if (key && value) {
    if (!VALID_KEYS.includes(key as typeof VALID_KEYS[number])) {
      console.log(chalk.red(`  Unknown weight: ${key}`));
      console.log(chalk.dim(`  Valid keys: ${VALID_KEYS.join(", ")}\n`));
      process.exit(1);
    }

    const num = parseFloat(value);
    if (isNaN(num) || num < 0 || num > 10) {
      console.log(chalk.red(`  Invalid value: ${value}. Must be 0-10.\n`));
      process.exit(1);
    }

    config.weights[key as keyof ScoringWeights] = num;
    saveConfig(config);
    console.log(`  ✓ ${key} set to ${num}\n`);
    return;
  }

  if (key && !value) {
    console.log(chalk.red(`  Missing value. Usage: scope tune ${key} <number>\n`));
    process.exit(1);
  }
}
