const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATUSES = ['draft', 'ready', 'sent', 'posted', 'archived'];
const TRANSITIONS = {
  draft: ['draft', 'ready', 'archived'],
  ready: ['ready', 'draft', 'sent', 'archived'],
  sent: ['sent', 'ready', 'posted', 'archived'],
  posted: ['posted', 'archived'],
  archived: ['archived']
};

function cleanText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function cleanUrl(value) {
  const raw = cleanText(value, 2000);
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('URL không hợp lệ');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL chỉ được dùng http hoặc https');
  }
  return parsed.toString();
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`[Content Workflow] Cannot read ${path.basename(file)}:`, error.message);
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function createContentWorkflow(storageDir) {
  const routesFile = path.join(storageDir, 'content_routes.json');
  const queueFile = path.join(storageDir, 'content_queue.json');

  function getRoutes() {
    const routes = readJson(routesFile, []);
    return Array.isArray(routes) ? routes : [];
  }

  function saveRoutes(routes) {
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new Error('Cần ít nhất một tuyến nội dung');
    }
    const normalized = routes.map((route) => ({
      id: cleanText(route.id, 60).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      name: cleanText(route.name, 120),
      deviceLabel: cleanText(route.deviceLabel, 120),
      matchKeywords: Array.isArray(route.matchKeywords)
        ? route.matchKeywords.map((v) => cleanText(v, 60).toLowerCase()).filter(Boolean)
        : [],
      platforms: Array.isArray(route.platforms)
        ? route.platforms.map((v) => cleanText(v, 30).toLowerCase()).filter(Boolean)
        : [],
      promise: cleanText(route.promise, 500),
      style: cleanText(route.style, 500),
      nurtureCadence: cleanText(route.nurtureCadence, 200),
      dailyBaseline: cleanText(route.dailyBaseline, 300),
      formats: Array.isArray(route.formats)
        ? route.formats.map((v) => cleanText(v, 120)).filter(Boolean)
        : [],
      pillars: Array.isArray(route.pillars) ? route.pillars.slice(0, 10) : [],
      weeklyMix: route.weeklyMix && typeof route.weeklyMix === 'object' ? route.weeklyMix : {},
      disclosure: cleanText(route.disclosure, 300),
      guardrails: Array.isArray(route.guardrails)
        ? route.guardrails.map((v) => cleanText(v, 300)).filter(Boolean)
        : []
    }));
    if (normalized.some((route) => !route.id || !route.name)) {
      throw new Error('Mỗi tuyến cần id và tên');
    }
    if (new Set(normalized.map((route) => route.id)).size !== normalized.length) {
      throw new Error('ID tuyến nội dung không được trùng');
    }
    writeJson(routesFile, normalized);
    return normalized;
  }

  function getQueue(filters = {}) {
    let queue = readJson(queueFile, []);
    if (!Array.isArray(queue)) queue = [];
    if (filters.status && STATUSES.includes(filters.status)) {
      queue = queue.filter((item) => item.status === filters.status);
    }
    if (filters.routeId) queue = queue.filter((item) => item.routeId === filters.routeId);
    return queue.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function saveQueue(queue) {
    writeJson(queueFile, queue);
  }

  function createItem(input) {
    const routes = getRoutes();
    const routeId = cleanText(input.routeId, 60);
    const route = routes.find((candidate) => candidate.id === routeId);
    if (!route) throw new Error('Tuyến nội dung không tồn tại');

    const platform = cleanText(input.platform, 30).toLowerCase();
    if (!route.platforms.includes(platform)) {
      throw new Error('Nền tảng không thuộc tuyến nội dung này');
    }

    const title = cleanText(input.title, 240);
    const caption = cleanText(input.caption, 5000);
    if (!title || !caption) throw new Error('Cần tiêu đề nội bộ và caption');

    const now = new Date().toISOString();
    const item = {
      id: `content-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      routeId,
      platform,
      title,
      caption,
      sourceUrl: cleanUrl(input.sourceUrl),
      mediaNote: cleanText(input.mediaNote, 500),
      bingxRelated: Boolean(input.bingxRelated),
      disclosure: Boolean(input.bingxRelated) ? (cleanText(input.disclosure, 300) || route.disclosure) : '',
      status: 'draft',
      targetDeviceId: '',
      targetDeviceName: '',
      postUrl: '',
      views24h: null,
      views7d: null,
      createdAt: now,
      updatedAt: now,
      sentAt: null,
      postedAt: null
    };
    const queue = getQueue();
    queue.unshift(item);
    saveQueue(queue);
    return item;
  }

  function updateItem(id, changes) {
    const queue = getQueue();
    const index = queue.findIndex((item) => item.id === id);
    if (index === -1) throw new Error('Không tìm thấy nội dung');
    const item = queue[index];

    if (changes.status) {
      const next = cleanText(changes.status, 20);
      if (!STATUSES.includes(next) || !TRANSITIONS[item.status].includes(next)) {
        throw new Error(`Không thể chuyển từ ${item.status} sang ${next}`);
      }
      item.status = next;
      if (next === 'posted' && !item.postedAt) item.postedAt = new Date().toISOString();
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'caption')) {
      const caption = cleanText(changes.caption, 5000);
      if (!caption) throw new Error('Caption không được để trống');
      item.caption = caption;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'postUrl')) item.postUrl = cleanUrl(changes.postUrl);
    if (Object.prototype.hasOwnProperty.call(changes, 'views24h')) item.views24h = numberOrNull(changes.views24h);
    if (Object.prototype.hasOwnProperty.call(changes, 'views7d')) item.views7d = numberOrNull(changes.views7d);
    item.updatedAt = new Date().toISOString();
    queue[index] = item;
    saveQueue(queue);
    return item;
  }

  function markSent(id, device) {
    const queue = getQueue();
    const index = queue.findIndex((item) => item.id === id);
    if (index === -1) throw new Error('Không tìm thấy nội dung');
    const item = queue[index];
    if (!['ready', 'sent'].includes(item.status)) {
      throw new Error('Phải duyệt nội dung trước khi gửi sang Android');
    }
    item.status = 'sent';
    item.targetDeviceId = cleanText(device.id, 200);
    item.targetDeviceName = cleanText(device.name, 200);
    item.sentAt = new Date().toISOString();
    item.updatedAt = item.sentAt;
    queue[index] = item;
    saveQueue(queue);
    return item;
  }

  function getStats() {
    const queue = getQueue();
    return STATUSES.reduce((result, status) => {
      result[status] = queue.filter((item) => item.status === status).length;
      return result;
    }, { total: queue.length });
  }

  return { getRoutes, saveRoutes, getQueue, createItem, updateItem, markSent, getStats };
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Lượt xem phải là số không âm');
  return Math.round(number);
}

module.exports = { createContentWorkflow, STATUSES, TRANSITIONS };
