import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ensureScopeDir, getScopeDir } from "../store/config.js";

function commandExists(command: string): boolean {
  const check = spawnSync("which", [command], { stdio: "pipe" });
  return check.status === 0;
}

function fallbackNotify(title: string, body: string): void {
  ensureScopeDir();
  const logPath = join(getScopeDir(), "notifications.log");
  appendFileSync(logPath, `[${new Date().toISOString()}] ${title}: ${body}\n`, "utf-8");
}

export function notify(title: string, body: string): void {
  // Always log to file (so scope notifications can show history)
  fallbackNotify(title, body);

  // Also fire desktop notification
  try {
    if (process.platform === "linux") {
      if (commandExists("notify-send")) {
        spawnSync("notify-send", [title, body], { stdio: "pipe" });
      }
      return;
    }

    if (process.platform === "darwin") {
      const escapedTitle = title.replace(/"/g, '\\"');
      const escapedBody = body.replace(/"/g, '\\"');
      const script = `display notification "${escapedBody}" with title "${escapedTitle}"`;
      spawnSync("osascript", ["-e", script], { stdio: "pipe" });
      return;
    }
  } catch {
    // Desktop notification failed, but log was already written
  }
}
