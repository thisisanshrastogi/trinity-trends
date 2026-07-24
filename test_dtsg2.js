import puppeteer from 'puppeteer';
import { join } from 'path';
import fs from 'fs';

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: join(process.cwd(), '.ig_profile'),
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
  const html = await page.content();
  fs.writeFileSync('ig_html.txt', html);
  await browser.close();
}
run();
