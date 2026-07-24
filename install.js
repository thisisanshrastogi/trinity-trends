import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (query) => new Promise(resolve => rl.question(query, resolve));
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

const banner = `
████████╗██████╗ ██╗███╗   ██╗██╗████████╗██╗   ██╗
╚══██╔══╝██╔══██╗██║████╗  ██║██║╚══██╔══╝╚██╗ ██╔╝
   ██║   ██████╔╝██║██╔██╗ ██║██║   ██║    ╚████╔╝ 
   ██║   ██╔══██╗██║██║╚██╗██║██║   ██║     ╚██╔╝  
   ██║   ██║  ██║██║██║ ╚████║██║   ██║      ██║   
   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═╝   ╚═╝      ╚═╝   
 ████████╗██████╗ ███████╗███╗   ██╗██████╗ ███████╗
 ╚══██╔══╝██╔══██╗██╔════╝████╗  ██║██╔══██╗██╔════╝
    ██║   ██████╔╝█████╗  ██╔██╗ ██║██║  ██║███████╗
    ██║   ██╔══██╗██╔══╝  ██║╚██╗██║██║  ██║╚════██║
    ██║   ██║  ██║███████╗██║ ╚████║██████╔╝███████║
    ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚═════╝ ╚══════╝
                                    - A Pretty Trends Analyzer -
`;

async function main() {
  console.log(banner);
  console.log("===========================================================");
  console.log("   Installing Trinity Trends (Cross-Platform)");
  console.log("===========================================================\n");

  // 1. Environment Variable Setup
  console.log("[1/4] Configuring Environment...");
  const envPath = path.join(process.cwd(), '.env');
  const examplePath = path.join(process.cwd(), '.env.example');

  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, envPath);
    } else {
      fs.writeFileSync(envPath, 'GEMINI_API_KEY=\n');
    }
  }

  let envContent = fs.readFileSync(envPath, 'utf-8');
  
  const envVars = [
    { key: 'GEMINI_API_KEY', msg: 'Please enter your GEMINI_API_KEY (for analysis/transcription)' },
    { key: 'GROQ_API_KEY', msg: 'Please enter your GROQ_API_KEY (for Whisper audio transcription)' },
    { key: 'INSTAGRAM_USERNAME', msg: 'Please enter your INSTAGRAM_USERNAME (for scraping)' },
    { key: 'INSTAGRAM_PASSWORD', msg: 'Please enter your INSTAGRAM_PASSWORD (for scraping)' }
  ];

  for (const { key, msg } of envVars) {
    if (!envContent.includes(`${key}=`) || envContent.match(new RegExp(`${key}=\\s*(your_.*)?$`))) {
      console.log(`\n[!] ${key} is missing or default.`);
      const val = await ask(`${msg} (or press Enter to skip): `);
      if (val.trim()) {
        if (envContent.includes(`${key}=`)) {
          envContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${val.trim()}`);
        } else {
          envContent += `\n${key}=${val.trim()}\n`;
        }
        console.log(`[OK] ${key} saved.`);
      }
    } else {
      console.log(`[OK] ${key} is already configured.`);
    }
  }
  
  fs.writeFileSync(envPath, envContent);
  rl.close();

  // 2. Python Setup
  console.log("\n[2/4] Setting up Python Virtual Environment...");
  const isWin = process.platform === "win32";
  const pythonCmd = isWin ? "python" : "python3";
  const pipelineDir = path.join(process.cwd(), 'pipeline');
  const venvDir = path.join(pipelineDir, ".venv");

  try {
    if (!fs.existsSync(venvDir)) {
      run(`${pythonCmd} -m venv "${venvDir}"`);
    }
    const pipCmd = isWin ? path.join(venvDir, "Scripts", "pip") : path.join(venvDir, "bin", "pip");

    // Install depending on whether pyproject or requirements exists
    if (fs.existsSync(path.join(pipelineDir, 'pyproject.toml'))) {
      run(`"${pipCmd}" install -e .`, { cwd: pipelineDir });
    } else {
      run(`"${pipCmd}" install -r requirements.txt`, { cwd: pipelineDir });
    }
    console.log("[OK] Pipeline Python environment ready.");

    const igScraperDir = path.join(process.cwd(), 'ig_scraper');
    if (fs.existsSync(igScraperDir)) {
      const igVenvDir = path.join(igScraperDir, ".venv");
      if (!fs.existsSync(igVenvDir)) {
        run(`${pythonCmd} -m venv "${igVenvDir}"`);
      }
      const igPipCmd = isWin ? path.join(igVenvDir, "Scripts", "pip") : path.join(igVenvDir, "bin", "pip");
      const igPythonVenvCmd = isWin ? path.join(igVenvDir, "Scripts", "python") : path.join(igVenvDir, "bin", "python");

      if (fs.existsSync(path.join(igScraperDir, 'requirements.txt'))) {
        run(`"${igPipCmd}" install -r requirements.txt`, { cwd: igScraperDir });
      }
      if (fs.existsSync(path.join(igScraperDir, 'pyproject.toml'))) {
        run(`"${igPipCmd}" install -e .`, { cwd: igScraperDir });
      } else {
        // Install playwright browsers if playwright is there
        try {
          console.log("[INFO] Installing Playwright Chromium browser...");
          run(`"${igPythonVenvCmd}" -m playwright install chromium`, { cwd: igScraperDir });
        } catch (e) { }
      }
      console.log("[OK] ig_scraper Python environment ready.");
    }

  } catch (err) {
    console.error("[ERROR] Failed to setup Python environment. Do you have Python 3 installed?");
    process.exit(1);
  }

  // 3. Node Dependencies
  console.log("\n[3/4] Installing Node dependencies...");
  try {
    run("npm install --omit=dev");
    console.log("[OK] Node dependencies ready.");
  } catch (err) {
    console.error("[ERROR] Failed to install Node dependencies.");
    process.exit(1);
  }

  // 4. CLI Symlink
  console.log("\n[4/4] Setting up CLI tool ('trinity' command)...");
  try {
    // If not built, build it first just in case
    if (!fs.existsSync(path.join('dist', 'src', 'app', 'cli.js'))) {
      console.log("[*] Building TypeScript app...");
      run("npm install");
      run("npm run build");

      if (process.platform !== 'win32') {
        run("chmod +x dist/src/app/cli.js");
      }
    }

    // `npm link` handles global symlinking cross-platform (creating .cmd files for Windows)
    run("npm link");
    console.log("[OK] Added 'trinity' command globally!");
  } catch (err) {
    console.log("[WARNING] Could not run 'npm link' automatically (might need Administrator/sudo).");
    console.log("To make the command available globally, run: npm link");
  }

  console.log("\n===========================================================");
  console.log("[DONE] Installation complete!");
  console.log("You can now start the app from anywhere by typing: trinity");
  console.log("===========================================================\n");
}

main().catch(console.error);
