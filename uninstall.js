import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

console.log("======================================");
console.log("Uninstalling Trinity Trends");
console.log("======================================\n");

console.log("[*] Removing global CLI command...");
try {
  execSync("npm rm -g trinity-trends", { stdio: 'ignore' });
  console.log("[OK] Removed 'trinity' global command.");
} catch (e) {
  console.log("[WARNING] Could not automatically remove the global command. You may need to run 'npm rm -g trinity-trends' manually.");
}

const isWin = process.platform === "win32";
const installDir = isWin 
  ? path.join(os.homedir(), 'AppData', 'Local', 'trinity-trends')
  : path.join(os.homedir(), '.local', 'share', 'trinity-trends');

if (fs.existsSync(installDir)) {
  console.log(`\n[*] Removing application files from ${installDir}...`);
  try {
    fs.rmSync(installDir, { recursive: true, force: true });
    console.log("[OK] Application files removed.");
  } catch (e) {
    console.log(`[WARNING] Could not completely remove files from ${installDir}.`);
  }
}

console.log("\n[DONE] Uninstallation complete!\n");
