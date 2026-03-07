import chalk from "chalk";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { homedir } from "node:os";
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

function findGitRepos(): { path: string; name: string }[] {
  const home = homedir();
  const repos: { path: string; name: string }[] = [];

  // Common directories where developers keep repos
  const searchDirs = [
    join(home, "projects"),
    join(home, "Projects"),
    join(home, "repos"),
    join(home, "Repos"),
    join(home, "src"),
    join(home, "code"),
    join(home, "Code"),
    join(home, "dev"),
    join(home, "Dev"),
    join(home, "work"),
    join(home, "Work"),
    join(home, "Personal"),
    join(home, "personal"),
    join(home, "github"),
    join(home, "GitHub"),
    join(home, "Desktop"),
    join(home, "Documents"),
  ];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;

    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          if (
            statSync(fullPath).isDirectory() &&
            existsSync(join(fullPath, ".git"))
          ) {
            repos.push({ path: fullPath, name: entry });
          }
        } catch {
          // Skip permission errors
        }
      }
    } catch {
      // Skip inaccessible dirs
    }
  }

  // Dedupe by path
  const seen = new Set<string>();
  return repos.filter((r) => {
    if (seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });
}

function askSelection(
  rl: ReturnType<typeof createInterface>,
  question: string,
  options: { label: string; value: string }[]
): Promise<string[]> {
  return new Promise((resolvePromise) => {
    const selected = new Set<number>();

    console.log(question);
    options.forEach((opt, i) => {
      console.log(chalk.dim(`    ${i + 1}) ${opt.label}`));
    });
    console.log(
      chalk.dim(
        `\n    Enter numbers separated by commas (e.g. 1,3,5), 'all' for everything, or 'none' to skip`
      )
    );

    rl.question("  ? Select: ", (answer) => {
      const trimmed = answer.trim().toLowerCase();

      if (trimmed === "all") {
        resolvePromise(options.map((o) => o.value));
        return;
      }

      if (trimmed === "none" || trimmed === "") {
        resolvePromise([]);
        return;
      }

      const indices = trimmed
        .split(",")
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((i) => i >= 0 && i < options.length);

      resolvePromise(indices.map((i) => options[i].value));
    });
  });
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
  console.log(chalk.dim("  Scanning for repos...\n"));

  const foundRepos = findGitRepos();

  if (foundRepos.length > 0) {
    console.log(
      chalk.green(`  Found ${foundRepos.length} repo${foundRepos.length !== 1 ? "s" : ""}:\n`)
    );

    const selectedPaths = await askSelection(
      rl,
      "",
      foundRepos.map((r) => ({
        label: `${r.name} ${chalk.dim(`(${r.path})`)}`,
        value: r.path,
      }))
    );

    config.repos.push(...selectedPaths);

    if (selectedPaths.length > 0) {
      console.log(
        chalk.green(`\n  ✓ Added ${selectedPaths.length} repo${selectedPaths.length !== 1 ? "s" : ""}`)
      );
    }
  } else {
    console.log(chalk.dim("  No repos found in common directories."));
  }

  // Allow adding more manually
  console.log("");
  let addingMore = true;
  while (addingMore) {
    const repoPath = await ask(
      rl,
      "  ? Add another repo path (or 'done'): "
    );

    if (repoPath.toLowerCase() === "done" || repoPath === "") {
      addingMore = false;
    } else if (repoPath.startsWith("http://") || repoPath.startsWith("https://") || repoPath.startsWith("git@")) {
      console.log(chalk.yellow(`    ✗ Scope needs local paths, not URLs.`));
      console.log(chalk.dim(`      Clone it first, then add the local path`));
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
