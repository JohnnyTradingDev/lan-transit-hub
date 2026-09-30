const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_DIR = path.join(__dirname, 'storage');
const BUFFET_FILE = path.join(STORAGE_DIR, 'buffet.json');

const VN_TEMPLATES = [
  "mới đọc quả tin này ảo ma thật sự mn ơi :)) {title} ai rành giải thích hộ phát",
  "thề luôn nhìn cái này cuốn vcl, {title} mn nghĩ sao nhờ",
  "u là trời :))) {title} dạo này lắm cái lạ thật chứ",
  "sáng ra lướt thấy tin này, {title} đỉnh k mn",
  "k biết mn thấy sao chứ tui thấy vụ này hơi bị ảo :)) {title}",
  "hết hồn chim én :)) {title} thật k vậy mn",
  "cái này mà thành hiện thực thì ngon phết nhờ mn {title}"
];

const EN_TEMPLATES = [
  "wait is this actually real lol... {title} thoughts on this?",
  "bruh no way {title} kinda wild ngl",
  "honestly didn't expect this to happen... {title}",
  "bro this is crazy tbh, {title} what do you guys think?",
  "ngl this looks insane lol {title}",
  "can we talk about this for a second? {title} thoughts?",
  "just saw this today, {title} kinda unexpected ngl"
];

const SHORT_TEMPLATES = [
  "{title} - Rate this 1 to 10? 👇",
  "Real or overhyped? {title} 👀",
  "{title} • What do you think?",
  "{title} 🤔 Thoughts?"
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCaptions(title, isVietnamese = false) {
  const cleanTitle = title.trim().replace(/\.$/, '');
  const vnBase = isVietnamese ? cleanTitle : cleanTitle;
  const enBase = isVietnamese ? cleanTitle : cleanTitle;

  return {
    vn: pickRandom(VN_TEMPLATES).replace('{title}', vnBase),
    en: pickRandom(EN_TEMPLATES).replace('{title}', enBase),
    short: pickRandom(SHORT_TEMPLATES).replace('{title}', cleanTitle)
  };
}

async function fetchRssFeed(url, sourceName, category, isVietnamese = false) {
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
    // Match Atom <entry> or RSS <item>
    const entries = [...xml.matchAll(/<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/g)];

    for (const entry of entries.slice(0, 15)) {
      const raw = entry[1];
      const titleMatch = raw.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>|<title[^>]*>(.*?)<\/title>/);
      const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
      if (!title || title.length < 10) continue;

      // Extract image
      const imgMatch = raw.match(/<img[^>]+src=\"([^\">]+)\"/i) || 
                       raw.match(/url=\"([^\">]+)\"/i) ||
                       raw.match(/<enclosure[^>]+url=\"([^\">]+)\"/i);
      let img = imgMatch ? imgMatch[1].replace(/&#038;/g, '&') : '';
      
      // Filter out small avatars/icons
      if (img.includes('avatar') || img.includes('logo_rss')) img = '';

      // Extract article link
      const linkMatch = raw.match(/<link[^>]+href=\"([^\">]+)\"/i) ||
                        raw.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>|<link>(.*?)<\/link>/);
      const link = linkMatch ? (linkMatch[1] || linkMatch[2] || '') : '';

      const id = 'buf-' + crypto.createHash('md5').update(title).digest('hex').slice(0, 10);
      const captions = generateCaptions(title, isVietnamese);

      items.push({
        id,
        title,
        source: sourceName,
        category,
        isVietnamese,
        imageUrl: img || null,
        articleUrl: link,
        captions,
        suggestedPlatforms: isVietnamese ? ['TikTok', 'Threads', 'Facebook'] : ['X', 'Reddit', 'Threads'],
        fetchedAt: new Date().toISOString()
      });
    }

    return items;
  } catch (e) {
    console.error(`Error fetching feed ${sourceName}:`, e.message);
    return [];
  }
}

async function refreshBuffet() {
  console.log('[Content Buffet] Scraping fresh trending news...');
  const feeds = [
    {
      url: 'https://vnexpress.net/rss/so-hoa.rss',
      source: 'VnExpress Tech',
      category: '💻 Công nghệ & AI',
      isVn: true
    },
    {
      url: 'https://vnexpress.net/rss/the-gioi.rss',
      source: 'VnExpress Thế Giới',
      category: '🌍 Tin Đời Sống',
      isVn: true
    },
    {
      url: 'https://www.theverge.com/rss/index.xml',
      source: 'The Verge',
      category: '🤖 Tech & Gadgets',
      isVn: false
    }
  ];

  const results = await Promise.all(
    feeds.map(f => fetchRssFeed(f.url, f.source, f.category, f.isVn))
  );

  const allItems = results.flat();
  // Deduplicate by ID
  const uniqueMap = new Map();
  allItems.forEach(item => {
    if (!uniqueMap.has(item.id)) {
      uniqueMap.set(item.id, item);
    }
  });

  const finalItems = Array.from(uniqueMap.values());
  try {
    fs.writeFileSync(BUFFET_FILE, JSON.stringify(finalItems, null, 2), 'utf8');
    console.log(`[Content Buffet] Updated buffet with ${finalItems.length} items.`);
  } catch (err) {
    console.error('Error saving buffet.json:', err);
  }

  return finalItems;
}

function getBuffetItems() {
  if (fs.existsSync(BUFFET_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(BUFFET_FILE, 'utf8'));
    } catch (e) {}
  }
  return [];
}

module.exports = {
  refreshBuffet,
  getBuffetItems
};
