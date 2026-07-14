#!/usr/bin/env node
import { buildApp } from "./server.js";
import { loadConfig } from "./config.js";

async function main() {
  const app = buildApp();
  const config = loadConfig();

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
