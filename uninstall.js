import { execSync } from 'child_process';
import * as path from 'path';

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

console.log("\n[DONE] Uninstallation complete!");
console.log("You may now safely delete this entire folder.\n");
