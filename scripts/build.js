import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

const pkgPath = path.join(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const VERSION = pkg.version;
const DIST_NAME = `trinity-trends-v${VERSION}`;
const DIST_DIR = path.join("dist_release", DIST_NAME);

console.log("======================================");
console.log(`[*] Building Trinity Trends Release v${VERSION}`);
console.log("======================================\n");

// 1. Clean previous builds
console.log("[1/5] Cleaning previous builds...");
fs.rmSync('dist', { recursive: true, force: true });
fs.rmSync('dist_release', { recursive: true, force: true });
fs.rmSync(path.join('pipeline', '.venv'), { recursive: true, force: true });
fs.rmSync(path.join('pipeline', '__pycache__'), { recursive: true, force: true });

// 2. Build TypeScript
console.log("\n[2/5] Compiling TypeScript...");
run("npm install");
run("npm run build");

if (process.platform !== 'win32') {
    run("chmod +x dist/src/app/cli.js");
}
// 3. Create distribution folder structure
console.log("\n[3/5] Preparing distribution package...");
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

console.log("[4/5] Copying files...");
copyRecursiveSync('dist', path.join(DIST_DIR, 'dist'));
copyRecursiveSync('pipeline', path.join(DIST_DIR, 'pipeline'));
['package.json', 'package-lock.json', '.env.example', 'install.js', 'uninstall.js'].forEach(file => {
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(DIST_DIR, file));
});

// 5. Compress
console.log("\n[5/6] Compressing archive...");
let tarballPath = '';
try {
  // Try tar command (available on Linux/Mac/Win10+)
  run(`tar -czvf ${DIST_NAME}.tar.gz ${DIST_NAME}`, { cwd: 'dist_release' });
  tarballPath = path.join('dist_release', `${DIST_NAME}.tar.gz`);
} catch (e) {
  console.log("[WARNING] Could not create tar.gz automatically (tar command missing?). Package is ready in dist_release/ folder.");
}

// 6. Generate Manifest
console.log("\n[6/6] Generating manifest.json...");
if (tarballPath && fs.existsSync(tarballPath)) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(tarballPath);
  hash.update(data);
  const sha256 = hash.digest('hex');
  
  const manifestPath = path.join('dist_release', 'manifest.json');
  let manifest = {
    latest: VERSION,
    manifestVersion: 1,
    releases: {}
  };
  
  if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  }
  
  manifest.latest = VERSION;
  const repo = pkg.repository?.url?.match(/github\.com[:/]([^/]+\/[^/.]+)/)?.[1] || pkg.repository || 'trinity-trends/trinity-trends';
  const cleanRepo = repo.replace(/\.git$/, '');
  
  manifest.releases[VERSION] = {
      url: `https://github.com/${cleanRepo}/releases/download/v${VERSION}/${DIST_NAME}.tar.gz`,
      sha256: sha256,
      changelog: "See GitHub releases for full changelog.",
      releaseDate: new Date().toISOString().split('T')[0]
  };
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[OK] Created manifest.json for v${VERSION}`);
}

console.log("\n======================================");
console.log("[DONE] Build Complete!");
console.log(`Package available at: dist_release/${DIST_NAME}.tar.gz`);
console.log("======================================\n");
