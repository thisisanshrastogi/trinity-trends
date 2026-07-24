import { writeFileSync, existsSync, readFileSync } from "fs";

// ─── Paste your full cookie string here ───
const INSTAGRAM_COOKIES = "datr=FCVdau7i8tAMPOkv7fPuhGqk; ig_did=8B41B558-3A78-4A0B-BB0D-DB6B4C8B5AF5; mid=al0lFAAEAAHbaSV64Gu2M0eKvFrI; dpr=1.96875; csrftoken=g6cleQ5zYUuioG25m3PEsOpAHr3jZTY0; ds_user_id=39121009267; sessionid=39121009267%3AVqaBGkNZBgxFUC%3A7%3AAYgqRGZzAGPluBzxa7EhOUnIbr6IlSIP8fp4YdyEfw; ps_l=1; ps_n=1; wd=671x645; rur=SNB%2C17841439158010126%2C1785741868%3A01ffb1fbe0d484c4eb85f192c2430a2b4d0068a8b3f548a7a2773987042d0213726f4abe";

// ─── Tokens extracted from your browser session ───
const CSRF_TOKEN = "g6cleQ5zYUuioG25m3PEsOpAHr3jZTY0";
const FB_LSD = "Kb7F49Tx0dpN1mgmdBYvFX";
const FB_DTSG =
  "NAfxUeYEELjDcSXq_ZQ4k9tfOpHzJASHAP8gz9lDPm_r9Ow7fRpvJ8w:17843729647189359:1784489397";

// ─── Topics to search (keyword search, not hashtags) ───
const TOPICS = [
  "robinhood credit card",
  "genz finance",
  "buy now pay later",
];

// ─── Backoff config ───
const BASE_DELAY_MS = 3000;       // 3s between requests
const MAX_DELAY_MS = 60000;       // cap at 60s
const MAX_RETRIES = 4;            // retry up to 4 times per topic
const JITTER_MS = 2000;           // random 0-2s jitter on top of delay

// ─── Helpers ───
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => Math.floor(Math.random() * JITTER_MS);

function buildPayload(query) {
  const sessionId = crypto.randomUUID();
  return new URLSearchParams({
    av: "17841439158010126",
    __d: "www",
    __user: "0",
    __a: "1",
    __req: "2",
    __hs: "20654.HYP:instagram_web_pkg.2.1...0",
    dpr: "1",
    __ccg: "EXCELLENT",
    __rev: "1043447744",
    __s: "rsffo9:aunn2k:e49cy1",
    __hsi: "7664507731115910485",
    __dyn:
      "7xeUjG1mxu1syawKBAg5S1Dxu13wvoKewSAwHwNw9G2Saxa0k24o0B-q1ew6ywMwto2awgo9oO0n24oaEnxO1ywOwv89k2C1FwnE6a0D85m263ifK0EUjwGzEaE2iwNwmE2eUlwhE2Lw62wLyES1TwVwDwHg2ZwrUK2K2WE5B08-269wr86C1mgO2m3zhA6bwg8rAwHxW1oxe0hibBK4o1lUG3a18whE984O0XEdoR0",
    __csr:
      "hYZY237hqkzsysOq4GTGh7O6pASlafBJ9dkOdhShbChbjGBKUSh4W8hvLCrBKIxF5Wmtmr9LaJGreVaVkBSydfJ9keCBHy9EG9CAy4aVXK4fUS8RGumF-yTmAaLVaJ122devDCG6o-iUxa2O2zQQcGegCiaDBz8mxuuvgZaiAqih6ALyFoJkm9x6ay9ES5HCx6muiueUWmu58rgy4QagjCy44E8o06560aww0Bnw0cNm0eNyU2sCw2Zo8pio0Jxw62w5SU1nF86Gcw1FS1Xw9xwFwAw74VNo3zw2IocE8oiOS0x4fAxy5hg74wmxO3C1Jye0c8Cg3VK01j7w0QMy4bDw68w0AzQ09Bxi",
    __comet_req: "7",
    fb_dtsg: FB_DTSG,
    jazoest: "26385",
    lsd: FB_LSD,
    __spin_r: "1043447744",
    __spin_b: "trunk",
    __spin_t: "1784532268",
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "PolarisKeywordSearchExplorePageRelayQuery",
    server_timestamps: "true",
    variables: JSON.stringify({
      query,
      search_session_id: sessionId,
      serp_session_id: sessionId,
    }),
    doc_id: "27384800401152681",
  });
}

const HEADERS = {
  accept: "*/*",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
  "content-type": "application/x-www-form-urlencoded",
  cookie: INSTAGRAM_COOKIES,
  origin: "https://www.instagram.com",
  referer: "https://www.instagram.com/explore/search/keyword/",
  "sec-ch-prefers-color-scheme": "dark",
  "sec-ch-ua":
    '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  "x-asbd-id": "359341",
  "x-csrftoken": CSRF_TOKEN,
  "x-fb-friendly-name": "PolarisKeywordSearchExplorePageRelayQuery",
  "x-fb-lsd": FB_LSD,
  "x-ig-app-id": "936619743392459",
};

/**
 * Extract media items from Instagram's GraphQL search response.
 */
function extractPosts(data) {
  const posts = [];
  try {
    const edges = data?.data?.xdt_fbsearch__top_serp_graphql?.edges ?? [];
    for (const edge of edges) {
      const items = edge?.node?.items ?? [];
      for (const item of items) {
        // Calculate engagement velocity (engagements per hour)
        const nowUnix = Math.floor(Date.now() / 1000);
        const hoursSincePosted = Math.max((nowUnix - (item.taken_at || nowUnix)) / 3600, 1);
        const totalEngagements = (item.like_count || 0) + (item.comment_count || 0);
        const velocity = parseFloat((totalEngagements / hoursSincePosted).toFixed(2));

        posts.push({
          pk: item.pk,
          code: item.code,
          media_type: item.media_type,
          username: item.user?.username,
          full_name: item.user?.full_name,
          width: item.original_width,
          height: item.original_height,
          caption: item.caption?.text,
          like_count: item.like_count || 0,
          comment_count: item.comment_count || 0,
          view_count: item.view_count || 0,
          taken_at: item.taken_at,
          engagement_velocity: velocity,
          url: `https://www.instagram.com/p/${item.code}/`,
        });
      }
    }
    
    // Sort posts by like_count descending to bubble the most trending to the top
    posts.sort((a, b) => b.like_count - a.like_count);
  } catch {
    // malformed response — return what we have
  }
  return posts;
}

/**
 * Search a single topic with exponential backoff + retry.
 */
async function searchTopic(topic, topicIdx) {
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    const delay =
      attempt === 0
        ? 0
        : Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS) +
        jitter();

    if (delay > 0) {
      console.log(
        `  [${topic}] Retry ${attempt}/${MAX_RETRIES} — backing off ${(delay / 1000).toFixed(1)}s`
      );
      await sleep(delay);
    }

    try {
      const res = await fetch("https://www.instagram.com/api/graphql", {
        method: "POST",
        headers: HEADERS,
        body: buildPayload(topic).toString(),
      });

      const text = await res.text();
      const json = text.replace(/^for \(;;\);/, "");
      const data = JSON.parse(json);

      // Check for Instagram-level errors
      if (data.error || data.errorSummary) {
        console.log(
          `  [${topic}] IG error ${data.error}: ${data.errorSummary}`
        );
        attempt++;
        continue;
      }

      // Temporarily save the raw response for the first topic so we can inspect it
      if (topicIdx === 0) {
        writeFileSync("raw_ig_response.json", JSON.stringify(data, null, 2));
      }

      const posts = extractPosts(data);
      console.log(
        `  [${topic}] OK — ${posts.length} posts found (HTTP ${res.status})`
      );

      return { topic, posts, postCount: posts.length, error: null };
    } catch (err) {
      console.log(`  [${topic}] Fetch error: ${err.message}`);
      attempt++;
    }
  }

  console.log(`  [${topic}] FAILED after ${MAX_RETRIES} retries`);
  return { topic, posts: [], postCount: 0, error: "max retries exceeded" };
}

// ─── Main ───
console.log(`\n=== Instagram Search Stress Test ===`);
console.log(`Topics: ${TOPICS.length} | Backoff: ${BASE_DELAY_MS / 1000}s base, ${MAX_DELAY_MS / 1000}s max | Retries: ${MAX_RETRIES}\n`);

const results = [];
const startTime = Date.now();

for (let i = 0; i < TOPICS.length; i++) {
  const topic = TOPICS[i];
  console.log(`[${i + 1}/${TOPICS.length}] Searching: ${topic}`);

  const result = await searchTopic(topic, i);
  results.push(result);

  // Polite delay between topics (skip after last one)
  if (i < TOPICS.length - 1) {
    const pauseMs = BASE_DELAY_MS + jitter();
    console.log(
      `  -- pausing ${(pauseMs / 1000).toFixed(1)}s before next topic --\n`
    );
    await sleep(pauseMs);
  }
}

// ─── Summary ───
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const totalPosts = results.reduce((sum, r) => sum + r.postCount, 0);
const succeeded = results.filter((r) => !r.error).length;
const failed = results.filter((r) => r.error).length;

console.log(`\n=== Results ===`);
console.log(`Elapsed: ${elapsed}s`);
console.log(`Succeeded: ${succeeded}/${TOPICS.length} | Failed: ${failed}`);
console.log(`Total posts collected: ${totalPosts}\n`);

for (const r of results) {
  const status = r.error ? `FAIL (${r.error})` : `${r.postCount} posts`;
  console.log(`  ${r.topic.padEnd(25)} ${status}`);
}

// ─── Save full results ───
writeFileSync("trawl_result.json", JSON.stringify(results, null, 2));
console.log(`\nFull results saved to trawl_result.json`);
