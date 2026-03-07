import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "toml";

export interface ScopeConfig {
  repos: string[];
  projects: Record<
    string,
    {
      path: string;
      repos?: string[];
      description?: string;
    }
  >;
  calendar: {
    enabled: boolean;
    backend: "gws";
  };
  daemon: {
    enabled: boolean;
    intervalMinutes: number;
  };
}

const SCOPE_DIR = join(homedir(), ".scope");
const CONFIG_PATH = join(SCOPE_DIR, "config.toml");

export function getScopeDir(): string {
  return SCOPE_DIR;
}

export function ensureScopeDir(): void {
  if (!existsSync(SCOPE_DIR)) {
    mkdirSync(SCOPE_DIR, { recursive: true });
  }
  const contextsDir = join(SCOPE_DIR, "contexts");
  if (!existsSync(contextsDir)) {
    mkdirSync(contextsDir, { recursive: true });
  }
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadConfig(): ScopeConfig {
  if (!configExists()) {
    return {
      repos: [],
      projects: {},
      calendar: { enabled: false, backend: "gws" },
      daemon: { enabled: false, intervalMinutes: 15 },
    };
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = parseToml(raw) as Partial<ScopeConfig>;

  return {
    repos: parsed.repos ?? [],
    projects: parsed.projects ?? {},
    calendar: {
      enabled: parsed.calendar?.enabled ?? false,
      backend: parsed.calendar?.backend ?? "gws",
    },
    daemon: {
      enabled: parsed.daemon?.enabled ?? false,
      intervalMinutes: parsed.daemon?.intervalMinutes ?? 15,
    },
  };
}

export function saveConfig(config: ScopeConfig): void {
  ensureScopeDir();

  const lines: string[] = [];
  lines.push("# Scope configuration");
  lines.push("");
  lines.push(`repos = [${config.repos.map((r) => `"${r}"`).join(", ")}]`);
  lines.push("");
  lines.push("[calendar]");
  lines.push(`enabled = ${config.calendar.enabled}`);
  lines.push(`backend = "${config.calendar.backend}"`);
  lines.push("");
  lines.push("[daemon]");
  lines.push(`enabled = ${config.daemon.enabled}`);
  lines.push(`intervalMinutes = ${config.daemon.intervalMinutes}`);
  lines.push("");

  for (const [name, project] of Object.entries(config.projects)) {
    lines.push(`[projects.${name}]`);
    lines.push(`path = "${project.path}"`);
    if (project.repos && project.repos.length > 0) {
      lines.push(`repos = [${project.repos.map((r) => `"${r}"`).join(", ")}]`);
    }
    if (project.description) {
      lines.push(`description = "${project.description}"`);
    }
    lines.push("");
  }

  writeFileSync(CONFIG_PATH, lines.join("\n"), "utf-8");
}
