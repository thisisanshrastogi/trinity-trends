import puppeteer from 'puppeteer';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Where we will save the Chrome profile so you stay logged in
const PROFILE_PATH = join(process.cwd(), '.ig_profile');

/**
 * 1. Launches a browser using a persistent profile.
 * 2. If not logged in, asks you to log in.
 * 3. Extracts cookies, CSRF token, and fb_dtsg.
 * 4. Saves them to a file for your scraper to use.
 */
async function authenticateInstagram() {
  console.log("🚀 Launching browser...");
  
  // Launch with a persistent user data directory
  const browser = await puppeteer.launch({
    headless: false, // Must be visible the first time to let you log in
    userDataDir: PROFILE_PATH,
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  console.log("🌐 Navigating to Instagram...");
  await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });

  // Check if we are logged in by looking for the "Log in" button text or checking the URL
  // Instagram often redirects to /accounts/login/ or shows a login form.
  const isLoggedIn = await page.evaluate(() => {
    // If the body text contains 'Log into Instagram' or we see a form with a password field, we aren't logged in
    const text = document.body.innerText;
    if (text.includes("Log into Instagram") || document.querySelector('input[type="password"]')) {
      return false;
    }
    return true;
  });

  if (!isLoggedIn) {
    console.log("⚠️ You are NOT logged in.");
    console.log("👉 Please log in to Instagram in the browser window.");
    console.log("⏳ Waiting for you to log in successfully...");
    
    // Wait for the password field to disappear (meaning login succeeded and navigated away)
    await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 0 });
    console.log("✅ Login detected! Waiting for page to load...");
    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
  } else {
    console.log("✅ Already logged in from previous session!");
  }

  console.log("🔍 Extracting session tokens...");

  // 1. Get Cookies
  const cookies = await page.cookies();
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  
  const csrfToken = cookies.find(c => c.name === 'csrftoken')?.value || '';

  // 2. Extract fb_dtsg and lsd by catching a live network request
  // This is 100% reliable since Instagram MUST send it to the server.
  let fbDtsg = '';
  let fbLsd = '';

  console.log("📡 Listening for Instagram API requests to capture tokens...");
  
  // We set up a listener for the next GraphQL request
  const tokenPromise = new Promise((resolve) => {
    browser.on('targetcreated', async (target) => {
      // Just in case it opens new targets
    });
  });

  // To force a GraphQL request, we can just navigate to the explore page
  // and intercept the requests as they happen
  await page.setRequestInterception(true);
  
  page.on('request', (req) => {
    if (req.url().includes('/api/graphql') && req.method() === 'POST') {
      const postData = req.postData() || '';
      const params = new URLSearchParams(postData);
      
      if (params.has('fb_dtsg')) fbDtsg = params.get('fb_dtsg');
      if (params.has('lsd')) fbLsd = params.get('lsd');
    }
    req.continue();
  });

  // Navigate to explore to trigger background GraphQL requests
  await page.goto('https://www.instagram.com/explore/', { waitUntil: 'networkidle2' });

  console.log("✨ Extraction complete!");
  console.log(`- CSRF Token: ${csrfToken ? "Found" : "Missing"}`);
  console.log(`- FB_DTSG: ${fbDtsg ? "Found" : "Missing"}`);
  console.log(`- LSD: ${fbLsd ? "Found" : "Missing"}`);

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

  await browser.close();
}

authenticateInstagram().catch(console.error);
