const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const qrcode = require('qrcode');
const cors = require('cors');

const PORT = process.env.PORT || 7777;
const STORAGE_DIR = path.join(__dirname, 'storage');
const HISTORY_FILE = path.join(STORAGE_DIR, 'history.json');
const MAX_HISTORY = 200;

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

app.get('/api/devices', (req, res) => {
  const activeDeviceIds = new Set(Array.from(clients.values()).map(c => c.deviceId));
  const list = Array.from(knownDevices.values()).map(d => ({
    ...d,
    isOnline: activeDeviceIds.has(d.id)
  }));
  res.json(list);
});

app.get('/api/history', (req, res) => {
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
