import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export function loadGlobalEnv() {
  if (process.env.GEMINI_API_KEY) return;
  
  try {
    process.loadEnvFile(); // Try CWD first
  } catch (e) {
    // Ignore
  }

  if (process.env.GEMINI_API_KEY) return;

  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    let installRoot = __dirname;
    while (!fs.existsSync(path.join(installRoot, 'package.json')) && installRoot !== '/') {
      installRoot = path.dirname(installRoot);
    }
    
    const envPath = path.join(installRoot, '.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  } catch (e) {
    // Ignore
  }
}
