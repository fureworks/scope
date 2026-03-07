import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, getScopeDir } from "../store/config.js";
import { simpleGit } from "simple-git";

interface ProjectContext {
  name: string;
  path: string;
  branch: string;
  lastSwitchedAt: string;
  notes: string;
}

function getContextPath(projectName: string): string {
  return join(getScopeDir(), "contexts", `${projectName}.json`);
}

function loadContext(projectName: string): ProjectContext | null {
  const contextPath = getContextPath(projectName);
  if (!existsSync(contextPath)) return null;
  try {
    return JSON.parse(readFileSync(contextPath, "utf-8"));
  } catch {
    return null;
  }
}

function saveContext(context: ProjectContext): void {
  const dir = join(getScopeDir(), "contexts");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getContextPath(context.name), JSON.stringify(context, null, 2));
}

export async function switchCommand(project: string): Promise<void> {
  const config = loadConfig();

  const projectConfig = config.projects[project];
  if (!projectConfig) {
    console.log(
      chalk.yellow(`\n  Project "${project}" not found.\n`)
    );
    console.log(chalk.dim("  Available projects:"));
    for (const name of Object.keys(config.projects)) {
      console.log(chalk.dim(`    - ${name}`));
    }
    console.log(chalk.dim(`\n  Add with: scope config projects\n`));
    return;
  }

  // Save current context if we can detect one
  // (We save the project we're switching FROM)

  // Load target context
  const existingContext = loadContext(project);

  // Get current git branch for the target project
  let branch = "unknown";
  try {
    const git = simpleGit(projectConfig.path);
    const branchInfo = await git.branch();
    branch = branchInfo.current;
  } catch {
    // Not a git repo or error
  }

  // Save/update context
  const context: ProjectContext = {
    name: project,
    path: projectConfig.path,
    branch,
    lastSwitchedAt: new Date().toISOString(),
    notes: existingContext?.notes || "",
  };
  saveContext(context);

  console.log("");
  console.log(chalk.bold(`  Switched to: ${project}`));
  console.log(chalk.dim(`  ─────────────────────`));
  console.log(`  📁 ${projectConfig.path}`);
  console.log(`  🌿 ${branch}`);
  if (existingContext?.notes) {
    console.log(`  📝 ${existingContext.notes}`);
  }
  if (existingContext?.lastSwitchedAt) {
    const last = new Date(existingContext.lastSwitchedAt);
    const ago = Math.round((Date.now() - last.getTime()) / (1000 * 60 * 60));
    console.log(chalk.dim(`  Last here: ${ago}h ago`));
  }
  console.log("");
  console.log(chalk.dim(`  cd ${projectConfig.path}`));
  console.log("");
}
