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
  try {
    if (process.platform === "linux") {
      if (commandExists("notify-send")) {
        const result = spawnSync("notify-send", [title, body], { stdio: "pipe" });
        if (result.status === 0) return;
      }
      fallbackNotify(title, body);
      return;
    }

    if (process.platform === "darwin") {
      const escapedTitle = title.replace(/"/g, '\\"');
      const escapedBody = body.replace(/"/g, '\\"');
      const script = `display notification "${escapedBody}" with title "${escapedTitle}"`;
      const result = spawnSync("osascript", ["-e", script], { stdio: "pipe" });
      if (result.status === 0) return;
      fallbackNotify(title, body);
      return;
    }

    fallbackNotify(title, body);
  } catch {
    fallbackNotify(title, body);
  }
}
