import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

const VERSION = "1.0.0";
const DIST_NAME = `trinity-trends-v${VERSION}`;
const DIST_DIR = path.join("dist_release", DIST_NAME);

console.log("======================================");
console.log(`📦 Building Trinity Trends Release v${VERSION}`);
console.log("======================================\n");

// 1. Clean previous builds
console.log("🧹 Cleaning previous builds...");
fs.rmSync('dist', { recursive: true, force: true });
fs.rmSync('dist_release', { recursive: true, force: true });
fs.rmSync(path.join('pipeline', '.venv'), { recursive: true, force: true });
fs.rmSync(path.join('pipeline', '__pycache__'), { recursive: true, force: true });

// 2. Build TypeScript
console.log("\n🔨 Compiling TypeScript...");
run("npm install");
run("npm run build");

// 3. Create distribution folder structure
console.log("\n📁 Preparing distribution package...");
fs.mkdirSync(path.join(DIST_DIR, "scripts"), { recursive: true });
fs.mkdirSync(path.join(DIST_DIR, "pipeline"), { recursive: true });

// 4. Copy necessary files (simple recursive copy function)
function copyRecursiveSync(src, dest) {
  const stats = fs.existsSync(src) ? fs.statSync(src) : null;
  if (stats && stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(childItemName => {
      // Ignore __pycache__ and egg-info during copy
      if (childItemName === '__pycache__' || childItemName.endsWith('.egg-info')) return;
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else if (stats) {
    fs.copyFileSync(src, dest);
  }
}

console.log("📄 Copying files...");
copyRecursiveSync('dist', path.join(DIST_DIR, 'dist'));
copyRecursiveSync('pipeline', path.join(DIST_DIR, 'pipeline'));
['package.json', 'package-lock.json', '.env.example', 'install.js'].forEach(file => {
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(DIST_DIR, file));
});

// 5. Compress
console.log("\n🗜️ Compressing archive...");
try {
  // Try tar command (available on Linux/Mac/Win10+)
  run(`tar -czvf ${DIST_NAME}.tar.gz ${DIST_NAME}`, { cwd: 'dist_release' });
} catch (e) {
  console.log("⚠️ Could not create tar.gz automatically (tar command missing?). Package is ready in dist_release/ folder.");
}

console.log("\n======================================");
console.log("✅ Build Complete!");
console.log(`Package available at: dist_release/${DIST_NAME}.tar.gz`);
console.log("======================================\n");
