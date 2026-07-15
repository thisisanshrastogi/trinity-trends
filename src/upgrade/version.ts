import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the project root directory. Works whether running from source or dist.
 */
export function getProjectRoot(): string {
  // Walk up from src/upgrade or dist/src/upgrade to find package.json
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/**
 * Read the current version from package.json
 */
export function getCurrentVersion(): string {
  const pkgPath = path.join(getProjectRoot(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

/**
 * Read the GitHub repo owner/name from package.json's "repository" field,
 * or fall back to the TRINITY_GITHUB_REPO env variable.
 * Expected format: "owner/repo"
 */
export function getGitHubRepo(): string {
  // Try env variable first
  if (process.env.TRINITY_GITHUB_REPO) {
    return process.env.TRINITY_GITHUB_REPO;
  }

  // Try package.json repository field
  const pkgPath = path.join(getProjectRoot(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  if (pkg.repository) {
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url || '';
    // Extract owner/repo from various formats
    const match = repo.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (match) return match[1];
    // Already in owner/repo format
    if (repo.match(/^[^/]+\/[^/]+$/)) return repo;
  }

  return 'trinity-trends/trinity-trends';
}

/**
 * Build the manifest URL from the GitHub repo.
 * The manifest lives at: https://raw.githubusercontent.com/{owner}/{repo}/main/manifest.json
 * Can be overridden via TRINITY_UPDATE_URL env variable.
 */
export function getManifestUrl(): string {
  if (process.env.TRINITY_UPDATE_URL) {
    return process.env.TRINITY_UPDATE_URL;
  }
  const repo = getGitHubRepo();
  return `https://raw.githubusercontent.com/${repo}/main/manifest.json`;
}

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b
 *   0 if a == b
 *   1 if a > b
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parseVer = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((n) => parseInt(n, 10));
  const pa = parseVer(a);
  const pb = parseVer(b);

  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * Remote manifest schema
 */
export interface ReleaseInfo {
  url: string;
  patchUrl?: string;
  patchFromVersion?: string;
  sha256?: string;
  patchSha256?: string;
  changelog: string;
  releaseDate: string;
  size?: string;
  patchSize?: string;
}

export interface VersionManifest {
  latest: string;
  manifestVersion: number;
  releases: Record<string, ReleaseInfo>;
}
