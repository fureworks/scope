import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export async function initCommand(): Promise<void> {
  const scopeDir = join(homedir(), ".scope");
  const configPath = join(scopeDir, "config.toml");

  if (existsSync(configPath)) {
    console.log("Already initialized");
    return;
  }

  mkdirSync(scopeDir, { recursive: true });
  writeFileSync(configPath, "", "utf-8");
  console.log("Initialized ~/.scope/config.toml");
}
