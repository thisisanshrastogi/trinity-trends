import puppeteer from 'puppeteer';
import { join } from 'path';

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: join(process.cwd(), '.ig_profile'),
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
  const html = await page.content();
  console.log("HTML length:", html.length);
  
  const dtsgMatch = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/);
  console.log("DTSGMatch:", dtsgMatch ? dtsgMatch[1] : 'not found');
  
  const lsdMatch = html.match(/"LSD",\[\],\{"token":"([^"]+)"/);
  console.log("LSDMatch:", lsdMatch ? lsdMatch[1] : 'not found');

  await browser.close();
}
run();
