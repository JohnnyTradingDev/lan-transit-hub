const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_DIR = path.join(__dirname, 'storage');
const BUFFET_FILE = path.join(STORAGE_DIR, 'buffet.json');
const DISMISSED_FILE = path.join(STORAGE_DIR, 'buffet_dismissed.json');

// Authentic Gen Z / Casual English Slang (X & Reddit vibe)
const CASUAL_TEMPLATES = [
  "ngl this is actually crazy lol: {title}",
  "bruh no way {title} 💀",
  "wait is this actually real... {title} kinda wild ngl",
  "honestly didn't have this on my 2026 bingo card: {title}",
  "bro this is insane tbh, {title}",
  "lowkey didn't expect this at all: {title}",
  "ain't no way {title} 😭",
  "can we talk about this for a second? {title}",
  "this feels like a simulation at this point lol: {title}",
  "nah because why is nobody talking about this: {title}",
  "just saw this today, kinda speechless ngl: {title}",
  "bro what is happening in 2026 💀 {title}"
];

// Comment & Karma Bait / Discussion Starters (High engagement for Reddit & TikTok)
const DEBATE_TEMPLATES = [
  "{title} - thoughts on this? 👇",
  "Real or overhyped? {title} 👀",
  "{title} • W or L?",
  "What would you do in this situation? {title}",
  "Is it just me or does this sound wild? {title} 🤔",
  "Rate this from 1 to 10: {title} 👇",
  "Valid or completely unnecessary? {title}",
  "Hot take on this? {title} 👀",
  "Would you try this? {title} 🤔"
];

// Short & Snappy / Relatable (Instagram, YouTube Shorts, X vibe)
const SHORT_TEMPLATES = [
  "{title} 💀",
  "New fear unlocked: {title}",
  "{title} 👀",
  "The way I didn't see this coming lmao: {title}",
  "Wait what... {title}",
  "In case you missed it: {title}",
  "This is wild: {title}",
  "No words. {title} 🤐"
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function cleanHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8230;/g, '...')
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

const VIRAL_KEYWORDS = [
  'break', 'breaks', 'record', 'leak', 'leaks', 'announced', 'announces', 'reveals', 'revealed',
  'insane', 'wild', 'secret', 'ban', 'banned', 'update', 'shock', 'shocking', 'first look',
  'gta', 'steam', 'nvidia', 'apple', 'iphone', 'ai', 'robot', 'viral', 'drama', 'game of the year',
  'trailer', 'launch', 'worst', 'best', 'million', 'billion', 'chatgpt', 'gemini', 'deepseek',
  'tiktok', 'warning', 'finally', 'free', 'crazy', 'shut down', 'cancel', 'huge', 'unreal', 'new',
  'confirms', 'drops', 'epic', 'ruins', 'genius', 'masterpiece', 'flaw', 'fails', 'vs', 'fight'
];

function calculateHotScore(title) {
  let score = 78;
  const lower = (title || '').toLowerCase();
  VIRAL_KEYWORDS.forEach(kw => {
    if (lower.includes(kw)) score += 4;
  });
  if (/\d+/.test(title)) score += 3;
  if (title.length >= 35 && title.length <= 95) score += 3;
  if (/[?!]/.test(title)) score += 2;
  return Math.min(99, Math.max(76, score));
}

function generateCaptions(title) {
  const cleanTitle = cleanHtmlEntities(title).replace(/\.$/, '');

  return {
    casual: pickRandom(CASUAL_TEMPLATES).replace('{title}', cleanTitle),
    debate: pickRandom(DEBATE_TEMPLATES).replace('{title}', cleanTitle),
    short: pickRandom(SHORT_TEMPLATES).replace('{title}', cleanTitle)
  };
}

function getDismissedMap() {
  if (fs.existsSync(DISMISSED_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DISMISSED_FILE, 'utf8'));
    } catch (e) {}
  }
  return {};
}

function saveDismissedMap(map) {
  try {
    fs.writeFileSync(DISMISSED_FILE, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving buffet_dismissed.json:', e);
  }
}

function dismissItem(itemId, reason = 'deleted', itemData = null) {
  const map = getDismissedMap();
  let found = itemData;

  // Remove from buffet.json
  if (fs.existsSync(BUFFET_FILE)) {
    try {
      const items = JSON.parse(fs.readFileSync(BUFFET_FILE, 'utf8'));
      if (!found) {
        found = items.find(i => i.id === itemId);
      }
      const filtered = items.filter(i => i.id !== itemId);
      fs.writeFileSync(BUFFET_FILE, JSON.stringify(filtered, null, 2), 'utf8');
    } catch (e) {}
  }

  map[itemId] = {
    dismissedAt: new Date().toISOString(),
    reason,
    item: found || null
  };
  saveDismissedMap(map);
  return true;
}

function restoreItem(itemId) {
  const map = getDismissedMap();
  const record = map[itemId];
  if (!record) return false;

  const restoredItem = record.item;
  delete map[itemId];
  saveDismissedMap(map);

  if (restoredItem && fs.existsSync(BUFFET_FILE)) {
    try {
      const items = JSON.parse(fs.readFileSync(BUFFET_FILE, 'utf8'));
      if (!items.some(i => i.id === itemId)) {
        items.unshift(restoredItem);
        fs.writeFileSync(BUFFET_FILE, JSON.stringify(items, null, 2), 'utf8');
      }
    } catch (e) {}
  }
  return true;
}

function getDismissedItems() {
  const map = getDismissedMap();
  const list = [];
  for (const [id, data] of Object.entries(map)) {
    if (data.item) {
      list.push({
        ...data.item,
        dismissedAt: data.dismissedAt,
        dismissReason: data.reason
      });
    } else {
      list.push({
        id,
        title: '(Dismissed Post)',
        dismissedAt: data.dismissedAt,
        dismissReason: data.reason
      });
    }
  }
  return list.sort((a, b) => new Date(b.dismissedAt) - new Date(a.dismissedAt));
}

async function fetchRssFeed(url, sourceName, category) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const items = [];
    const entries = [...xml.matchAll(/<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g)];

    for (const entry of entries.slice(0, 15)) {
      const raw = entry[1];
      const titleMatch = raw.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>|<title[^>]*>(.*?)<\/title>/);
      let title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
      title = cleanHtmlEntities(title);
      if (!title || title.length < 8) continue;

      // Extract image: supports media:content, media:thumbnail, enclosure, and img tag
      const imgMatch = raw.match(/<media:content[^>]+url=\"([^\">]+)\"/i) ||
                       raw.match(/<media:thumbnail[^>]+url=\"([^\">]+)\"/i) ||
                       raw.match(/<enclosure[^>]+url=\"([^\">]+)\"/i) ||
                       raw.match(/<img[^>]+src=\"([^\">]+)\"/i);
      let img = imgMatch ? imgMatch[1].replace(/&#038;|&amp;/g, '&') : '';
      
      // Require valid image for social media posting
      if (!img) continue;

      // Extract article link
      const linkMatch = raw.match(/<link[^>]+href=\"([^\">]+)\"/i) ||
                        raw.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>|<link>(.*?)<\/link>/);
      const link = linkMatch ? (linkMatch[1] || linkMatch[2] || '') : '';

      const id = 'buf-' + crypto.createHash('md5').update(title).digest('hex').slice(0, 10);
      const captions = generateCaptions(title);
      const hotScore = calculateHotScore(title);

      items.push({
        id,
        title,
        source: sourceName,
        category,
        isVietnamese: false,
        imageUrl: img,
        articleUrl: link,
        captions,
        hotScore,
        suggestedPlatforms: ['X/Twitter', 'Reddit', 'Instagram', 'TikTok'],
        fetchedAt: new Date().toISOString()
      });
    }

    // Sort by hotScore descending and return only top 4 hottest posts per source
    items.sort((a, b) => b.hotScore - a.hotScore);
    return items.slice(0, 4);
  } catch (e) {
    console.error(`Error fetching feed ${sourceName}:`, e.message);
    return [];
  }
}

async function refreshBuffet() {
  console.log('[Content Buffet] Scraping fresh 100% English trending news (Hot Curated)...');
  const feeds = [
    {
      url: 'https://www.theverge.com/rss/index.xml',
      source: 'The Verge',
      category: '💻 Tech & AI'
    },
    {
      url: 'https://www.dexerto.com/feed/',
      source: 'Dexerto',
      category: '🌐 Viral & Culture'
    },
    {
      url: 'https://9to5mac.com/feed/',
      source: '9to5Mac',
      category: '💻 Tech & AI'
    },
    {
      url: 'https://www.boredpanda.com/feed/',
      source: 'Bored Panda',
      category: '🐾 Life & Stories'
    },
    {
      url: 'https://www.gamesradar.com/rss/',
      source: 'GamesRadar',
      category: '🎮 Gaming & Pop'
    }
  ];

  const results = await Promise.all(
    feeds.map(f => fetchRssFeed(f.url, f.source, f.category))
  );

  const allItems = results.flat();
  const uniqueMap = new Map();
  allItems.forEach(item => {
    if (!uniqueMap.has(item.id)) {
      uniqueMap.set(item.id, item);
    }
  });

  const dismissedMap = getDismissedMap();
  // Filter out any dismissed or posted IDs, sort by highest hotScore
  const finalItems = Array.from(uniqueMap.values())
    .filter(item => !dismissedMap[item.id])
    .sort((a, b) => (b.hotScore || 75) - (a.hotScore || 75))
    .slice(0, 20); // Cap total buffet to top 20 items max

  try {
    fs.writeFileSync(BUFFET_FILE, JSON.stringify(finalItems, null, 2), 'utf8');
    console.log(`[Content Buffet] Updated curated buffet with ${finalItems.length} top hot English items (${Object.keys(dismissedMap).length} dismissed/hidden).`);
  } catch (err) {
    console.error('Error saving buffet.json:', err);
  }

  return finalItems;
}

function getBuffetItems(includeDismissed = false) {
  if (fs.existsSync(BUFFET_FILE)) {
    try {
      const items = JSON.parse(fs.readFileSync(BUFFET_FILE, 'utf8'));
      if (includeDismissed) return items;
      const dismissedMap = getDismissedMap();
      return items.filter(i => !dismissedMap[i.id]);
    } catch (e) {}
  }
  return [];
}

module.exports = {
  refreshBuffet,
  getBuffetItems,
  dismissItem,
  restoreItem,
  getDismissedItems
};
