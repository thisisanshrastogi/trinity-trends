import { execFile } from 'child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

/**
 * Audio transcriber that uses the Python faster_whisper transcription script
 * in ig_scraper/transcribe.py. Handles both single-URL and batch transcription.
 *
 * Falls back to the legacy whisper.cpp binary if the Python script is unavailable.
 */
export class AudioTranscriber {
  private scraperDir: string;
  private pythonExec: string;
  private transcribeScript: string;
  private modelSize: string;
  private usePython: boolean;

  // Legacy whisper.cpp fallback
  private whisperPath: string;
  private whisperModelPath: string;

  constructor(modelSize?: string) {
    this.modelSize = modelSize || process.env.WHISPER_MODEL_SIZE || 'base';

    // Find the installation root (where package.json lives)
    const __filename = fileURLToPath(import.meta.url);
    let root = dirname(__filename);
    while (!existsSync(join(root, 'package.json')) && root !== '/') {
      root = dirname(root);
    }

    this.scraperDir = join(root, 'ig_scraper');
    this.transcribeScript = join(this.scraperDir, 'transcribe.py');
    const venvPython = join(this.scraperDir, '.venv', 'bin', 'python3');
    this.pythonExec = existsSync(venvPython) ? venvPython : 'python3';

    // Bypass Python faster_whisper batch transcription and use legacy JS/whisper.cpp flow
    this.usePython = false;

    // Legacy whisper.cpp fallback paths
    this.whisperPath = process.env.WHISPER_BIN_PATH || '../whisper.cpp/build/bin/whisper-cli';
    if (!existsSync(this.whisperPath)) {
      this.whisperPath = '../whisper.cpp/main';
    }
    this.whisperModelPath = process.env.WHISPER_MODEL_PATH || '../whisper.cpp/models/ggml-base.en.bin';
  }

  /**
   * Transcribe a single Instagram post URL.
   * Downloads the media audio via yt-dlp and transcribes with faster_whisper.
   */
  public async processUrl(url: string): Promise<{ transcript: string; metadata?: any }> {
    if (process.env.GROQ_API_KEY) {
      return this.processUrlGroq(url);
    }
    if (this.usePython) {
      return this.processUrlPython(url);
    }
    return this.processUrlLegacy(url);
  }

  /**
   * Batch-transcribe multiple URLs in a single Python process invocation.
   * More efficient than calling processUrl() in a loop because the whisper
   * model is loaded only once.
   */
  public async processBatch(urls: string[]): Promise<Map<string, { transcript: string; metadata?: any }>> {
    if (process.env.GROQ_API_KEY) {
      return this.processBatchGroq(urls);
    }

    if (!this.usePython) {
      // Fallback: process concurrently in batches with legacy
      const results = new Map<string, { transcript: string; metadata?: any }>();
      const CONCURRENCY_LIMIT = 4;

      for (let i = 0; i < urls.length; i += CONCURRENCY_LIMIT) {
        const chunk = urls.slice(i, i + CONCURRENCY_LIMIT);
        await Promise.all(chunk.map(async (url) => {
          try {
            const { transcript, metadata } = await this.processUrlLegacy(url);
            results.set(url, { transcript, metadata });
          } catch (err) {
            console.warn(`[AudioTranscriber] Transcription failed for ${url}:`, (err as Error).message);
            results.set(url, { transcript: '' });
          }
        }));
      }
      return results;
    }

    const batchId = crypto.randomUUID();
    const inputPath = join(tmpdir(), `ig_batch_${batchId}.json`);
    const outputPath = join(tmpdir(), `ig_batch_${batchId}_out.json`);

    try {
      writeFileSync(inputPath, JSON.stringify(urls), 'utf-8');

      console.log(`[AudioTranscriber] Batch transcribing ${urls.length} URLs with faster_whisper...`);

      const { stderr } = await execFileAsync(this.pythonExec, [
        this.transcribeScript,
        '--batch', inputPath,
        '--output', outputPath,
        '--model', this.modelSize,
      ], {
        cwd: this.scraperDir,
        timeout: 600_000, // 10 min for batch
        env: { ...process.env },
      });

      if (stderr) {
        for (const line of stderr.trim().split('\n')) {
          if (line) console.log(`[transcribe] ${line}`);
        }
      }

      if (!existsSync(outputPath)) {
        throw new Error('Batch transcription produced no output file');
      }

      const resultJson = JSON.parse(readFileSync(outputPath, 'utf-8')) as Record<string, string>;
      const map = new Map<string, { transcript: string; metadata?: any }>();
      for (const [url, transcript] of Object.entries(resultJson)) {
        map.set(url, { transcript });
      }
      return map;
    } finally {
      for (const f of [inputPath, outputPath]) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
      }
    }
  }

  // ── Python faster_whisper path ──────────────────────────────

  private async processUrlPython(url: string): Promise<{ transcript: string; metadata?: any }> {
    console.log(`[AudioTranscriber] Transcribing ${url} with faster_whisper...`);

    const { stdout, stderr } = await execFileAsync(this.pythonExec, [
      this.transcribeScript,
      url,
      '--model', this.modelSize,
    ], {
      cwd: this.scraperDir,
      timeout: 180_000, // 3 min per URL
      env: { ...process.env },
    });

    if (stderr) {
      for (const line of stderr.trim().split('\n')) {
        if (line) console.log(`[transcribe] ${line}`);
      }
    }

    return { transcript: (stdout || '').trim() };
  }

  // ── Legacy whisper.cpp fallback ─────────────────────────────

  private async processUrlLegacy(url: string): Promise<{ transcript: string; metadata?: any }> {
    const { spawn } = await import('child_process');
    const { MediaDownloader } = await import('./media.downloader.js');

    const downloader = new MediaDownloader();
    const tmpAudioPath = join(tmpdir(), `media_audio_${crypto.randomUUID()}.wav`);

    try {
      console.log(`[AudioTranscriber] Legacy: downloading audio for ${url}...`);
      const meta = await downloader.downloadAudio(url, tmpAudioPath);

      console.log(`[AudioTranscriber] Legacy: transcribing with whisper.cpp...`);
      const transcript = await new Promise<string>((resolve, reject) => {
        const args = ['-m', this.whisperModelPath, '-f', tmpAudioPath, '-nt', '-np'];
        const proc = spawn(this.whisperPath, args);
        let output = '';

        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.on('close', (code) => {
          if (code === 0) {
            const lines = output.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            resolve(lines.join(' '));
          } else {
            reject(new Error(`whisper.cpp failed (code ${code})`));
          }
        });
        proc.on('error', (err) => {
          reject(new Error(`Failed to start whisper.cpp: ${err.message}`));
        });
      });

      return { transcript, metadata: meta };
    } finally {
      try { if (existsSync(tmpAudioPath)) unlinkSync(tmpAudioPath); } catch { /* ignore */ }
    }
  }

  // ── Groq API path ───────────────────────────────────────────

  private async processUrlGroq(url: string): Promise<{ transcript: string; metadata?: any }> {
    // Kept for backward compatibility if someone calls processUrl directly
    const res = await this.processBatchGroq([url]);
    return res.get(url) || { transcript: '' };
  }

  private async processBatchGroq(urls: string[]): Promise<Map<string, { transcript: string; metadata?: any }>> {
    const { MediaDownloader } = await import('./media.downloader.js');
    const { readFileSync, existsSync, unlinkSync } = await import('fs');
    const { Blob } = await import('node:buffer');

    const downloader = new MediaDownloader();
    const results = new Map<string, { transcript: string; metadata?: any }>();
    const downloadedFiles: { url: string; path: string; metadata: any }[] = [];

    // Phase 1: Download all files first (in parallel chunks of 10)
    console.log(`[AudioTranscriber] Groq Phase 1: Downloading ${urls.length} files...`);
    const DL_CONCURRENCY = 10;
    for (let i = 0; i < urls.length; i += DL_CONCURRENCY) {
      const chunk = urls.slice(i, i + DL_CONCURRENCY);
      await Promise.all(chunk.map(async (url) => {
        try {
          const tmpPath = join(tmpdir(), `media_audio_${crypto.randomUUID()}.wav`);
          const meta = await downloader.downloadAudio(url, tmpPath);
          downloadedFiles.push({ url, path: tmpPath, metadata: meta });
        } catch (err) {
          console.warn(`[AudioTranscriber] Failed to download ${url}:`, (err as Error).message);
          results.set(url, { transcript: '' });
        }
      }));
    }

    // Phase 2: Transcribe all downloaded files using Groq (in parallel chunks of 10)
    console.log(`[AudioTranscriber] Groq Phase 2: Transcribing ${downloadedFiles.length} files via API...`);
    try {
      const API_CONCURRENCY = 10;
      for (let i = 0; i < downloadedFiles.length; i += API_CONCURRENCY) {
        const chunk = downloadedFiles.slice(i, i + API_CONCURRENCY);
        await Promise.all(chunk.map(async ({ url, path, metadata }) => {
          try {
            const fileBuffer = readFileSync(path);
            const blob = new Blob([fileBuffer], { type: 'audio/wav' });

            const formData = new FormData();
            formData.append('file', blob as any, 'audio.wav');
            formData.append('model', 'whisper-large-v3-turbo');
            formData.append('language', 'en'); // Force english transcription

            let retries = 3;
            let success = false;
            while (retries > 0 && !success) {
              const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
                },
                body: formData as any
              });

              if (res.status === 429) {
                const waitTime = 4000 + Math.random() * 2000;
                console.log(`[AudioTranscriber] Groq 429 Rate Limit hit for ${url}. Sleeping ${Math.round(waitTime/1000)}s...`);
                await new Promise(r => setTimeout(r, waitTime));
                retries--;
                continue;
              }

              if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Groq API error ${res.status}: ${errText}`);
              }

              const data = await (res.json() as Promise<{ text?: string }>);
              results.set(url, { transcript: data.text || '', metadata });
              success = true;
            }
            if (!success) {
               throw new Error(`Groq API error: Max 429 retries exceeded`);
            }
          } catch (err) {
            console.warn(`[AudioTranscriber] Groq transcription failed for ${url}:`, (err as Error).message);
            results.set(url, { transcript: '', metadata });
          }
        }));

        // Respect Groq API rate limit of 20 requests per second
        // By sleeping 1 second after every batch of 10, we cap out at 10 requests per second max.
        if (i + API_CONCURRENCY < downloadedFiles.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } finally {
      // Cleanup all downloaded files
      for (const file of downloadedFiles) {
        try { if (existsSync(file.path)) unlinkSync(file.path); } catch { /* ignore */ }
      }
    }

    return results;
  }
}
