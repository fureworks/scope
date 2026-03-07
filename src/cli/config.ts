import { execSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { ScopeConfig, configExists, loadConfig, saveConfig } from "../store/config.js";

type JsonOptions = {
  json?: boolean;
  dir?: string;
};

function output(json: boolean, payload: unknown, text: string): void {
  if (json) {
    console.log(JSON.stringify(payload));
    return;
  }
  console.log(text);
}

function fail(json: boolean, message: string, payload?: unknown): void {
  if (json) {
    console.log(
      JSON.stringify({
        ok: false,
        error: message,
        ...(payload && typeof payload === "object" ? payload : {}),
      })
    );
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}

function expandPath(input: string): string {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return join(homedir(), input.slice(2));
  }
  return input;
}

function toAbsolutePath(input: string): string {
  const expanded = expandPath(input);
  return isAbsolute(expanded) ? expanded : resolve(expanded);
}

function parseScalar(value: string): string | boolean | number {
  if (value === "true") return true;
  if (value === "false") return false;
  const parsedNumber = Number(value);
  if (!Number.isNaN(parsedNumber) && value.trim() !== "") {
    return parsedNumber;
  }
  return value;
}

function setConfigValue(config: ScopeConfig, key: string, value: string): boolean {
  const parts = key.split(".").filter(Boolean);
  if (parts.length === 0) {
    return false;
  }

  const parsedValue = parseScalar(value);
  let cursor: Record<string, unknown> = config as unknown as Record<string, unknown>;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const existing = cursor[part];
    if (!existing || typeof existing !== "object") {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]] = parsedValue;
  return true;
}

function runCommand(command: string): { ok: boolean; output: string } {
  try {
    const stdout = execSync(command, { stdio: "pipe", encoding: "utf8" });
    return { ok: true, output: stdout.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message.trim() };
  }
}

function collectGitRepos(rootDir: string): string[] {
  const repos = new Set<string>();
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stats;
      try {
        stats = lstatSync(fullPath);
      } catch {
        continue;
      }

      if (stats.isSymbolicLink()) {
        continue;
      }

      if (entry === ".git" && stats.isDirectory()) {
        repos.add(current);
        continue;
      }

      if (stats.isDirectory() && entry !== ".git") {
        queue.push(fullPath);
      }
    }
  }

  return [...repos];
}

export async function configCommand(
  key?: string,
  value?: string,
  options: JsonOptions = {}
): Promise<void> {
  const json = Boolean(options.json);

  if (!key) {
    if (json) {
      output(true, { ok: true, config: loadConfig() }, "");
      return;
    }

    if (!configExists()) {
      console.log("No config found");
      return;
    }

    const configPath = join(homedir(), ".scope", "config.toml");
    try {
      const content = readFileSync(configPath, "utf-8").trimEnd();
      console.log(content);
    } catch {
      fail(false, "Could not read config file");
    }
    return;
  }

  if (value === undefined) {
    const config = loadConfig();
    const parts = key.split(".").filter(Boolean);
    let cursor: unknown = config;
    for (const part of parts) {
      if (!cursor || typeof cursor !== "object" || !(part in cursor)) {
        fail(json, `Unknown config key: ${key}`);
        return;
      }
      cursor = (cursor as Record<string, unknown>)[part];
    }
    output(json, { ok: true, key, value: cursor }, `${key}=${String(cursor)}`);
    return;
  }

  const config = loadConfig();
  const updated = setConfigValue(config, key, value);
  if (!updated) {
    fail(json, `Invalid config key: ${key}`);
    return;
  }
  saveConfig(config);
  output(json, { ok: true, key, value: parseScalar(value) }, "Config updated");
}

async function reposAdd(paths: string[], options: JsonOptions): Promise<void> {
  const json = Boolean(options.json);
  const config = loadConfig();
  const existing = new Set(config.repos);
  const added: string[] = [];
  const invalid: string[] = [];

  for (const rawPath of paths) {
    const absolutePath = toAbsolutePath(rawPath);
    if (!existsSync(absolutePath)) {
      invalid.push(absolutePath);
      continue;
    }

    let isDirectory = false;
    try {
      isDirectory = statSync(absolutePath).isDirectory();
    } catch {
      invalid.push(absolutePath);
      continue;
    }

    if (!isDirectory) {
      invalid.push(absolutePath);
      continue;
    }

    if (!existing.has(absolutePath)) {
      existing.add(absolutePath);
      added.push(absolutePath);
    }
  }

  if (invalid.length > 0) {
    fail(json, `Invalid repo path(s): ${invalid.join(", ")}`, { invalid });
    return;
  }

  if (added.length > 0) {
    config.repos = [...existing];
    saveConfig(config);
  }

  output(
    json,
    { ok: true, added, total: existing.size },
    added.length > 0 ? `Added ${added.length} repo(s)` : "No changes"
  );
}

async function reposRemove(path: string, options: JsonOptions): Promise<void> {
  const json = Boolean(options.json);
  const absolutePath = toAbsolutePath(path);
  const config = loadConfig();
  const before = config.repos.length;
  config.repos = config.repos.filter((repoPath) => repoPath !== absolutePath);

  if (config.repos.length !== before) {
    saveConfig(config);
  }

  output(
    json,
    {
      ok: true,
      removed: before !== config.repos.length ? absolutePath : null,
      total: config.repos.length,
    },
    before !== config.repos.length ? "Repo removed" : "No changes"
  );
}

async function reposList(options: JsonOptions): Promise<void> {
  const json = Boolean(options.json);
  const config = loadConfig();
  output(
    json,
    { ok: true, repos: config.repos },
    config.repos.length > 0 ? config.repos.join(", ") : "No repos configured"
  );
}

async function reposScan(directory: string, options: JsonOptions): Promise<void> {
  const json = Boolean(options.json);
  const absoluteDirectory = toAbsolutePath(directory);

  if (!existsSync(absoluteDirectory) || !statSync(absoluteDirectory).isDirectory()) {
    fail(json, `Directory not found: ${absoluteDirectory}`);
    return;
  }

  const found = collectGitRepos(absoluteDirectory);
  const config = loadConfig();
  const existing = new Set(config.repos);
  const added: string[] = [];

  for (const repoPath of found) {
    if (!existing.has(repoPath)) {
      existing.add(repoPath);
      added.push(repoPath);
    }
  }

  if (added.length > 0) {
    config.repos = [...existing];
    saveConfig(config);
  }

  output(
    json,
    { ok: true, scanned: absoluteDirectory, found, added, total: existing.size },
    added.length > 0 ? `Added ${added.length} repo(s)` : "No changes"
  );
}

async function calendarSet(enabled: boolean, options: JsonOptions): Promise<void> {
  const json = Boolean(options.json);
  const config = loadConfig();
  const changed = config.calendar.enabled !== enabled;
  config.calendar.enabled = enabled;
  if (changed) {
    saveConfig(config);
  }
  output(
    json,
    { ok: true, enabled },
    changed ? `Calendar ${enabled ? "enabled" : "disabled"}` : "No changes"
  );
}

async function calendarTest(options: JsonOptions): Promise<void> {
  const json = Boolean(options.json);
  const result = runCommand("gws --help");
  if (!result.ok) {
    fail(json, "Calendar test failed");
    return;
  }
  output(json, { ok: true, backend: "gws" }, "Calendar test passed");
}

async function githubTest(options: JsonOptions): Promise<void> {
  const json = Boolean(options.json);
  const result = runCommand("gh auth status");
  if (!result.ok) {
    fail(json, "GitHub test failed");
    return;
  }
  output(json, { ok: true }, "GitHub auth is valid");
}

async function projectsAdd(name: string, options: JsonOptions): Promise<void> {
  const json = Boolean(options.json);
  if (!options.dir) {
    fail(json, "--dir is required");
    return;
  }

  const absoluteDirectory = toAbsolutePath(options.dir);
  if (!existsSync(absoluteDirectory) || !statSync(absoluteDirectory).isDirectory()) {
    fail(json, `Directory not found: ${absoluteDirectory}`);
    return;
  }

  const config = loadConfig();
  const existing = config.projects[name];
  const changed = !existing || existing.path !== absoluteDirectory;
  config.projects[name] = { path: absoluteDirectory };

  if (changed) {
    saveConfig(config);
  }

  output(
    json,
    { ok: true, name, path: absoluteDirectory },
    changed ? "Project saved" : "No changes"
  );
}

async function projectsRemove(name: string, options: JsonOptions): Promise<void> {
  const json = Boolean(options.json);
  const config = loadConfig();
  if (config.projects[name]) {
    delete config.projects[name];
    saveConfig(config);
    output(json, { ok: true, removed: name }, "Project removed");
    return;
  }
  output(json, { ok: true, removed: null }, "No changes");
}

async function projectsList(options: JsonOptions): Promise<void> {
  const json = Boolean(options.json);
  const config = loadConfig();
  const projects = Object.entries(config.projects).map(([name, project]) => ({
    name,
    path: project.path,
  }));

  output(
    json,
    { ok: true, projects },
    projects.length > 0
      ? projects.map((project) => `${project.name}=${project.path}`).join(", ")
      : "No projects configured"
  );
}

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("View or edit configuration")
    .argument("[key]")
    .argument("[value]")
    .option("--json", "Output as JSON")
    .action(configCommand);

  const repos = config.command("repos").description("Manage watched repos");
  repos
    .command("add <path...>")
    .description("Add one or more repo paths")
    .option("--json", "Output as JSON")
    .action(reposAdd);
  repos
    .command("remove <path>")
    .description("Remove a repo path")
    .option("--json", "Output as JSON")
    .action(reposRemove);
  repos
    .command("list")
    .description("List watched repos")
    .option("--json", "Output as JSON")
    .action(reposList);
  repos
    .command("scan <directory>")
    .description("Recursively scan for .git directories")
    .option("--json", "Output as JSON")
    .action(reposScan);

  const calendar = config.command("calendar").description("Manage calendar integration");
  calendar
    .command("enable")
    .description("Enable calendar integration")
    .option("--json", "Output as JSON")
    .action(async (options: JsonOptions) => calendarSet(true, options));
  calendar
    .command("disable")
    .description("Disable calendar integration")
    .option("--json", "Output as JSON")
    .action(async (options: JsonOptions) => calendarSet(false, options));
  calendar
    .command("test")
    .description("Test gws availability")
    .option("--json", "Output as JSON")
    .action(calendarTest);

  const github = config.command("github").description("Manage GitHub integration");
  github
    .command("test")
    .description("Test gh auth status")
    .option("--json", "Output as JSON")
    .action(githubTest);

  const projects = config.command("projects").description("Manage projects");
  projects
    .command("add <name>")
    .description("Add or update a project")
    .requiredOption("--dir <path>", "Project directory")
    .option("--json", "Output as JSON")
    .action(projectsAdd);
  projects
    .command("remove <name>")
    .description("Remove a project")
    .option("--json", "Output as JSON")
    .action(projectsRemove);
  projects
    .command("list")
    .description("List projects")
    .option("--json", "Output as JSON")
    .action(projectsList);
}
