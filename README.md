# ⚡ LAN Transit Hub (Trạm Trung Chuyển Dữ Liệu Nội Bộ)

Một ứng dụng web tốc độ cao, siêu nhẹ chạy trực tiếp trên PC/Server trong mạng LAN gia đình hoặc văn phòng. Hỗ trợ chuyển qua lại tức thì giữa **Android, iPhone, iPad, Laptop và PC Server** mà không cần qua dịch vụ đám mây của bên thứ 3.

---

## ✨ Điểm Nổi Bật

- 🚀 **Tốc độ mạng LAN tối đa**: Chuyển file ảnh gốc, video 4K, tài liệu dung lượng lớn (hàng chục GB) trực tiếp qua Wi-Fi / Ethernet.
- 🎯 **Gửi linh hoạt (Target Routing)**:
  - Gửi **Tất cả thiết bị** (Broadcast).
  - Hoặc chọn đích danh **chỉ 1 thiết bị cụ thể** (VD: chỉ gửi riêng cho `iPhone của Ba`, `Tab Samsung`, v.v.).
- ⚡ **Tự nhận & Không hỏi (Zero-Click)**:
  - Tùy chọn tự động tải file ngầm vào thư mục `Downloads`.
  - Tự động sao chép văn bản / link / mã OTP vào bộ nhớ tạm (Clipboard).
- 📱 **Tối ưu đặc biệt cho Mobile (Android & iPhone)**:
  - Giao diện thân thiện với màn hình cảm ứng, có phím tắt mở trực tiếp Camera / Album ảnh.
  - **Click để phóng to ảnh (Lightbox Zoom)**: Xem ảnh chất lượng cao trực tiếp trên điện thoại, chạm để phóng to thu nhỏ.
  - Trình phát Video / Audio trực tiếp trong trình duyệt.
  - Hỗ trợ **PWA (Progressive Web App)**: Cài đặt lên màn hình chính trên iPhone/Android để chạy toàn màn hình như ứng dụng gốc.
- 🔒 **An toàn & Riêng tư**:
  - Dữ liệu hoàn toàn nằm trong mạng gia đình (`192.168.1.x`) hoặc mạng riêng ảo cá nhân (`Tailscale`).
  - Không đi qua server bên ngoài, không lưu trữ đám mây.

---

## 🛠️ Cài Đặt & Chạy

### Yêu cầu
- Node.js >= 18
- Linux / macOS / Windows

### Cài đặt
```bash
git clone https://github.com/JohnnyTradingDev/lan-transit-hub.git
cd lan-transit-hub
npm install
```

### Khởi chạy
```bash
node server.js
```
Mặc định ứng dụng lắng nghe tại cổng `7777`.

---

## 🛡️ Cấu hình Tường lửa (UFW) trên Linux Ubuntu

Để các thiết bị trong nhà truy cập được an toàn tuyệt đối mà không sợ người ngoài Internet:

```bash
# Chỉ cho phép các thiết bị kết nối Wi-Fi nhà bạn (192.168.1.x)
sudo ufw allow from 192.168.1.0/24 to any port 7777 proto tcp

# (Tùy chọn) Cho phép cả mạng Tailscale cá nhân
sudo ufw allow in on tailscale0 to any port 7777 proto tcp
```

---

## 🔄 Chạy ngầm 24/7 với Systemd (Linux)

Tạo file dịch vụ tại `~/.config/systemd/user/lan-transit-hub.service`:

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

Kích hoạt dịch vụ:
```bash
systemctl --user daemon-reload
systemctl --user enable --now lan-transit-hub.service
```

---

## 🍏 Mẹo Dành Riêng Cho iPhone / iPad

1. **Chạy toàn màn hình**: Mở Safari -> Vào link trạm trung chuyển -> Bấm nút **Chia sẻ** -> Chọn **Thêm vào MH chính (Add to Home Screen)**.
2. **Gửi ảnh nhanh 1 chạm (Phím tắt / Apple Shortcuts)**:
   - Sử dụng API nhận file nhanh: `POST http://<server-ip>:7777/api/quick-upload`
   - Tạo phím tắt trên iOS: Nhận đầu vào là ảnh/file từ Album -> Gửi POST tới API -> Tự động bay về Server trong 1 giây.
