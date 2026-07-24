import { spawn } from 'child_process';
import { existsSync } from 'fs';

export class MediaDownloader {
  /**
   * Downloads media from a given URL and extracts it as a 16kHz WAV file.
   */
  public async downloadAudio(url: string, outputPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const args = [
        '-x', 
        '--audio-format', 'wav',
        '--postprocessor-args', 'ffmpeg:-ar 16000 -ac 1',
        '--dump-json',
        '--no-simulate',
        '--no-warnings',
        '--force-overwrites',
        '-o', outputPath,
        url
      ];

      const ytProcess = spawn('yt-dlp', args);
      let stdoutData = '';

      ytProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      ytProcess.on('close', (code) => {
        if (code === 0 && existsSync(outputPath)) {
          try {
            const lines = stdoutData.trim().split('\n');
            // The JSON output should be the last line printed to stdout
            const jsonStr = lines[lines.length - 1];
            const meta = JSON.parse(jsonStr);
            const cleanMeta = {
              id: meta.id,
              title: meta.title,
              description: meta.description,
              channel: meta.channel,
              uploader: meta.uploader,
              uploader_id: meta.uploader_id,
              timestamp: meta.timestamp,
              like_count: meta.like_count,
              comment_count: meta.comment_count
            };
            resolve(cleanMeta);
          } catch (e) {
            console.warn("[MediaDownloader] Failed to parse yt-dlp metadata");
            resolve({});
          }
        } else {
          reject(new Error(`yt-dlp failed with exit code ${code}`));
        }
      });

      ytProcess.on('error', (err) => {
        reject(new Error(`Failed to start yt-dlp: ${err.message}. Make sure yt-dlp and ffmpeg are installed.`));
      });
    });
  }
}
