# ⚡ LAN Transit Hub

A lightweight, blazing-fast, cross-device local relay hub for **Android, iPhone, iPad, Laptops, and PC Servers**. Transfer text, URLs, photos, 4K videos, and large files seamlessly over your local Wi-Fi or private Tailscale network without relying on third-party cloud services.

---

## ✨ Features

- 🚀 **Full LAN Speed**: Stream and transfer raw photos, large videos, and files directly over your local gigabit Wi-Fi/Ethernet.
- 🎯 **Target Routing**:
  - Broadcast to **All Devices**.
  - Or target a **specific device** (e.g., send exclusively to `Johnny's iPhone` or `Samsung Tab`).
- ⚡ **Zero-Click Auto-Receive**:
  - **Auto-Download**: Automatically downloads incoming files straight to device `Downloads` folder without prompt.
  - **Auto-Copy**: Automatically copies incoming texts, OTPs, or URLs to the system clipboard.
- 📱 **Mobile-First UX (Android & iOS)**:
  - **Unified Smart Composer**: No tab switching! Attach files, snap with camera, or type text in a single unified box.
  - **Tap-to-Copy**: Tap anywhere on a received text card to copy immediately.
  - **Image Lightbox Zoom**: Tap images to preview full-screen with high-res zoom (1x / 2x) and instant download.
  - **Inline Media Players**: Play videos and audio clips directly in your browser.
  - **Instant Camera & Gallery triggers**: Direct 1-tap capture on phones.
  - **PWA Ready**: Add to Home Screen on iOS/Android for a full-screen, native app experience.
- 🔒 **Private & Secure**:
  - Operates purely within your local home network (`192.168.1.x`) and/or private Tailscale network.
  - No cloud storage, no telemetry.

---

## 🛠️ Installation & Running

### Requirements
- Node.js >= 18
- Linux / macOS / Windows

### Quick Start
```bash
git clone https://github.com/JohnnyTradingDev/lan-transit-hub.git
cd lan-transit-hub
npm install
node server.js
```
The server listens on port `7777` by default.

## Content Routes

Open `http://<server-ip>:7777/content-routes.html` on the laptop to use the
editorial desk. Open the main hub on each Android, give every device a clear
name, and keep it open while receiving an approved caption.

- Draft and review captions on the laptop.
- Route approved content to one specific online Android device.
- Track `draft -> ready -> sent -> posted -> archived`, the post URL, and
  24-hour/7-day views.
- BingX-related drafts automatically include the selected route's disclosure.
- The hub prepares and transfers content only. It never auto-posts or creates
  engagement.

The Vietnamese channel map, example topics, weekly cadence, and four-week view
experiment are documented in [`CONTENT-ROUTES.md`](CONTENT-ROUTES.md).

---

## 🛡️ Ubuntu Firewall (UFW) Configuration

To safely allow local devices while keeping the outside Internet blocked:

```bash
# Allow only devices on your local Wi-Fi subnet (192.168.1.x)
sudo ufw allow from 192.168.1.0/24 to any port 7777 proto tcp

# (Optional) Allow access over your private Tailscale network
sudo ufw allow in on tailscale0 to any port 7777 proto tcp
```

---

## 🔄 Run 24/7 as Systemd Service (Linux)

Create a user service file at `~/.config/systemd/user/lan-transit-hub.service`:

```ini
[Unit]
Description=LAN Transit Hub - Relay for text, photos, videos across all devices
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/johnny/projects/lan-transit-hub
Environment=PORT=7777
Environment=NODE_ENV=production
ExecStart=/home/johnny/.local/bin/node /home/johnny/projects/lan-transit-hub/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
```

Enable and start the service:
```bash
systemctl --user daemon-reload
systemctl --user enable --now lan-transit-hub.service
```

---

## 🍏 iOS / iPhone Integration Tips

1. **Full-screen Experience**: Open in Safari -> Tap **Share** -> Tap **Add to Home Screen**.
2. **One-Tap Share Sheet (Apple Shortcuts)**:
   - Use the quick endpoint: `POST http://<server-ip>:7777/api/quick-upload`
   - Create a simple shortcut in the Apple Shortcuts app accepting Photos/Files -> "Get Contents of URL" (POST) -> Uploads in ~1 second.
