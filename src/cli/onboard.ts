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

  // Scan all top-level directories in home for git repos (1-2 levels deep)
  const searchRoots: string[] = [home];

  // Collect all immediate subdirectories of home as potential search roots
  try {
    const homeEntries = readdirSync(home);
    for (const entry of homeEntries) {
      if (entry.startsWith(".")) continue; // Skip dotfiles/dirs
      const fullPath = join(home, entry);
      try {
        if (statSync(fullPath).isDirectory()) {
          // Check if this dir itself is a repo
          if (existsSync(join(fullPath, ".git"))) {
            repos.push({ path: fullPath, name: entry });
          } else {
            // Search one level deeper inside this directory
            searchRoots.push(fullPath);
          }
        }
      } catch {
        // Skip permission errors
      }
    }
  } catch {
    // Skip if home is inaccessible
  }

  // Scan each search root (one level deep)
  for (const dir of searchRoots) {
    if (dir === home) continue; // Already scanned top-level
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const fullPath = join(dir, entry);
        try {
          if (
            statSync(fullPath).isDirectory() &&
            existsSync(join(fullPath, ".git"))
          ) {
            repos.push({ path: fullPath, name: `${basename(dir)}/${entry}` });
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

  // Only ask for manual paths if no repos were found automatically
  if (foundRepos.length === 0) {
    console.log("");
    let addingMore = true;
    while (addingMore) {
      const input = await ask(
        rl,
        "  ? Add a repo path (or 'done'): "
      );

      if (input.toLowerCase() === "done" || input === "") {
        addingMore = false;
      } else if (input.startsWith("http://") || input.startsWith("https://") || input.startsWith("git@")) {
        console.log(chalk.yellow(`    ✗ Scope needs local paths, not URLs.`));
        console.log(chalk.dim(`      Clone it first, then add the local path`));
      } else {
        const resolved = resolve(input.replace(/^~/, process.env.HOME || "~"));
        if (existsSync(resolved)) {
          config.repos.push(resolved);
          console.log(chalk.green(`    ✓ Added ${resolved}`));
        } else {
          console.log(chalk.yellow(`    ✗ Path not found: ${resolved}`));
        }
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

  // Step 4: Projects — group repos under names
  console.log(chalk.bold("  Step 4/4: Projects"));
  console.log(chalk.dim("  ─────────────────────"));
  console.log(chalk.dim("  Projects group your repos for context switching."));
  console.log(chalk.dim("  e.g. 'wtl' = your work repos, 'personal' = side projects\n"));

  if (config.repos.length > 0) {
    let assigningProjects = true;
    const unassigned = [...config.repos];

    while (assigningProjects && unassigned.length > 0) {
      const projectName = await ask(rl, "  ? Project name (or 'done'): ");
      
      if (projectName.toLowerCase() === "done" || projectName === "") {
        assigningProjects = false;
        continue;
      }

      console.log(chalk.dim("\n    Which repos belong to this project?\n"));
      unassigned.forEach((r, i) => {
        const name = r.split("/").slice(-2).join("/");
        console.log(chalk.dim(`    ${i + 1}) ${name}`));
      });
      console.log(chalk.dim(`\n    Enter numbers (e.g. 1,3,5), 'all', or 'none'`));

      const pick = await ask(rl, "  ? Select: ");
      const trimmed = pick.trim().toLowerCase();
      
      let selectedPaths: string[] = [];
      if (trimmed === "all") {
        selectedPaths = [...unassigned];
      } else if (trimmed === "none" || trimmed === "") {
        // skip
      } else {
        const indices = trimmed
          .split(",")
          .map((s) => parseInt(s.trim(), 10) - 1)
          .filter((i) => i >= 0 && i < unassigned.length);
        selectedPaths = indices.map((i) => unassigned[i]);
      }

      if (selectedPaths.length > 0) {
        config.projects[projectName] = { path: selectedPaths[0], repos: selectedPaths };
        // Remove assigned repos from unassigned
        for (const p of selectedPaths) {
          const idx = unassigned.indexOf(p);
          if (idx !== -1) unassigned.splice(idx, 1);
        }
        console.log(
          chalk.green(`\n  ✓ Project "${projectName}" — ${selectedPaths.length} repo${selectedPaths.length !== 1 ? "s" : ""}\n`)
        );
      }

      if (unassigned.length > 0) {
        console.log(chalk.dim(`  ${unassigned.length} repo${unassigned.length !== 1 ? "s" : ""} unassigned. Add another project or 'done'.\n`));
      }
    }
  } else {
    console.log(chalk.dim("  No repos to group. Add projects later with 'scope config projects'\n"));
  }

  // Save
  ensureScopeDir();
  saveConfig(config);

  console.log(chalk.dim("  ─────────────────────"));
  console.log(chalk.bold.green("  Setup complete!"));
  console.log(chalk.dim(`  Config saved to ~/.scope/config.toml\n`));
  console.log(`  Try: ${chalk.bold("scope today")}`);
  console.log(chalk.dim(`\n  Tip: run 'npm link' in this directory to use 'scope' globally\n`));

  rl.close();
}
