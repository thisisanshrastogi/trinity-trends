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

async function main() {
  console.log("======================================");
  console.log("🚀 Installing Trinity Trends (Cross-Platform)");
  console.log("======================================\n");

  // 1. Environment Variable Setup
  console.log("⚙️  Configuring Environment...");
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
  if (!envContent.includes('GEMINI_API_KEY=') || envContent.includes('GEMINI_API_KEY=your_gemini_api_key_here') || envContent.match(/GEMINI_API_KEY=\s*$/)) {
    console.log("\n🔑 Gemini API Key is missing or default.");
    const key = await ask("Please enter your GEMINI_API_KEY (or press Enter to skip): ");
    if (key.trim()) {
      if (envContent.includes('GEMINI_API_KEY=')) {
        envContent = envContent.replace(/GEMINI_API_KEY=.*/, `GEMINI_API_KEY=${key.trim()}`);
      } else {
        envContent += `\nGEMINI_API_KEY=${key.trim()}\n`;
      }
      fs.writeFileSync(envPath, envContent);
      console.log("✅ GEMINI_API_KEY saved to .env");
    }
  } else {
    console.log("✅ GEMINI_API_KEY is already configured.");
  }
  rl.close();

  // 2. Python Setup
  console.log("\n🐍 Setting up Python Virtual Environment...");
  const isWin = process.platform === "win32";
  const pythonCmd = isWin ? "python" : "python3";
  const venvDir = path.join("pipeline", ".venv");
  
  try {
    if (!fs.existsSync(venvDir)) {
      run(`${pythonCmd} -m venv ${venvDir}`);
    }
    const pipCmd = isWin ? path.join(venvDir, "Scripts", "pip") : path.join(venvDir, "bin", "pip");
    
    // Install depending on whether pyproject or requirements exists
    const pipelineDir = path.join(process.cwd(), 'pipeline');
    if (fs.existsSync(path.join(pipelineDir, 'pyproject.toml'))) {
      run(`"${pipCmd}" install -e .`, { cwd: pipelineDir });
    } else {
      run(`"${pipCmd}" install -r requirements.txt`, { cwd: pipelineDir });
    }
    console.log("✅ Python environment ready.");
  } catch (err) {
    console.error("❌ Failed to setup Python environment. Do you have Python 3 installed?");
    process.exit(1);
  }

  // 3. Node Dependencies
  console.log("\n📦 Installing Node dependencies...");
  try {
    run("npm install --omit=dev");
    console.log("✅ Node dependencies ready.");
  } catch (err) {
    console.error("❌ Failed to install Node dependencies.");
    process.exit(1);
  }

  // 4. CLI Symlink
  console.log("\n🔗 Setting up CLI tool ('trinity' command)...");
  try {
    // If not built, build it first just in case
    if (!fs.existsSync(path.join('dist', 'app', 'bootstrap.js'))) {
        console.log("🔨 Building TypeScript app...");
        run("npm install");
        run("npm run build");
    }

    // `npm link` handles global symlinking cross-platform (creating .cmd files for Windows)
    run("npm link");
    console.log("✅ Added 'trinity' command globally!");
  } catch (err) {
    console.log("⚠️ Could not run 'npm link' automatically (might need Administrator/sudo).");
    console.log("To make the command available globally, run: npm link");
  }

  console.log("\n======================================");
  console.log("🎉 Installation complete!");
  console.log("You can now start the app from anywhere by typing: trinity");
  console.log("======================================\n");
}

main().catch(console.error);
