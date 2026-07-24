import puppeteer from 'puppeteer';
import { join } from 'path';

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: join(process.cwd(), '.ig_profile'),
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: 'ig_screenshot.png' });
  await browser.close();
}
run();
