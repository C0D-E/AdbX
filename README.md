# AdbX ⚡

**Cross-Platform ADB Bridge with Web-Based UI and SCRPY Engine**

AdbX is a cloud-enabled Android Device Bridge platform that lets developers, testers, and teams remotely access, manage, and operate Android devices from any OS (macOS, Windows, Linux) through a web interface. It includes a SCRPY engine to stream and interact with the device screen in real time.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  AdbX Console  (console/)                               │
│  Static web UI · GitHub Pages / Cloudflare Pages        │
└────────────────────────┬────────────────────────────────┘
                         │  HTTP / WebSocket
           ┌─────────────▼─────────────┐
           │  AdbX Core  (core/)        │
           │  Cloudflare Worker         │
           │  Auth · Routing · Sessions │
           └─────────────┬─────────────┘
                         │  Proxy / direct
           ┌─────────────▼─────────────┐
           │  AdbX Node  (node/)        │
           │  Node.js background app    │
           │  ADB + SCRPY bridge        │
           └─────────────┬─────────────┘
                         │  USB / ADB
                    Android Device
```

## Components

| Directory   | Component      | Description                                                    |
|-------------|----------------|----------------------------------------------------------------|
| `node/`     | **AdbX Node**  | Lightweight Node.js background service. Connects to Android devices via USB/ADB, exposes a local HTTP + WebSocket API, and streams device screens via scrcpy. |
| `console/`  | **AdbX Console** | Responsive static web app. Live device view, command terminal, file transfer, gaming/performance/display/audio settings. Deployable to GitHub Pages. |
| `core/`     | **AdbX Core**  | Cloudflare Worker cloud layer. Handles authentication (JWT), node registration, device session management, and request proxying. |

---

## Quick Start

### 1. AdbX Node (background service)

**Prerequisites:**
- [Node.js ≥ 18](https://nodejs.org/)
- [ADB](https://developer.android.com/tools/adb) (`adb` must be in PATH)
- [scrcpy](https://github.com/Genymobile/scrcpy) (for live screen streaming)

```bash
cd node
npm install
npm start
```

The service listens on `http://127.0.0.1:7272` by default.

Environment variables:

| Variable     | Default          | Description                  |
|--------------|------------------|------------------------------|
| `ADBX_PORT`  | `7272`           | HTTP/WS listen port          |
| `ADBX_HOST`  | `127.0.0.1`      | Listen host                  |

### 2. AdbX Console (web UI)

Open `console/index.html` directly in your browser, or deploy it to GitHub Pages / Cloudflare Pages.

The console auto-connects to `ws://127.0.0.1:7272/ws`. You can change the Node URL in
**User Profile → Node Settings**.

### 3. AdbX Core (Cloudflare Worker)

```bash
cd core
npm install
npx wrangler dev          # local dev
npx wrangler deploy       # production deploy
```

Set the following secrets in Cloudflare dashboard:
- `JWT_SECRET` – strong random secret for JWT signing
- Create and bind KV namespaces: `SESSIONS_KV`, `NODES_KV`, `USER_KV`

---

## Features

### Live Device View
- Real-time screen streaming powered by **scrcpy**
- Click-to-tap input forwarding
- Configurable frame rate (15/30/60 fps) and resolution (480p/720p/1080p)

### Command Terminal
- Interactive ADB shell terminal with command history
- Quick-command buttons for common operations
- Output highlighting for commands, results, and errors

### File Transfer
- Browse device filesystem with breadcrumb navigation
- Download (pull) files from device
- Upload (push) files to device with progress indicator

### Device Settings
| Section      | Controls |
|--------------|----------|
| **Gaming**   | Profile (low/medium/high), resolution, frame rate, animation scale |
| **Performance** | Animation scales, CPU governor |
| **Security** | Screen timeout, stay-awake, USB debugging |
| **Display**  | Resolution, DPI, brightness, auto-rotate |
| **Audio**    | Media, ring, notification, system volume |

### Advanced Tab
- Full device properties (`getprop`)
- Network controls (Wi-Fi, airplane mode)
- Custom ADB command runner (multi-line)

---

## API Reference (AdbX Node)

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Service health and version |
| `GET`  | `/api/devices` | List connected devices |
| `GET`  | `/api/devices/:serial` | Device info |
| `POST` | `/api/devices/:serial/reboot` | Reboot device |
| `POST` | `/api/devices/:serial/screenshot` | Capture screenshot (PNG) |
| `POST` | `/api/devices/:serial/shell` | Run shell command |
| `GET`  | `/api/devices/:serial/files?path=` | List files |
| `POST` | `/api/devices/:serial/files/pull` | Pull file from device |
| `POST` | `/api/devices/:serial/files/push?path=` | Push file to device |
| `POST` | `/api/devices/:serial/install` | Install APK |
| `POST` | `/api/devices/:serial/scrpy/start` | Start SCRPY stream |
| `POST` | `/api/devices/:serial/scrpy/stop` | Stop SCRPY stream |
| `POST` | `/api/devices/:serial/settings` | Set ADB setting |
| `GET`  | `/api/devices/:serial/settings?namespace=&key=` | Get ADB setting |
| `POST` | `/api/devices/:serial/display/resolution` | Set screen resolution |
| `POST` | `/api/devices/:serial/display/density` | Set screen density |

### WebSocket (`ws://host:port/ws`)

**Client → Server messages:**

| `type`          | Fields | Description |
|-----------------|--------|-------------|
| `subscribe_scrpy` | `serial` | Subscribe to SCRPY frames for device |
| `shell`         | `serial`, `command`, `id` | Run shell command |
| `touch`         | `serial`, `x`, `y` | Tap at coordinates |
| `swipe`         | `serial`, `x1`, `y1`, `x2`, `y2`, `duration` | Swipe gesture |
| `key`           | `serial`, `keycode` | Send key event |
| `text`          | `serial`, `text` | Type text |

**Server → Client events:**

| `event`       | Description |
|---------------|-------------|
| `deviceList`  | Full list of connected devices |
| `deviceAdded` | New device connected |
| `deviceRemoved` | Device disconnected |
| `shellOutput` | Shell command output |
| `scrpyFrame`  | Base64-encoded JPEG video frame |

---

## AdbX Core API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/login` | None | Obtain JWT token |
| `POST` | `/auth/refresh` | None | Refresh JWT token |
| `GET`  | `/api/sessions` | JWT | List active sessions |
| `POST` | `/api/sessions` | JWT | Create session |
| `DELETE` | `/api/sessions/:id` | JWT | Delete session |
| `GET`  | `/api/nodes` | JWT | List registered nodes |
| `POST` | `/api/nodes` | JWT | Register a node |
| `DELETE` | `/api/nodes/:id` | JWT | Remove a node |
| `*`    | `/api/proxy/:nodeId/*` | JWT | Proxy to a node |

---

## License

MIT © C0D-E