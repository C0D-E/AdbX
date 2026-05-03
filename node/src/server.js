/**
 * AdbX Node - HTTP + WebSocket Server
 *
 * Exposes a REST API and WebSocket endpoint used by the AdbX Console.
 * All communication is local-only by default (127.0.0.1).
 */

'use strict';

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { rateLimit } = require('express-rate-limit');

// Rate limiter for file-system heavy endpoints (pull, push, install): 60 req/min per IP
const fileRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests – please slow down.' },
});

/**
 * Create and configure the Express + WebSocket server.
 * @param {{ adbManager: import('./adb').AdbManager, scrpyEngine: import('./scrpy').ScrpyEngine }} deps
 * @returns {http.Server}
 */
function createServer({ adbManager, scrpyEngine }) {
  const app = express();

  // Allow CORS from AdbX Console (GitHub Pages / localhost dev)
  app.use(cors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://c0d-e.github.io',
      /^https:\/\/.*\.pages\.dev$/,
    ],
    methods: ['GET', 'POST', 'DELETE'],
  }));

  app.use(express.json({ limit: '10mb' }));

  // ── Health ───────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: (() => { try { return require('../package.json').version; } catch { return '1.0.0'; } })(),
      platform: process.platform,
      uptime: process.uptime(),
    });
  });

  // ── Devices ──────────────────────────────────────────────────────────────
  app.get('/api/devices', async (_req, res) => {
    try {
      const devices = await adbManager.listDevices();
      res.json({ devices });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/devices/:serial', async (req, res) => {
    try {
      const info = adbManager.getDeviceInfo(req.params.serial);
      if (!info) return res.status(404).json({ error: 'Device not found' });
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/devices/:serial/reboot', async (req, res) => {
    try {
      await adbManager.reboot(req.params.serial);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/devices/:serial/screenshot', async (req, res) => {
    try {
      const buf = await adbManager.screenshot(req.params.serial);
      res.set('Content-Type', 'image/png');
      res.send(buf);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Shell ────────────────────────────────────────────────────────────────
  app.post('/api/devices/:serial/shell', async (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'command is required' });
    try {
      const output = await adbManager.runShellCommand(req.params.serial, command);
      res.json({ output });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── File Manager ─────────────────────────────────────────────────────────
  app.get('/api/devices/:serial/files', async (req, res) => {
    const remotePath = req.query.path || '/sdcard';
    try {
      const files = await adbManager.listFiles(req.params.serial, remotePath);
      res.json({ path: remotePath, files });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/devices/:serial/files/pull', fileRateLimit, async (req, res) => {
    const { remotePath } = req.body;
    if (!remotePath) return res.status(400).json({ error: 'remotePath is required' });
    try {
      const tmpPath = path.join(os.tmpdir(), path.basename(remotePath));
      await adbManager.pullFile(req.params.serial, remotePath, tmpPath);
      res.download(tmpPath, path.basename(remotePath), () => {
        fs.unlink(tmpPath, () => {});
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/devices/:serial/files/push', fileRateLimit, express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
    const remotePath = req.query.path;
    if (!remotePath) return res.status(400).json({ error: 'path query param is required' });
    try {
      const tmpPath = path.join(os.tmpdir(), `adbx_push_${Date.now()}`);
      fs.writeFileSync(tmpPath, req.body);
      await adbManager.pushFile(req.params.serial, tmpPath, remotePath);
      fs.unlink(tmpPath, () => {});
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── APK Install ──────────────────────────────────────────────────────────
  app.post('/api/devices/:serial/install', fileRateLimit, express.raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
    try {
      const tmpPath = path.join(os.tmpdir(), `adbx_apk_${Date.now()}.apk`);
      fs.writeFileSync(tmpPath, req.body);
      await adbManager.installApk(req.params.serial, tmpPath);
      fs.unlink(tmpPath, () => {});
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── scrcpy (Screen Streaming) ────────────────────────────────────────────
  app.post('/api/devices/:serial/scrpy/start', async (req, res) => {
    const { maxFps = 30, maxSize = 1080, bitrate = 2000000 } = req.body;
    try {
      await scrpyEngine.start(req.params.serial, { maxFps, maxSize, bitrate });
      res.json({ success: true, wsPath: `/scrpy/${req.params.serial}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/devices/:serial/scrpy/stop', async (req, res) => {
    try {
      scrpyEngine.stop(req.params.serial);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── ADB Settings ─────────────────────────────────────────────────────────
  app.post('/api/devices/:serial/settings', async (req, res) => {
    const { namespace, key, value } = req.body;
    if (!namespace || !key || value === undefined) {
      return res.status(400).json({ error: 'namespace, key and value are required' });
    }
    const validNamespaces = ['system', 'secure', 'global'];
    if (!validNamespaces.includes(namespace)) {
      return res.status(400).json({ error: `namespace must be one of: ${validNamespaces.join(', ')}` });
    }
    try {
      await adbManager.runShellCommand(
        req.params.serial,
        `settings put ${namespace} ${key} ${value}`
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/devices/:serial/settings', async (req, res) => {
    const { namespace, key } = req.query;
    if (!namespace || !key) {
      return res.status(400).json({ error: 'namespace and key are required' });
    }
    try {
      const value = await adbManager.runShellCommand(
        req.params.serial,
        `settings get ${namespace} ${key}`
      );
      res.json({ value });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Resolution & Display ─────────────────────────────────────────────────
  app.post('/api/devices/:serial/display/resolution', async (req, res) => {
    const { resolution } = req.body; // e.g. "1080x1920" or "reset"
    try {
      const cmd = resolution === 'reset' ? 'wm size reset' : `wm size ${resolution}`;
      await adbManager.runShellCommand(req.params.serial, cmd);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/devices/:serial/display/density', async (req, res) => {
    const { dpi } = req.body;
    try {
      const cmd = dpi === 'reset' ? 'wm density reset' : `wm density ${dpi}`;
      await adbManager.runShellCommand(req.params.serial, cmd);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── HTTP Server + WebSocket ───────────────────────────────────────────────
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Broadcast device list changes to all WebSocket clients
  adbManager.on('deviceAdded', (device) => {
    broadcast(wss, { event: 'deviceAdded', device });
  });
  adbManager.on('deviceRemoved', (device) => {
    broadcast(wss, { event: 'deviceRemoved', device });
  });
  adbManager.on('deviceChanged', (device) => {
    broadcast(wss, { event: 'deviceChanged', device });
  });

  // Attach scrcpy frame forwarder per device
  scrpyEngine.on('frame', ({ serial, data }) => {
    const msg = JSON.stringify({ event: 'scrpyFrame', serial, frame: data.toString('base64') });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN && client._scrpySerial === serial) {
        client.send(msg);
      }
    }
  });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      switch (msg.type) {
        case 'subscribe_scrpy':
          ws._scrpySerial = msg.serial;
          ws.send(JSON.stringify({ event: 'subscribed', serial: msg.serial }));
          break;

        case 'shell': {
          if (!msg.serial || !msg.command) {
            ws.send(JSON.stringify({ error: 'serial and command required' }));
            break;
          }
          try {
            const output = await adbManager.runShellCommand(msg.serial, msg.command);
            ws.send(JSON.stringify({ event: 'shellOutput', id: msg.id, output }));
          } catch (err) {
            ws.send(JSON.stringify({ event: 'shellError', id: msg.id, error: err.message }));
          }
          break;
        }

        case 'touch': {
          // Forward touch input to device
          if (!msg.serial || msg.x === undefined || msg.y === undefined) break;
          const cmd = `input tap ${Math.round(msg.x)} ${Math.round(msg.y)}`;
          adbManager.runShellCommand(msg.serial, cmd).catch(() => {});
          break;
        }

        case 'swipe': {
          if (!msg.serial) break;
          const { x1, y1, x2, y2, duration = 300 } = msg;
          const cmd = `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${duration}`;
          adbManager.runShellCommand(msg.serial, cmd).catch(() => {});
          break;
        }

        case 'key': {
          if (!msg.serial || !msg.keycode) break;
          adbManager.runShellCommand(msg.serial, `input keyevent ${msg.keycode}`).catch(() => {});
          break;
        }

        case 'text': {
          if (!msg.serial || !msg.text) break;
          const escaped = msg.text.replace(/'/g, "'\\''");
          adbManager.runShellCommand(msg.serial, `input text '${escaped}'`).catch(() => {});
          break;
        }

        default:
          ws.send(JSON.stringify({ error: `Unknown message type: ${msg.type}` }));
      }
    });

    ws.on('close', () => console.log('[WS] Client disconnected'));
    ws.on('error', (err) => console.error('[WS] Error:', err.message));

    // Send current device list on connect
    adbManager.listDevices().then((devices) => {
      ws.send(JSON.stringify({ event: 'deviceList', devices }));
    }).catch(() => {});
  });

  return httpServer;
}

/**
 * Broadcast a JSON message to all connected WebSocket clients.
 */
function broadcast(wss, payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  }
}

module.exports = { createServer };
