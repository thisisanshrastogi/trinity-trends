import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import {
  getCurrentVersion,
  compareSemver,
  getManifestUrl,
  getProjectRoot,
  type VersionManifest,
  type ReleaseInfo,
} from './version.js';

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseInfo?: ReleaseInfo;
  hasPatch: boolean;
}

/**
 * UpgradeManager handles checking for updates, downloading releases/patches,
 * applying updates with backup, and rollback on failure.
 */
export class UpgradeManager {
  private manifestUrl: string;
  private projectRoot: string;
  private backupDir: string;
  private downloadDir: string;
  private lockFile: string;

  constructor(manifestUrl?: string) {
    this.manifestUrl = manifestUrl || getManifestUrl();
    this.projectRoot = getProjectRoot();
    this.backupDir = path.join(this.projectRoot, '.upgrade_backup');
    this.downloadDir = path.join(this.projectRoot, '.upgrade_downloads');
    this.lockFile = path.join(this.projectRoot, '.upgrade_in_progress');
  }

  /**
   * Checks if a previous update was interrupted and automatically rolls back.
   */
  static recoverIfInterrupted(): void {
    const root = getProjectRoot();
    const lock = path.join(root, '.upgrade_in_progress');
    const backup = path.join(root, '.upgrade_backup');

    if (fs.existsSync(lock) && fs.existsSync(backup)) {
      console.log('\x1b[33m[!] Previous update was interrupted. Recovering from backup...\x1b[0m');
      const manager = new UpgradeManager();
      manager.rollback();
      console.log('\x1b[32m[OK] Recovery complete. System restored.\x1b[0m\n');
    } else if (fs.existsSync(lock)) {
      // Just a stale lock file with no backup
      fs.unlinkSync(lock);
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Check if an update is available by fetching the remote manifest.
   */
  async checkForUpdate(): Promise<UpdateCheckResult> {
    const currentVersion = getCurrentVersion();

    const manifest = await this.fetchManifest();
    const latestVersion = manifest.latest;
    const updateAvailable = compareSemver(currentVersion, latestVersion) < 0;

    const releaseInfo = manifest.releases[latestVersion];

    return {
      updateAvailable,
      currentVersion,
      latestVersion,
      releaseInfo,
      hasPatch: false,
    };
  }

  /**
   * Download the full release archive for a given version.
   * Returns the path to the downloaded file.
   */
  async downloadFullRelease(releaseInfo: ReleaseInfo): Promise<string> {
    fs.mkdirSync(this.downloadDir, { recursive: true });
    const fileName = path.basename(new URL(releaseInfo.url).pathname);
    const destPath = path.join(this.downloadDir, fileName);

    await this.downloadFile(releaseInfo.url, destPath);

    // Verify SHA-256 if provided
    if (releaseInfo.sha256) {
      const hash = this.computeSha256(destPath);
      if (hash !== releaseInfo.sha256) {
        fs.unlinkSync(destPath);
        throw new Error(
          `SHA-256 mismatch for full release.\n  Expected: ${releaseInfo.sha256}\n  Got:      ${hash}\nThe download may be corrupted. Please try again.`
        );
      }
    }

    return destPath;
  }

  /**
   * Apply an update from an archive (tar.gz).
   * 1. Creates a backup of current critical files
   * 2. Extracts the archive
   * 3. Replaces files
   * 4. Runs post-install hooks
   * 5. Verifies the update
   *
   * Returns true on success. On failure, automatically rolls back.
   */
  async applyUpdate(archivePath: string, newVersion: string): Promise<boolean> {
    // Write lock file to indicate update is in progress
    fs.writeFileSync(this.lockFile, 'updating');

    // Register interrupt handlers to rollback gracefully
    const handleInterrupt = () => {
      console.log('\n\x1b[33m[!] Update interrupted! Rolling back to prevent corruption...\x1b[0m');
      try { this.rollback(); } catch (e) { }
      process.exit(1);
    };
    process.on('SIGINT', handleInterrupt);
    process.on('SIGTERM', handleInterrupt);

    // Step 1: Backup
    this.createBackup();

    try {
      // Step 2: Extract to a temporary directory
      const extractDir = path.join(this.downloadDir, '_extract_tmp');
      fs.rmSync(extractDir, { recursive: true, force: true });
      fs.mkdirSync(extractDir, { recursive: true });

      execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, {
        stdio: 'pipe',
      });

      // Find the extracted root (may be nested in a folder like trinity-trends-v1.0.28/)
      const entries = fs.readdirSync(extractDir);
      let sourceDir = extractDir;
      if (
        entries.length === 1 &&
        fs.statSync(path.join(extractDir, entries[0])).isDirectory()
      ) {
        sourceDir = path.join(extractDir, entries[0]);
      }

      // Step 3: Replace files
      const filesToUpdate = ['dist', 'pipeline', 'ig_scraper', 'package.json', 'package-lock.json', 'install.js', 'uninstall.js'];

      for (const item of filesToUpdate) {
        const srcItem = path.join(sourceDir, item);
        const destItem = path.join(this.projectRoot, item);

        if (!fs.existsSync(srcItem)) continue;

        // Remove old
        if (fs.existsSync(destItem)) {
          const stat = fs.statSync(destItem);
          if (stat.isDirectory()) {
            fs.rmSync(destItem, { recursive: true, force: true });
          } else {
            fs.unlinkSync(destItem);
          }
        }

        // Copy new
        this.copyRecursive(srcItem, destItem);
      }

      // Step 4: Run post-install hooks (reinstall node_modules for production)
      this.runPostInstallHooks();

      // Step 5: Verify
      const updatedVersion = getCurrentVersion();
      if (compareSemver(updatedVersion, newVersion) !== 0) {
        throw new Error(
          `Version verification failed. Expected ${newVersion}, got ${updatedVersion}.`
        );
      }

      // Cleanup
      this.cleanup();

      // Remove interrupt handlers
      process.removeListener('SIGINT', handleInterrupt);
      process.removeListener('SIGTERM', handleInterrupt);

      return true;
    } catch (err) {
      // Rollback on any failure
      this.rollback();
      process.removeListener('SIGINT', handleInterrupt);
      process.removeListener('SIGTERM', handleInterrupt);
      throw err;
    }
  }

  /**
   * Restore from the backup directory.
   */
  rollback(): void {
    if (!fs.existsSync(this.backupDir)) {
      throw new Error('No backup found to rollback to.');
    }

    const backupEntries = fs.readdirSync(this.backupDir);
    for (const entry of backupEntries) {
      const src = path.join(this.backupDir, entry);
      const dest = path.join(this.projectRoot, entry);

      if (fs.existsSync(dest)) {
        const stat = fs.statSync(dest);
        if (stat.isDirectory()) {
          fs.rmSync(dest, { recursive: true, force: true });
        } else {
          fs.unlinkSync(dest);
        }
      }

      this.copyRecursive(src, dest);
    }

    if (fs.existsSync(this.lockFile)) {
      fs.unlinkSync(this.lockFile);
    }
    fs.rmSync(this.backupDir, { recursive: true, force: true });
  }

  /**
   * Clean up download and temp directories.
   */
  cleanup(): void {
    if (fs.existsSync(this.downloadDir)) {
      fs.rmSync(this.downloadDir, { recursive: true, force: true });
    }
    if (fs.existsSync(this.backupDir)) {
      fs.rmSync(this.backupDir, { recursive: true, force: true });
    }
    if (fs.existsSync(this.lockFile)) {
      fs.unlinkSync(this.lockFile);
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────

  private async fetchManifest(): Promise<VersionManifest> {
    const data = await this.httpGet(this.manifestUrl);
    try {
      return JSON.parse(data) as VersionManifest;
    } catch (e) {
      throw new Error(
        `Failed to parse version manifest from ${this.manifestUrl}. The server may be unavailable or returned invalid data.`
      );
    }
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;

      const request = client.get(url, { timeout: 15000 }, (res) => {
        // Handle redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          this.httpGet(res.headers.location).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(
            new Error(`HTTP ${res.statusCode} when fetching ${url}`)
          );
          return;
        }

        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
        res.on('error', reject);
      });

      request.on('error', (err) => {
        reject(
          new Error(`Network error: ${err.message}. Are you connected to the internet?`)
        );
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timed out. Check your internet connection.'));
      });
    });
  }

  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;

      const request = client.get(url, { timeout: 120000 }, (res) => {
        // Handle redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          this.downloadFile(res.headers.location, destPath)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(
            new Error(`HTTP ${res.statusCode} when downloading ${url}`)
          );
          return;
        }

        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
        file.on('error', (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      });

      request.on('error', (err) => {
        reject(
          new Error(`Download failed: ${err.message}`)
        );
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Download timed out.'));
      });
    });
  }

  private computeSha256(filePath: string): string {
    const hash = crypto.createHash('sha256');
    const data = fs.readFileSync(filePath);
    hash.update(data);
    return hash.digest('hex');
  }

  private createBackup(): void {
    fs.rmSync(this.backupDir, { recursive: true, force: true });
    fs.mkdirSync(this.backupDir, { recursive: true });

    const itemsToBackup = ['dist', 'pipeline', 'ig_scraper', 'package.json', 'package-lock.json', 'install.js', 'uninstall.js'];

    for (const item of itemsToBackup) {
      const src = path.join(this.projectRoot, item);
      const dest = path.join(this.backupDir, item);

      if (fs.existsSync(src)) {
        this.copyRecursive(src, dest);
      }
    }
  }

  private runPostInstallHooks(): void {
    // 1. Reinstall Node deps
    try {
      execSync('npm install --omit=dev', {
        cwd: this.projectRoot,
        stdio: 'pipe',
        timeout: 120000,
      });
    } catch (err: any) {
      console.warn(`[WARN] Node deps reinstall failed: ${err.message}`);
    }

    // 2. Reinstall Python deps
    try {
      const pipelineDir = path.join(this.projectRoot, 'pipeline');
      const venvDir = path.join(pipelineDir, '.venv');

      if (fs.existsSync(pipelineDir)) {
        if (!fs.existsSync(venvDir)) {
          console.log('[INFO] Creating Python virtual environment...');
          execSync('python3 -m venv .venv', {
            cwd: pipelineDir,
            stdio: 'pipe',
            timeout: 60000,
          });
        }

        const isWin = process.platform === 'win32';
        const pipCmd = isWin
          ? path.join(venvDir, 'Scripts', 'pip')
          : path.join(venvDir, 'bin', 'pip');

        if (fs.existsSync(path.join(pipelineDir, 'pyproject.toml'))) {
          console.log('[INFO] Installing Python dependencies from pyproject.toml...');
          execSync(`"${pipCmd}" install -e .`, {
            cwd: pipelineDir,
            stdio: 'pipe',
            timeout: 120000,
          });
        } else if (fs.existsSync(path.join(pipelineDir, 'requirements.txt'))) {
          console.log('[INFO] Installing Python dependencies from requirements.txt...');
          execSync(`"${pipCmd}" install -r requirements.txt`, {
            cwd: pipelineDir,
            stdio: 'pipe',
            timeout: 120000,
          });
        }
      }

      // 2b. Reinstall ig_scraper Python deps
      const igScraperDir = path.join(this.projectRoot, 'ig_scraper');
      const igVenvDir = path.join(igScraperDir, '.venv');

      if (fs.existsSync(igScraperDir)) {
        if (!fs.existsSync(igVenvDir)) {
          console.log('[INFO] Creating ig_scraper Python virtual environment...');
          execSync('python3 -m venv .venv', {
            cwd: igScraperDir,
            stdio: 'pipe',
            timeout: 60000,
          });
        }

        const isWin = process.platform === 'win32';
        const igPipCmd = isWin
          ? path.join(igVenvDir, 'Scripts', 'pip')
          : path.join(igVenvDir, 'bin', 'pip');

        if (fs.existsSync(path.join(igScraperDir, 'requirements.txt'))) {
          console.log('[INFO] Installing ig_scraper Python dependencies...');
          execSync(`"${igPipCmd}" install -r requirements.txt`, {
            cwd: igScraperDir,
            stdio: 'pipe',
            timeout: 120000,
          });
          
          const igPythonCmd = isWin
            ? path.join(igVenvDir, 'Scripts', 'python')
            : path.join(igVenvDir, 'bin', 'python');

          try {
             console.log('[INFO] Installing Playwright Chromium browser...');
             execSync(`"${igPythonCmd}" -m playwright install chromium`, {
                cwd: igScraperDir,
                stdio: 'pipe',
                timeout: 120000,
             });
          } catch(e) {}
        }
      }

    } catch (err: any) {
      console.warn(`[WARN] Python deps reinstall failed: ${err.message}`);
    }

    // 3. Re-link CLI
    try {
      execSync('npm link', {
        cwd: this.projectRoot,
        stdio: 'pipe',
        timeout: 30000,
      });
    } catch (err: any) {
      console.warn(`[WARN] NPM link failed: ${err.message}`);
    }
  }

  private copyRecursive(src: string, dest: string): void {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const child of fs.readdirSync(src)) {
        if (child === '__pycache__' || child === 'node_modules' || child === '.venv') continue;
        this.copyRecursive(path.join(src, child), path.join(dest, child));
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}
