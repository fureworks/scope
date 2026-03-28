import chalk from "chalk";
import { loadConfig, configExists } from "../store/config.js";
import { scanAllRepos } from "../sources/git.js";

interface CleanOptions {
  json?: boolean;
  dryRun?: boolean;
}

export async function cleanCommand(options: CleanOptions): Promise<void> {
  if (!configExists()) {
    console.log(
      chalk.yellow("  Scope isn't set up yet. Run `scope onboard` to get started.\n")
    );
    process.exit(1);
  }

  const config = loadConfig();

  if (config.repos.length === 0) {
    console.log(
      chalk.yellow("  No repos configured. Run `scope config repos add` to add some.\n")
    );
    process.exit(1);
  }

  const signals = await scanAllRepos(config.repos);

  const stale: Array<{ repo: string; branch: string }> = [];

  for (const signal of signals) {
    for (const branch of signal.staleBranches) {
      stale.push({ repo: signal.repo, branch });
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ stale }, null, 2));
    return;
  }

  console.log("");

  if (stale.length === 0) {
    console.log(chalk.green("  ✓ No stale branches found. Repos are clean.\n"));
    return;
  }

  console.log(chalk.bold("  STALE BRANCHES"));
  console.log(chalk.dim("  ──────────────"));

  const byRepo = new Map<string, string[]>();
  for (const { repo, branch } of stale) {
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo)!.push(branch);
  }

  for (const [repo, branches] of byRepo) {
    console.log(`\n  ${chalk.bold(repo)}`);
    for (const branch of branches) {
      console.log(chalk.dim(`    ✗ ${branch}`));
    }
  }

  console.log(
    chalk.dim(`\n  ${stale.length} stale branch${stale.length > 1 ? "es" : ""} across ${byRepo.size} repo${byRepo.size > 1 ? "s" : ""}.`)
  );

  if (!options.dryRun) {
    console.log(
      chalk.dim("  To delete: git branch -d <branch> (in each repo)\n")
    );
  }
}
