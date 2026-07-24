import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

/**
 * Connects to your already running Chrome via Chrome DevTools Protocol (CDP).
 * Assumes you launched Chrome with:
 *   google-chrome --remote-debugging-port=9222
 */
async function authenticateViaCDP() {
  console.log("🔌 Connecting to existing Chrome instance on port 9222...");
  
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null
    });
  } catch (err) {
    console.error("❌ Failed to connect to Chrome.");
    console.error("Make sure you closed all Chrome windows and launched it from the terminal using:");
    console.error("   google-chrome --remote-debugging-port=9222\n");
    process.exit(1);
  }

  console.log("✅ Connected! Finding or opening Instagram tab...");

  // Look for an existing Instagram tab, or open a new one
  const pages = await browser.pages();
  let igPage = pages.find(p => p.url().includes('instagram.com'));
  let createdNewPage = false;

  if (!igPage) {
    igPage = await browser.newPage();
    createdNewPage = true;
  } else {
    await igPage.bringToFront();
  }

  console.log("🔍 Extracting session tokens directly from your browser...");

  // 1. Get Cookies
  const cookies = await igPage.cookies('https://www.instagram.com');
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const csrfToken = cookies.find(c => c.name === 'csrftoken')?.value || '';

  // 2. Extract fb_dtsg and lsd via network interception
  let fbDtsg = '';
  let fbLsd = '';

  console.log("📡 Listening for Instagram API requests to capture tokens...");
  await igPage.setRequestInterception(true);
  
  igPage.on('request', (req) => {
    if (req.url().includes('/api/graphql') && req.method() === 'POST') {
      const postData = req.postData() || '';
      const params = new URLSearchParams(postData);
      
      if (params.has('fb_dtsg')) fbDtsg = params.get('fb_dtsg');
      if (params.has('lsd')) fbLsd = params.get('lsd');
    }
    req.continue();
  });

  // Navigate to explore to trigger background GraphQL requests
  await igPage.goto('https://www.instagram.com/explore/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  console.log("✨ Extraction complete!");
  console.log(`- CSRF Token: ${csrfToken ? "Found" : "Missing"}`);
  console.log(`- FB_DTSG: ${fbDtsg ? "Found" : "Missing"}`);
  console.log(`- LSD: ${fbLsd ? "Found" : "Missing"}`);

  if (!csrfToken || !fbDtsg) {
    console.log("⚠️ WARNING: Could not find all tokens. Are you fully logged into Instagram in this browser?");
  }

  // 3. Save to a config file
  const config = {
    INSTAGRAM_COOKIES: cookieString,
    CSRF_TOKEN: csrfToken,
    FB_DTSG: fbDtsg,
    FB_LSD: fbLsd,
    UPDATED_AT: new Date().toISOString()
  };

  writeFileSync('ig_session.json', JSON.stringify(config, null, 2));
  console.log("\n💾 Saved to 'ig_session.json'. Your scraper can now read this file!");

  // Clean up
  await igPage.setRequestInterception(false);
  if (createdNewPage) {
    await igPage.close();
  }

  // We only close the page if we opened it, so we don't disrupt your browsing
  browser.disconnect();
  console.log("👋 Disconnected from Chrome.");
}

authenticateViaCDP().catch(console.error);
