import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';

const execFileAsync = promisify(execFile);

interface PreflightCheckProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export const PreflightCheck: React.FC<PreflightCheckProps> = ({ onSuccess, onCancel }) => {
  const [status, setStatus] = useState<string>('Initializing pre-flight checks...');
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<boolean>(false);

  useEffect(() => {
    const runChecks = async () => {
      const foundErrors: string[] = [];
      let root = process.cwd();
      while (!fs.existsSync(path.join(root, "package.json")) && root !== "/") {
        root = path.dirname(root);
      }

      // 1. Check Env
      setStatus('Checking environment variables...');
      const envPath = path.join(root, '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        if (!content.includes('GEMINI_API_KEY=') || content.match(/GEMINI_API_KEY=\s*(your_.*)?$/)) {
          foundErrors.push('GEMINI_API_KEY is missing in .env (Required for LLM analysis)');
        }
        if (!content.includes('GROQ_API_KEY=') || content.match(/GROQ_API_KEY=\s*(your_.*)?$/)) {
          foundErrors.push('GROQ_API_KEY is missing in .env (Required for audio transcription)');
        }
        if (!content.includes('INSTAGRAM_USERNAME=') || content.match(/INSTAGRAM_USERNAME=\s*(your_.*)?$/)) {
          foundErrors.push('INSTAGRAM_USERNAME is missing in .env (Required for scraping)');
        }
      } else {
        foundErrors.push('.env file is missing!');
      }

      // 2. Check Pipeline venv
      setStatus('Checking pipeline virtual environment...');
      const pipelineVenv = path.join(root, 'pipeline', '.venv', 'bin', 'python3');
      const pipelineVenvWin = path.join(root, 'pipeline', '.venv', 'Scripts', 'python.exe');
      if (!fs.existsSync(pipelineVenv) && !fs.existsSync(pipelineVenvWin)) {
        foundErrors.push('Pipeline Python virtual environment is missing. Run `node install.js`');
      }

      // 3. Check Scraper venv
      setStatus('Checking scraper virtual environment...');
      const scraperVenv = path.join(root, 'ig_scraper', '.venv', 'bin', 'python3');
      const scraperVenvWin = path.join(root, 'ig_scraper', '.venv', 'Scripts', 'python.exe');
      const scraperPy = fs.existsSync(scraperVenv) ? scraperVenv : (fs.existsSync(scraperVenvWin) ? scraperVenvWin : null);
      if (!scraperPy) {
        foundErrors.push('Instagram Scraper Python virtual environment is missing. Run `node install.js`');
      } else {
        // 4. Check Playwright Chromium
        setStatus('Checking Playwright Chromium browser...');
        try {
          // simple check to see if playwright is importable
          await execFileAsync(scraperPy, ['-c', 'import playwright']);
        } catch (e) {
          foundErrors.push('Playwright is not installed in the scraper environment. Run `node install.js`');
        }
      }

      if (foundErrors.length > 0) {
        setErrors(foundErrors);
        setDone(true);
      } else {
        setStatus('All checks passed!');
        setTimeout(() => onSuccess(), 1000);
      }
    };
    runChecks();
  }, [onSuccess]);

  useInput((input, key) => {
    if (key.escape || (done && key.return)) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor={errors.length > 0 ? "red" : "green"}>
      <Text bold>Pre-flight Checks</Text>
      {!done && (
        <Box marginY={1}>
          <Text color="cyan"><Spinner type="dots" /> {status}</Text>
        </Box>
      )}
      {done && errors.length > 0 && (
        <Box flexDirection="column" marginY={1}>
          <Text color="red" bold>Pipeline cannot start. Please fix the following issues:</Text>
          {errors.map((err, i) => (
            <Text key={i} color="yellow">✖ {err}</Text>
          ))}
          <Box marginTop={1}>
            <Text color="gray">Press [Enter] or [Escape] to return to the menu.</Text>
          </Box>
        </Box>
      )}
      {done && errors.length === 0 && (
        <Text color="green" bold>✔ All systems go!</Text>
      )}
    </Box>
  );
};
