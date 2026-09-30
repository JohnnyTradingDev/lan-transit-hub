const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const qrcode = require('qrcode');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const feeder = require('./feeder');

const PORT = process.env.PORT || 7777;
const STORAGE_DIR = path.join(__dirname, 'storage');
const HISTORY_FILE = path.join(STORAGE_DIR, 'history.json');
const MAX_HISTORY = 200;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Load or initialize history
let history = [];
if (fs.existsSync(HISTORY_FILE)) {
  try {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (err) {
    console.error('Error reading history.json, resetting:', err);
    history = [];
  }
}

function cleanupExpiredHistory() {
  const now = Date.now();
  let changed = false;

  // Filter history items older than 7 days
  const validHistory = [];
  for (const item of history) {
    const itemTime = item.timestamp ? new Date(item.timestamp).getTime() : 0;
    if (now - itemTime > RETENTION_MS) {
      changed = true;
      if (item.file && item.file.filename) {
        const fp = path.join(STORAGE_DIR, item.file.filename);
        if (fs.existsSync(fp)) {
          fs.unlink(fp, () => {});
        }
      }
    } else {
      validHistory.push(item);
    }
  }

  if (changed) {
    history = validHistory;
    saveHistory();
    console.log('[Auto-Cleanup] Removed items older than 7 days.');
  }

  // Also clean up any unreferenced files in storage/ directory older than 7 days
  fs.readdir(STORAGE_DIR, (err, files) => {
    if (err || !files) return;
    const activeFilenames = new Set(
      history.filter(h => h.file && h.file.filename).map(h => h.file.filename)
    );
    activeFilenames.add('history.json');
    activeFilenames.add('.gitkeep');

    files.forEach(f => {
      if (!activeFilenames.has(f)) {
        const fp = path.join(STORAGE_DIR, f);
        fs.stat(fp, (err, stats) => {
          if (!err && stats && (now - stats.mtimeMs > RETENTION_MS)) {
            fs.unlink(fp, () => {});
          }
        });
      }
    });
  });
}

// Run cleanup immediately and then periodically every 30 minutes
cleanupExpiredHistory();
setInterval(cleanupExpiredHistory, 30 * 60 * 1000);

function saveHistory() {
  try {
    if (history.length > MAX_HISTORY) {
      const removed = history.splice(MAX_HISTORY);
      // Clean up orphaned files
      removed.forEach(item => {
        if (item.file && item.file.filename) {
          const fp = path.join(STORAGE_DIR, item.file.filename);
          if (fs.existsSync(fp)) fs.unlink(fp, () => {});
        }
      });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving history:', err);
  }
}

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, STORAGE_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10 GB limit per file
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const net = require('net');

function checkPort(port, host = '127.0.0.1', timeout = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

// 1. Reverse Proxy RedNote Downloader APIs to port 5556 (Before body parsers!)
const xhsProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:5556',
  changeOrigin: true
});
app.use((req, res, next) => {
  const xhsPaths = [
    '/api/server-info',
    '/api/cookie',
    '/api/parse',
    '/api/download-zip',
    '/api/proxy-image',
    '/api/proxy-video'
  ];
  if (xhsPaths.some(p => req.path.startsWith(p))) {
    return xhsProxy(req, res, next);
  }
  next();
});

// 2. Serve RedNote Downloader Web App on /rednote
app.get('/rednote', (req, res) => {
  const xhsWeb = '/home/johnny/projects/XHS-Downloader/web/index.html';
  if (fs.existsSync(xhsWeb)) {
    res.sendFile(xhsWeb);
  } else {
    res.status(404).send('RedNote Downloader Web UI not found on server');
  }
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Active WebSocket clients: ws => { deviceId, name, type, ip, joinedAt }
const clients = new Map();
// Known registered devices cache: deviceId => { id, name, type, ip, isOnline, lastSeen }
const knownDevices = new Map();

function getLanIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, ip: iface.address });
      }
    }
  }
  return ips;
}

function broadcastDeviceList() {
  const activeDeviceIds = new Set();
  const onlineDevices = [];

  for (const info of clients.values()) {
    if (!activeDeviceIds.has(info.deviceId)) {
      activeDeviceIds.add(info.deviceId);
      onlineDevices.push({
        id: info.deviceId,
        name: info.name,
        type: info.type,
        ip: info.ip,
        isOnline: true,
        lastSeen: new Date().toISOString()
      });
    }
  }

  // Update known devices
  onlineDevices.forEach(d => knownDevices.set(d.id, d));

  const allDevices = Array.from(knownDevices.values()).map(d => ({
    ...d,
    isOnline: activeDeviceIds.has(d.id)
  }));

  const msg = JSON.stringify({ type: 'devices_update', devices: allDevices });
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// WebSocket logic
wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'register') {
        const clientInfo = {
          deviceId: data.deviceId || 'dev-' + Math.random().toString(36).substr(2, 9),
          name: data.name || 'New Device',
          type: data.deviceType || 'unknown',
          ip: ip.replace(/^.*:/, ''), // clean ipv6 localhost prefix
          joinedAt: new Date().toISOString()
        };
        clients.set(ws, clientInfo);
        knownDevices.set(clientInfo.deviceId, {
          id: clientInfo.deviceId,
          name: clientInfo.name,
          type: clientInfo.type,
          ip: clientInfo.ip,
          isOnline: true,
          lastSeen: new Date().toISOString()
        });
        broadcastDeviceList();
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastDeviceList();
  });

  ws.on('error', () => {
    clients.delete(ws);
    broadcastDeviceList();
  });
});

// Broadcast item to target
function dispatchItem(item) {
  history.unshift(item);
  saveHistory();

  const msg = JSON.stringify({ type: 'item_received', item });

  for (const [ws, info] of clients.entries()) {
    if (ws.readyState !== WebSocket.OPEN) continue;

    if (item.target === 'all') {
      ws.send(msg);
    } else if (item.target === info.deviceId || item.senderId === info.deviceId) {
      ws.send(msg);
    }
  }
}

// API Routes
app.get('/api/info', async (req, res) => {
  const ips = getLanIps();
  const primary = ips.find(i => i.ip.startsWith('192.168.')) || ips[0] || { ip: 'localhost' };
  const tailscale = ips.find(i => i.name === 'tailscale0' || i.ip.startsWith('100.'));
  const serverUrl = `http://${primary.ip}:${PORT}`;
  const tailscaleUrl = tailscale ? `http://${tailscale.ip}:${PORT}` : null;
  let qrCodeDataUrl = '';
  let qrTailscaleDataUrl = '';
  try {
    qrCodeDataUrl = await qrcode.toDataURL(serverUrl, { margin: 2, scale: 6 });
    if (tailscaleUrl) {
      qrTailscaleDataUrl = await qrcode.toDataURL(tailscaleUrl, { margin: 2, scale: 6 });
    }
  } catch (e) {}

  res.json({
    port: PORT,
    primaryIp: primary.ip,
    tailscaleIp: tailscale ? tailscale.ip : null,
    allIps: ips,
    serverUrl,
    tailscaleUrl,
    qrCode: qrCodeDataUrl,
    qrTailscale: qrTailscaleDataUrl
  });
});

app.get('/api/server-tools', async (req, res) => {
  const reqHost = req.hostname || (req.headers.host ? req.headers.host.split(':')[0] : 'localhost');
  const ips = getLanIps();
  const primary = ips.find(i => i.ip.startsWith('192.168.')) || ips[0] || { ip: 'localhost' };
  const tailscale = ips.find(i => i.name === 'tailscale0' || i.ip.startsWith('100.'));
  const tsHost = tailscale ? tailscale.ip : null;

  const toolDefs = [
    {
      id: 'lan-transit',
      name: 'LAN Transit Hub',
      category: 'Core System',
      icon: '⚡',
      port: 7777,
      path: '#transit',
      description: 'Zero-click local device file & text relay',
      isIntegrated: true,
      tag: 'Integrated Hub'
    },
    {
      id: 'post-buffet',
      name: 'Content Buffet & 1-Tap Feeder',
      category: 'Media Tools',
      icon: '🍱',
      port: 7777,
      path: '#buffet',
      description: 'Hot news + natural human captions for phone farming with 1-tap push',
      isIntegrated: true,
      tag: '1-Tap Push'
    },
    {
      id: 'rednote',
      name: 'RedNote Downloader',
      category: 'Media Tools',
      icon: '📕',
      port: 5556,
      path: '/rednote',
      description: 'Download Xiaohongshu (RedNote) videos & HD photos watermark-free',
      isIntegrated: true,
      tag: 'Integrated on 7777'
    },
    {
      id: 'crypto-hub',
      name: 'Crypto Autopost Hub',
      category: 'Trading & Bot',
      icon: '🪙',
      port: 8080,
      path: '/',
      description: 'Automated crypto trading signals & social poster',
      isIntegrated: false,
      tag: 'Port 8080'
    },
    {
      id: 'prompt-manager',
      name: 'Prompt Manager Studio',
      category: 'AI & Templates',
      icon: '📝',
      port: 4000,
      path: '/',
      description: 'System prompts manager & AI playground',
      isIntegrated: false,
      tag: 'Port 4000'
    },
    {
      id: 'manager-email',
      name: 'Email Operations Hub',
      category: 'Automation',
      icon: '📧',
      port: 3000,
      path: '/',
      description: 'Automated inbox manager and notifier dashboard',
      isIntegrated: false,
      tag: 'Port 3000'
    },
    {
      id: 'yensaotamhieu',
      name: 'Yến Sào Tâm Hiếu',
      category: 'E-Commerce',
      icon: '🕊️',
      port: 3001,
      path: '/',
      description: 'Online store and product catalog system',
      isIntegrated: false,
      tag: 'Port 3001'
    },
    {
      id: 'lili-dashboard',
      name: 'Lili Dashboard',
      category: 'Monitoring',
      icon: '📊',
      port: 8888,
      path: '/',
      description: 'System monitoring & scheduled scraping analytics',
      isIntegrated: false,
      tag: 'Port 8888'
    }
  ];

  const checks = await Promise.all(
    toolDefs.map(t => checkPort(t.port))
  );

  const tools = toolDefs.map((t, idx) => {
    const isOnline = checks[idx];
    const url = t.isIntegrated && t.path.startsWith('/') 
      ? t.path 
      : (t.id === 'lan-transit' ? '#transit' : `http://${reqHost}:${t.port}${t.path || ''}`);

    return {
      ...t,
      status: isOnline ? 'online' : 'offline',
      url,
      lanUrl: `http://${primary.ip}:${t.port}${t.path || ''}`,
      tailscaleUrl: tsHost ? `http://${tsHost}:${t.port}${t.path || ''}` : null
    };
  });

  res.json(tools);
});

app.get('/api/devices', (req, res) => {
  const activeDeviceIds = new Set(Array.from(clients.values()).map(c => c.deviceId));
  const list = Array.from(knownDevices.values()).map(d => ({
    ...d,
    isOnline: activeDeviceIds.has(d.id)
  }));
  res.json(list);
});

app.get('/api/history', (req, res) => {
  cleanupExpiredHistory();
  res.json(history);
});

app.delete('/api/history/:id', (req, res) => {
  const id = req.params.id;
  const idx = history.findIndex(h => h.id === id);
  if (idx !== -1) {
    const item = history[idx];
    if (item.file && item.file.filename) {
      const fp = path.join(STORAGE_DIR, item.file.filename);
      if (fs.existsSync(fp)) fs.unlink(fp, () => {});
    }
    history.splice(idx, 1);
    saveHistory();
    const msg = JSON.stringify({ type: 'item_deleted', itemId: id });
    for (const [ws] of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Item not found' });
});

app.delete('/api/history', (req, res) => {
  for (const item of history) {
    if (item.file && item.file.filename) {
      const fp = path.join(STORAGE_DIR, item.file.filename);
      if (fs.existsSync(fp)) fs.unlink(fp, () => {});
    }
  }
  history = [];
  saveHistory();
  const msg = JSON.stringify({ type: 'history_cleared' });
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
  res.json({ success: true });
});

// Helper to download remote image to local storage for instant zero-click transfer
async function downloadRemoteImage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = url.includes('.png') ? '.png' : '.jpg';
    const filename = `buf-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    const filePath = path.join(STORAGE_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    return {
      filename,
      originalName: `viral_${Date.now()}${ext}`,
      size: buffer.length,
      mimeType: ext === '.png' ? 'image/png' : 'image/jpeg'
    };
  } catch (e) {
    console.error('downloadRemoteImage error:', e.message);
    return null;
  }
}

// Auto-refresh buffet trends every 30 minutes
setInterval(async () => {
  try {
    await feeder.refreshBuffet();
  } catch (e) {}
}, 30 * 60 * 1000);

// Buffet Endpoints
app.get('/api/buffet', async (req, res) => {
  let items = feeder.getBuffetItems();
  if (!items || items.length === 0) {
    items = await feeder.refreshBuffet();
  }
  res.json(items);
});

app.post('/api/buffet/refresh', async (req, res) => {
  try {
    const items = await feeder.refreshBuffet();
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/buffet/push', async (req, res) => {
  const { itemId, caption, targetId, targetName } = req.body;
  const items = feeder.getBuffetItems();
  const buffetItem = items.find(i => i.id === itemId);

  if (!buffetItem) {
    return res.status(404).json({ error: 'Buffet item not found' });
  }

  const target = targetId || 'all';
  const targetLabel = targetName || 'All Devices';
  const createdItems = [];

  // 1. Download image and dispatch as file item (Triggers auto-download on target device)
  if (buffetItem.imageUrl) {
    const downloaded = await downloadRemoteImage(buffetItem.imageUrl);
    if (downloaded) {
      const fileItem = {
        id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        senderId: 'content-buffet',
        senderName: '🍱 Buffet Feeder',
        senderType: 'server',
        target,
        targetName: targetLabel,
        contentType: 'image',
        text: null,
        file: {
          filename: downloaded.filename,
          originalName: downloaded.originalName,
          size: downloaded.size,
          mimeType: downloaded.mimeType,
          downloadUrl: `/api/download/${downloaded.filename}`
        },
        timestamp: new Date().toISOString()
      };
      dispatchItem(fileItem);
      createdItems.push(fileItem);
    }
  }

  // 2. Dispatch caption text (Triggers zero-click clipboard auto-copy on target device)
  const textToSend = caption || (buffetItem.captions ? (buffetItem.captions.casual || buffetItem.captions.debate || buffetItem.captions.short || buffetItem.captions.vn) : buffetItem.title);
  const textItem = {
    id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
    senderId: 'content-buffet',
    senderName: '🍱 Buffet Feeder',
    senderType: 'server',
    target,
    targetName: targetLabel,
    contentType: 'text',
    text: textToSend,
    file: null,
    timestamp: new Date().toISOString()
  };
  dispatchItem(textItem);
  createdItems.push(textItem);

  res.json({ success: true, items: createdItems });
});

// Dismiss/Delete a buffet item
app.delete('/api/buffet/:id', (req, res) => {
  const { id } = req.params;
  const reason = req.query.reason || 'deleted';
  feeder.dismissItem(id, reason);
  res.json({ success: true, id, reason });
});

// Restore a dismissed buffet item
app.post('/api/buffet/:id/restore', (req, res) => {
  const { id } = req.params;
  const ok = feeder.restoreItem(id);
  res.json({ success: ok, id });
});

// List dismissed items
app.get('/api/buffet/dismissed', (req, res) => {
  res.json(feeder.getDismissedItems());
});

app.get('/api/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(STORAGE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found on server');
  }

  const item = history.find(h => h.file && h.file.filename === filename);
  const originalName = item ? item.file.originalName : filename;

  res.download(filePath, originalName);
});

// Quick upload endpoint (Optimized for Apple Shortcuts or curl)
app.post('/api/quick-upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  let rawName = file.originalname;
  try {
    rawName = Buffer.from(file.originalname, 'latin1').toString('utf8');
  } catch (e) {}

  let contentType = 'file';
  if (file.mimetype.startsWith('image/')) contentType = 'image';
  else if (file.mimetype.startsWith('video/')) contentType = 'video';
  else if (file.mimetype.startsWith('audio/')) contentType = 'audio';

  const item = {
    id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
    senderId: req.body.senderId || 'apple-shortcut',
    senderName: req.body.senderName || 'Apple Shortcut',
    senderType: 'phone',
    target: req.body.target || 'all',
    targetName: req.body.targetName || 'All Devices',
    contentType,
    text: req.body.text || '',
    file: {
      filename: file.filename,
      originalName: rawName,
      size: file.size,
      mimeType: file.mimetype,
      downloadUrl: `/api/download/${file.filename}`
    },
    timestamp: new Date().toISOString()
  };

  dispatchItem(item);
  res.json({ success: true, item });
});

// Quick text endpoint
app.post('/api/quick-text', (req, res) => {
  const text = req.body.text;
  if (!text) return res.status(400).json({ error: 'Empty text' });

  const item = {
    id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
    senderId: req.body.senderId || 'quick-send',
    senderName: req.body.senderName || 'Quick Sender',
    senderType: req.body.senderType || 'unknown',
    target: req.body.target || 'all',
    targetName: req.body.targetName || 'All Devices',
    contentType: 'text',
    text,
    file: null,
    timestamp: new Date().toISOString()
  };

  dispatchItem(item);
  res.json({ success: true, item });
});

// Unified send endpoint
app.post('/api/send', upload.array('files', 30), (req, res) => {
  const { senderId, senderName, senderType, target, targetName, text } = req.body;
  const files = req.files || [];

  if (!text && files.length === 0) {
    return res.status(400).json({ error: 'No data to send' });
  }

  const createdItems = [];

  // Text item
  if (text && text.trim()) {
    const textItem = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      senderId: senderId || 'web-client',
      senderName: senderName || 'Anonymous',
      senderType: senderType || 'browser',
      target: target || 'all',
      targetName: targetName || 'All Devices',
      contentType: 'text',
      text: text.trim(),
      file: null,
      timestamp: new Date().toISOString()
    };
    dispatchItem(textItem);
    createdItems.push(textItem);
  }

  // File items
  files.forEach(f => {
    let rawName = f.originalname;
    try {
      rawName = Buffer.from(f.originalname, 'latin1').toString('utf8');
    } catch (e) {}

    let contentType = 'file';
    if (f.mimetype.startsWith('image/')) contentType = 'image';
    else if (f.mimetype.startsWith('video/')) contentType = 'video';
    else if (f.mimetype.startsWith('audio/')) contentType = 'audio';

    const fileItem = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      senderId: senderId || 'web-client',
      senderName: senderName || 'Anonymous',
      senderType: senderType || 'browser',
      target: target || 'all',
      targetName: targetName || 'All Devices',
      contentType,
      text: null,
      file: {
        filename: f.filename,
        originalName: rawName,
        size: f.size,
        mimeType: f.mimetype,
        downloadUrl: `/api/download/${f.filename}`
      },
      timestamp: new Date().toISOString()
    };
    dispatchItem(fileItem);
    createdItems.push(fileItem);
  });

  res.json({ success: true, items: createdItems });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🚀 LAN Transit Hub running on port ${PORT}:`);
  const ips = getLanIps();
  ips.forEach(i => {
    console.log(`   👉 http://${i.ip}:${PORT} (${i.name})`);
  });
  console.log(`===============================================`);
});
