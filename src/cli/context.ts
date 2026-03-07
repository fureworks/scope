import chalk from "chalk";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getScopeDir } from "../store/config.js";

interface ContextOptions {
  edit?: boolean;
}

export async function contextCommand(options: ContextOptions): Promise<void> {
  const contextsDir = join(getScopeDir(), "contexts");

  if (!existsSync(contextsDir)) {
    console.log(
      chalk.yellow("\n  No project contexts yet. Run `scope switch <project>` first.\n")
    );
    return;
  }

  // Find the most recently switched context
  const files = readdirSync(contextsDir).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.log(
      chalk.yellow("\n  No project contexts yet. Run `scope switch <project>` first.\n")
    );
    return;
  }

  let latest: { name: string; data: Record<string, unknown>; time: number } | null = null;

  for (const file of files) {
    try {
      const data = JSON.parse(
        readFileSync(join(contextsDir, file), "utf-8")
      );
      const time = new Date(data.lastSwitchedAt || 0).getTime();
      if (!latest || time > latest.time) {
        latest = { name: data.name, data, time };
      }
    } catch {
      // Skip corrupt files
    }
  }

  if (!latest) {
    console.log(
      chalk.yellow("\n  No valid contexts found.\n")
    );
    return;
  }

  const ctx = latest.data as {
    name: string;
    path: string;
    branch: string;
    lastSwitchedAt: string;
    notes: string;
  };

  if (options.edit) {
    const editor = process.env.EDITOR || "vi";
    const { execSync } = await import("node:child_process");
    const notesPath = join(contextsDir, `${ctx.name}.md`);

    // Create notes file if it doesn't exist
    if (!existsSync(notesPath)) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(notesPath, `# ${ctx.name}\n\n`, "utf-8");
    }

    execSync(`${editor} ${notesPath}`, { stdio: "inherit" });
    return;
  }

  console.log("");
  console.log(chalk.bold(`  Current: ${ctx.name}`));
  console.log(chalk.dim(`  ─────────────────────`));
  console.log(`  📁 ${ctx.path}`);
  console.log(`  🌿 ${ctx.branch}`);

  if (ctx.lastSwitchedAt) {
    const ago = Math.round(
      (Date.now() - new Date(ctx.lastSwitchedAt).getTime()) / (1000 * 60 * 60)
    );
    if (ago < 1) {
      console.log(chalk.dim(`  Switched: just now`));
    } else {
      console.log(chalk.dim(`  Switched: ${ago}h ago`));
    }
  }

  if (ctx.notes) {
    console.log(`\n  📝 ${ctx.notes}`);
  }

  // Show other projects
  if (files.length > 1) {
    console.log(chalk.dim(`\n  Other projects:`));
    for (const file of files) {
      const name = file.replace(".json", "");
      if (name !== ctx.name) {
        console.log(chalk.dim(`    scope switch ${name}`));
      }
    }
  }

  console.log("");
}
