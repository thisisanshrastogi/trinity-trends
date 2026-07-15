import fs from 'fs';
import path from 'path';
import os from 'os';

export interface TrinityConfig {
  topK: number;
  redditLimit: number;
  redditSort: string;
  redditTime: string;
  youtubeLimit: number;
  youtubeUploadDate: string;
  youtubeType: string;
  hackerNewsLimit: number;
  hackerNewsMinPoints: number;
  maxDocsPerCluster: number;
}

export const DEFAULT_CONFIG: TrinityConfig = {
  topK: 10,
  redditLimit: 10,
  redditSort: 'relevance',
  redditTime: 'month',
  youtubeLimit: 10,
  youtubeUploadDate: 'This year',
  youtubeType: 'Video',
  hackerNewsLimit: 10,
  hackerNewsMinPoints: 2,
  maxDocsPerCluster: 10
};

export class ConfigManager {
  private configPath: string;

  constructor() {
    const configDir = path.join(os.homedir(), '.trinity_trends');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    this.configPath = path.join(configDir, 'config.json');
  }

  load(): TrinityConfig {
    if (!fs.existsSync(this.configPath)) {
      this.save(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
    try {
      const data = fs.readFileSync(this.configPath, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    } catch (e) {
      return DEFAULT_CONFIG;
    }
  }

  save(config: TrinityConfig) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  async updatePythonConfig(maxDocs: number) {
    const { fileURLToPath } = await import('url');
    const { dirname } = await import('path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    let installRoot = __dirname;
    while (!fs.existsSync(path.join(installRoot, 'package.json')) && installRoot !== '/') {
      installRoot = path.dirname(installRoot);
    }
    
    const pyConfigPath = path.join(installRoot, 'pipeline', 'config.py');
    if (fs.existsSync(pyConfigPath)) {
      let content = fs.readFileSync(pyConfigPath, 'utf8');
      content = content.replace(/MAX_DOCS_PER_CLUSTER\s*=\s*\d+/, `MAX_DOCS_PER_CLUSTER = ${maxDocs}`);
      fs.writeFileSync(pyConfigPath, content, 'utf8');
    }
  }
}
