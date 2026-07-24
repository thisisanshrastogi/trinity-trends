import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

import type { InstagramSearchRequest } from "./instagram.types.js";
import type { ClientLike } from "../core/core.interfaces.js";

const execFileAsync = promisify(execFile);

/**
 * Instagram client that delegates to the Python ig_scraper subprocess.
 *
 * The scraper uses Playwright-based browser automation to search Instagram
 * for hashtags or keywords and returns a JSON object matching the
 * InstagramScraperOutput shape:
 *   { metadata: {...}, results: { "query": ["url1", "url2", ...] } }
 *
 * This replaces the old direct GraphQL API approach that required FB_DTSG
 * tokens and ig_session.json, which were fragile and broke frequently.
 */
export class InstagramClient implements ClientLike<InstagramSearchRequest> {
  private scraperDir: string;
  private pythonExec: string;
  private mainScript: string;

  constructor() {
    // Find the installation root (where package.json lives)
    const __filename = fileURLToPath(import.meta.url);
    let root = dirname(__filename);
    while (!existsSync(join(root, "package.json")) && root !== "/") {
      root = dirname(root);
    }

    this.scraperDir = join(root, "ig_scraper");
    this.mainScript = join(this.scraperDir, "main.py");

    // Prefer the ig_scraper venv Python if available
    const venvPython = join(this.scraperDir, ".venv", "bin", "python3");
    this.pythonExec = existsSync(venvPython) ? venvPython : "python3";
  }

  /**
   * Run the Python ig_scraper and return its JSON output as a string.
   *
   * The scraper writes results to a file (instagram_results.json by default).
   * We tell it to write to a temporary path, then read it back and return it.
   */
  public async search(req: InstagramSearchRequest): Promise<string> {
    if (!existsSync(this.mainScript)) {
      throw new Error(
        `ig_scraper not found at ${this.mainScript}. ` +
        "Make sure the ig_scraper directory exists in the project root."
      );
    }

    const limit = req.limit ?? 20;
    const searchType = req.searchType ?? "keyword";

    // Build the output path with a unique name to avoid collisions
    const outputFile = join(
      this.scraperDir,
      `results_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`
    );

    const args = [
      this.mainScript,
      "--query", req.query,
      "--count", String(limit),
      "--search-type", searchType,
      "--output", outputFile,
    ];

    console.log(
      `[InstagramClient] Spawning ig_scraper: ${searchType} search for "${req.query}" (limit=${limit})`
    );

    try {
      const { stdout, stderr } = await execFileAsync(this.pythonExec, args, {
        cwd: this.scraperDir,
        timeout: 300_000, // 5 min max (browser automation can be slow)
        env: { ...process.env },
      });

      // Log scraper output for debugging
      if (stderr) {
        for (const line of stderr.trim().split("\n")) {
          if (line) console.log(`[ig_scraper] ${line}`);
        }
      }
      if (stdout) {
        for (const line of stdout.trim().split("\n")) {
          if (line) console.log(`[ig_scraper] ${line}`);
        }
      }

      // Read the results file
      if (!existsSync(outputFile)) {
        throw new Error(
          "ig_scraper did not produce output file. " +
          "Check credentials in ig_scraper/.env and try running the scraper manually."
        );
      }

      const resultJson = readFileSync(outputFile, "utf-8");

      // Clean up the temporary results file
      try {
        const { unlinkSync } = await import("fs");
        unlinkSync(outputFile);
      } catch {
        // ignore cleanup errors
      }

      return resultJson;
    } catch (err) {
      // Clean up on error too
      try {
        const { unlinkSync } = await import("fs");
        if (existsSync(outputFile)) unlinkSync(outputFile);
      } catch {
        // ignore
      }

      const error = err as Error & { stderr?: string; code?: string };

      // If the scraper process itself failed, include stderr in the error
      if (error.stderr) {
        throw new Error(
          `ig_scraper failed: ${error.message}\nStderr: ${error.stderr}`
        );
      }
      throw error;
    }
  }
}
