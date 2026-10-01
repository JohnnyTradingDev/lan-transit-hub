#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
  ⚡ SCRCPY CABLE BRIDGE - TỰ ĐỘNG BẮN BÀI QUA CÁP USB CHO SCRCPY
=============================================================================
Chức năng:
  - Kết nối với Homeserver Content Buffet (http://100.75.112.62:7777).
  - Tự động nhận diện điện thoại Android cắm cáp vào Laptop (Vivo, Samsung, Huawei...).
  - Khi bấm "Bắn bài" trên Web Homeserver:
      1. Tự động tải ảnh về laptop.
      2. Tự động chạy `adb push` ảnh vào /sdcard/Download/ của điện thoại.
      3. Tự kích hoạt Android Media Scanner (ảnh nhảy ngay lên đầu Album/Thư viện).
      4. Tự động nạp Caption vào Bộ nhớ tạm (Clipboard) của laptop & điện thoại.
  - Bạn chỉ cần nhìn màn hình scrcpy: Mở app -> Chọn ảnh đầu tiên -> Ctrl+V -> Đăng!

Yêu cầu:
  - Chạy trên Laptop (Windows, macOS, Linux).
  - Đã có `adb` (đi kèm sẵn trong thư mục của scrcpy).
  - Không cần cài thêm thư viện phụ nào (chỉ dùng Python standard library).
=============================================================================
"""

import os
import sys
import time
import json
import socket
import urllib.request
import urllib.error
import subprocess
import tempfile
import re
import threading

DEFAULT_SERVER = "http://100.75.112.62:7777"
SERVER_URL = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SERVER
SERVER_URL = SERVER_URL.rstrip('/')

ADB_BIN = "adb"
current_device = None
running = True

def find_adb():
    global ADB_BIN
    # 1. Check system PATH
    try:
        res = subprocess.run([ADB_BIN, "version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=3)
        if res.returncode == 0:
            return True
    except Exception:
        pass

    # 2. Check current directory or script directory (common if placed inside scrcpy folder)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(script_dir, "adb.exe"),
        os.path.join(script_dir, "adb"),
        os.path.join(os.getcwd(), "adb.exe"),
        os.path.join(os.getcwd(), "adb"),
        os.path.expandvars(r"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            try:
                res = subprocess.run([c, "version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=3)
                if res.returncode == 0:
                    ADB_BIN = c
                    return True
            except Exception:
                continue

    return False

def get_connected_device():
    """Returns (serial, model_name) or (None, None)"""
    try:
        res = subprocess.run([ADB_BIN, "devices", "-l"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=4)
        if res.returncode != 0:
            return None, None

        lines = res.stdout.strip().splitlines()
        for line in lines[1:]:
            parts = line.strip().split()
            if len(parts) >= 2 and parts[1] == "device":
                serial = parts[0]
                model = None
                for p in parts[2:]:
                    if p.startswith("model:"):
                        model = p.split(":", 1)[1]
                        break
                    elif p.startswith("product:"):
                        model = p.split(":", 1)[1]
                if not model:
                    model = serial

                # Clean brand names if recognizable
                clean_name = model.replace("_", " ")
                if clean_name.startswith("SM ") or clean_name.startswith("SM-"):
                    clean_name = f"Samsung {clean_name}"
                elif clean_name.startswith("V2") or clean_name.startswith("vivo"):
                    clean_name = f"Vivo {clean_name}"
                elif clean_name.startswith("TAS") or clean_name.startswith("ELS") or clean_name.startswith("HWI"):
                    clean_name = f"Huawei {clean_name}"
                elif clean_name.startswith("iPhone"):
                    clean_name = f"iPhone {clean_name}"

                return serial, clean_name
    except Exception as e:
        pass
    return None, None

def set_clipboard(text):
    """Sets clipboard on laptop OS and pushes to Android clipboard"""
    if not text:
        return

    # 1. OS Clipboard (Laptop) - scrcpy automatically forwards host clipboard to phone!
    try:
        if sys.platform == 'win32':
            # PowerShell Set-Clipboard with safe stdin pipe
            p = subprocess.Popen(['powershell', '-NoProfile', '-Command', '$Input | Set-Clipboard'],
                                 stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            p.communicate(input=text.encode('utf-8'), timeout=3)
        elif sys.platform == 'darwin':
            p = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
            p.communicate(input=text.encode('utf-8'), timeout=3)
        else: # Linux
            for tool in ['wl-copy', 'xclip', 'xsel']:
                try:
                    cmd = ['wl-copy'] if tool == 'wl-copy' else (['xclip', '-selection', 'clipboard'] if tool == 'xclip' else ['xsel', '-b', '-i'])
                    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
                    p.communicate(input=text.encode('utf-8'), timeout=3)
                    break
                except Exception:
                    continue
    except Exception as e:
        pass

    # 2. Android device clipboard directly via ADB (bonus)
    try:
        # Use adb shell cmd clipboard if device connected
        safe_text = text.replace("'", "'\\''")
        subprocess.run(
            [ADB_BIN, "shell", "cmd", "clipboard", "set", "text", safe_text],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3
        )
    except Exception:
        pass

def push_image_to_phone(image_path, filename):
    """Pushes image to /sdcard/Download/ and triggers Media Scanner"""
    serial, model = get_connected_device()
    if not serial:
        print("\n⚠️  [CHƯA CẮM CÁP ĐIỆN THOẠI] Không tìm thấy máy Android nào!")
        print("    👉 Vui lòng cắm cáp USB nối điện thoại với laptop và bật USB Debugging.")
        return False, "Không có điện thoại cắm cáp"

    remote_path = f"/sdcard/Download/{filename}"
    try:
        # Push file
        cmd_push = [ADB_BIN, "-s", serial, "push", image_path, remote_path]
        res = subprocess.run(cmd_push, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)
        if res.returncode != 0:
            return False, f"ADB push lỗi: {res.stderr.strip()}"

        # Trigger Android Media Scanner so it appears immediately in Photo Picker
        cmd_scan = [
            ADB_BIN, "-s", serial, "shell", "am", "broadcast",
            "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
            "-d", f"file://{remote_path}"
        ]
        subprocess.run(cmd_scan, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)

        return True, model
    except Exception as e:
        return False, str(e)

def send_heartbeat():
    """Periodically reports connected phone model to Homeserver"""
    global current_device, running
    laptop_name = socket.gethostname()

    while running:
        try:
            serial, model = get_connected_device()
            if model != current_device:
                current_device = model
                if model:
                    print(f"\n📱 [CÁP USB] Đã nhận diện điện thoại: \033[1;32m{model}\033[0m (Serial: {serial})")
                else:
                    print("\n⚪ [CÁP USB] Chưa cắm điện thoại nào (Đang chờ cắm cáp...)")

            payload = {
                "deviceModel": model,
                "deviceSerial": serial,
                "laptopName": laptop_name,
                "scrcpyRunning": True,
                "timestamp": int(time.time())
            }
            data = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                f"{SERVER_URL}/api/bridge/heartbeat",
                data=data,
                headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=4)
        except Exception:
            pass

        time.sleep(6)

def handle_post_event(payload):
    """Handles incoming post payload from Homeserver"""
    item_id = payload.get("itemId", "")
    title = payload.get("title", "Bài viết mới")
    caption = payload.get("caption", "")
    download_url = payload.get("downloadUrl", "")
    filename = payload.get("filename") or f"post_{int(time.time())}.jpg"

    print("\n" + "=" * 65)
    print(f"🚀 \033[1;36m[SCRCPY BRIDGE] NHẬN BÀI MỚI TỪ HOMESERVER!\033[0m")
    print(f"📌 Tiêu đề: \033[1m{title}\033[0m")
    if caption:
        preview = caption.replace('\n', ' ')
        if len(preview) > 80:
            preview = preview[:80] + "..."
        print(f"💬 Caption: {preview}")

    # 1. Download image if URL provided
    pushed_ok = False
    device_name = "Điện thoại"
    if download_url:
        full_url = f"{SERVER_URL}{download_url}" if download_url.startswith("/") else download_url
        print(f"📥 Đang tải ảnh từ Homeserver: {filename}...")
        try:
            temp_dir = tempfile.gettempdir()
            local_image_path = os.path.join(temp_dir, filename)
            urllib.request.urlretrieve(full_url, local_image_path)
            
            # Push to phone
            pushed_ok, info = push_image_to_phone(local_image_path, filename)
            if pushed_ok:
                device_name = info
                print(f"✅ \033[1;32mĐÃ BẮN ẢNH VÀO: {device_name} -> /sdcard/Download/{filename}\033[0m")
                print("🖼️  Đã kích hoạt Media Scanner: Ảnh đã ở vị trí ĐẦU TIÊN trong Album!")
            else:
                print(f"❌ Không thể nạp ảnh vào máy: {info}")
        except Exception as e:
            print(f"❌ Lỗi tải ảnh: {e}")

    # 2. Copy caption to clipboard
    if caption:
        set_clipboard(caption)
        print("📋 \033[1;32mĐÃ NẠP CAPTION VÀO CLIPBOARD!\033[0m (scrcpy tự sync sang điện thoại)")

    # 3. Print next action for user
    print("-" * 65)
    print("👉 \033[1;33mTHAO TÁC TIẾP THEO TRÊN SCRCPY:\033[0m")
    print(f"   1. Mở App mạng xã hội (X, TikTok, Reddit, Instagram...) trên màn hình scrcpy")
    print(f"   2. Bấm Tạo bài -> Chọn ảnh đầu tiên trong Album")
    print(f"   3. Bấm Ctrl+V (hoặc giữ màn hình bấm Dán) -> BẤM ĐĂNG! 🚀")
    print("=" * 65 + "\n")

def listen_sse():
    """Listens to Server-Sent Events stream from Homeserver"""
    events_url = f"{SERVER_URL}/api/bridge/events"
    print(f"🔗 Đang kết nối tới Homeserver: \033[1;34m{events_url}\033[0m")

    while running:
        try:
            req = urllib.request.Request(
                events_url,
                headers={"User-Agent": "ScrcpyBridge/1.0", "Accept": "text/event-stream"}
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                print("🟢 \033[1;32mKẾT NỐI HOMESERVER THÀNH CÔNG! SẴN SÀNG NHẬN BÀI 1-CLICK.\033[0m")
                buffer = ""
                for raw_line in resp:
                    if not running:
                        break
                    line = raw_line.decode('utf-8')
                    if line.startswith("data:"):
                        data_content = line[5:].strip()
                        if data_content:
                            try:
                                payload = json.loads(data_content)
                                if payload.get("type") == "scrcpy_push":
                                    handle_post_event(payload)
                            except Exception as pe:
                                pass
        except urllib.error.URLError as ue:
            print(f"⏳ Mất kết nối tới Homeserver ({ue.reason}). Đang thử kết nối lại sau 4s...")
            time.sleep(4)
        except Exception as e:
            time.sleep(4)

def main():
    print("""
\033[1;35m
  ██████╗  ██████╗██████╗  ██████╗██████╗ ██╗   ██╗
 ██╔════╝ ██╔════╝██╔══██╗██╔════╝██╔══██╗╚██╗ ██╔╝
 ╚█████╗  ██║     ██████╔╝██║     ██████╔╝ ╚████╔╝ 
  ╚═══██╗ ██║     ██╔══██╗██║     ██╔═══╝   ╚██╔╝  
 ██████╔╝ ╚██████╗██║  ██║╚██████╗██║        ██║   
 ╚═════╝   ╚═════╝╚═╝  ╚═╝ ╚═════╝╚═╝        ╚═╝   
    C A B L E   B R I D G E   F O R   S E R V E R
\033[0m""")
    print("=" * 65)
    print(f"📍 Server Target: {SERVER_URL}")

    # Check ADB
    if not find_adb():
        print("❌ \033[1;31mKHÔNG TÌM THẤY LỆNH 'adb' TRÊN MÁY TÍNH!\033[0m")
        print("   👉 Hãy đảm bảo bạn đã mở scrcpy hoặc đặt file này cùng thư mục với scrcpy.exe.")
        print("   👉 Hoặc thêm đường dẫn chứa adb.exe vào biến môi trường PATH.")
        sys.exit(1)

    print(f"✅ ADB Engine: \033[1;32m{ADB_BIN}\033[0m")

    # Start Heartbeat Thread
    t = threading.Thread(target=send_heartbeat, daemon=True)
    t.start()

    # Listen to SSE
    try:
        listen_sse()
    except KeyboardInterrupt:
        print("\n👋 Đã tắt Scrcpy Bridge. Tạm biệt!")

if __name__ == '__main__':
    main()
