import chalk from "chalk";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { configExists, ensureScopeDir, getScopeDir, loadConfig, saveConfig } from "../store/config.js";
import { scanAllRepos } from "../sources/git.js";
import { getCalendarToday } from "../sources/calendar.js";
import { scanAssignedIssues } from "../sources/issues.js";
import { prioritize } from "../engine/prioritize.js";
import { notify } from "../notifications/index.js";

const PID_PATH = join(getScopeDir(), "daemon.pid");
const NOTIFIED_PATH = join(getScopeDir(), "notified.json");
const DEBOUNCE_MS = 60 * 60 * 1000;

type NotifiedState = Record<string, string>;

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  if (!existsSync(PID_PATH)) return null;
  const raw = readFileSync(PID_PATH, "utf-8").trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isFinite(pid) ? pid : null;
}

function removePidFile(): void {
  if (existsSync(PID_PATH)) {
    unlinkSync(PID_PATH);
  }
}

function loadNotifiedState(): NotifiedState {
  if (!existsSync(NOTIFIED_PATH)) return {};
  try {
    return JSON.parse(readFileSync(NOTIFIED_PATH, "utf-8")) as NotifiedState;
  } catch {
    return {};
  }
}

function saveNotifiedState(state: NotifiedState): void {
  writeFileSync(NOTIFIED_PATH, JSON.stringify(state, null, 2), "utf-8");
}

async function runSignalCheck(): Promise<void> {
  if (!configExists()) return;

  const config = loadConfig();
  const gitSignals = await scanAllRepos(config.repos);

  let calendarEvents: Awaited<ReturnType<typeof getCalendarToday>> = null;
  if (config.calendar.enabled) {
    calendarEvents = await getCalendarToday();
  }

  const issueScan = await scanAssignedIssues();
  const events = calendarEvents?.events ?? [];
  const freeBlocks = calendarEvents?.freeBlocks ?? [];
  const result = prioritize(gitSignals, events, freeBlocks, issueScan.issues);

  const candidates = [...result.now, ...result.today].filter((item) => item.score >= 8);
  if (candidates.length === 0) return;

  ensureScopeDir();
  const state = loadNotifiedState();
  const nowMs = Date.now();
  let changed = false;

  for (const item of candidates) {
    const id = `${item.source}:${item.label}`;
    const lastNotified = state[id] ? new Date(state[id]).getTime() : 0;
    if (lastNotified && nowMs - lastNotified < DEBOUNCE_MS) {
      continue;
    }

    notify("Scope: Action Needed", `${item.emoji} ${item.label} — ${item.detail}`);
    state[id] = new Date(nowMs).toISOString();
    changed = true;
  }

  if (changed) {
    saveNotifiedState(state);
  }
}

function markDaemonEnabled(enabled: boolean): void {
  if (!configExists()) return;
  const config = loadConfig();
  config.daemon.enabled = enabled;
  saveConfig(config);
}

export async function daemonCommand(action: string): Promise<void> {
  switch (action) {
    case "start":
      await startDaemon();
      return;
    case "stop":
      stopDaemon();
      return;
    case "status":
      showDaemonStatus();
      return;
    case "run":
      await runDaemonLoop();
      return;
    default:
      console.log(chalk.yellow(`\n  Unknown daemon action: ${action}`));
      console.log(chalk.dim("  Use: scope daemon start|stop|status\n"));
  }
}

async function startDaemon(): Promise<void> {
  if (!configExists()) {
    console.log(chalk.yellow("\n  Scope isn't set up yet. Run `scope onboard` first.\n"));
    return;
  }

  ensureScopeDir();

  const existingPid = readPid();
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(chalk.green(`\n  Daemon already running (PID ${existingPid}).\n`));
    return;
  }
  removePidFile();

  const child = spawn(process.execPath, [process.argv[1], "daemon", "run"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  writeFileSync(PID_PATH, String(child.pid), "utf-8");
  markDaemonEnabled(true);

  console.log(chalk.green(`\n  Daemon started (PID ${child.pid}).\n`));
}

function stopDaemon(): void {
  const pid = readPid();
  if (!pid) {
    console.log(chalk.dim("\n  Daemon is not running.\n"));
    markDaemonEnabled(false);
    return;
  }

  if (!isProcessRunning(pid)) {
    removePidFile();
    console.log(chalk.dim("\n  Daemon was not running (stale PID removed).\n"));
    markDaemonEnabled(false);
    return;
  }

  try {
    process.kill(pid);
    removePidFile();
    markDaemonEnabled(false);
    console.log(chalk.green(`\n  Daemon stopped (PID ${pid}).\n`));
  } catch {
    console.log(chalk.yellow(`\n  Could not stop daemon PID ${pid}.\n`));
  }
}

function showDaemonStatus(): void {
  const config = loadConfig();
  const pid = readPid();

  if (pid && isProcessRunning(pid)) {
    console.log(chalk.green(`\n  Daemon running (PID ${pid}).`));
    console.log(chalk.dim(`  Interval: ${config.daemon.intervalMinutes} minutes\n`));
    return;
  }

  if (pid) {
    removePidFile();
  }

  console.log(chalk.dim("\n  Daemon is not running."));
  console.log(chalk.dim(`  Interval: ${config.daemon.intervalMinutes} minutes\n`));
}

async function runDaemonLoop(): Promise<void> {
  ensureScopeDir();
  writeFileSync(PID_PATH, String(process.pid), "utf-8");

  const cleanup = () => {
    const pid = readPid();
    if (pid === process.pid) {
      removePidFile();
    }
    process.exit(0);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  while (true) {
    try {
      await runSignalCheck();
    } catch {
      // Keep daemon alive even if checks fail.
    }

    const config = configExists() ? loadConfig() : null;
    const intervalMinutes = Math.max(1, config?.daemon.intervalMinutes ?? 15);
    await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60 * 1000));
  }
}
