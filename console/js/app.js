/**
 * AdbX Console - Main Application
 *
 * Manages WebSocket connection to AdbX Node, device selection,
 * tab navigation, and dispatches events to feature modules.
 */

'use strict';

/* ── Configuration ──────────────────────────────────────────────────────── */
const DEFAULT_NODE_URL = 'ws://127.0.0.1:7272/ws';
const HTTP_BASE = () => {
  const wsUrl = app.nodeUrl || DEFAULT_NODE_URL;
  return wsUrl.replace(/^ws/, 'http').replace(/\/ws$/, '');
};
const RECONNECT_DELAY_MS = 3000;
const VERSION = '1.0.0';

/* ── App State ──────────────────────────────────────────────────────────── */
const app = {
  ws: null,
  nodeUrl: localStorage.getItem('adbx_node_url') || DEFAULT_NODE_URL,
  selectedSerial: null,
  devices: [],
  _pendingCmds: new Map(),
  _cmdId: 0,
  _reconnectTimer: null,

  /* ── WebSocket ──────────────────────────────────────────────────────── */

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;

    setConnectionStatus('connecting');
    document.getElementById('sidebar-node-status').textContent = 'Connecting…';

    this.ws = new WebSocket(this.nodeUrl);

    this.ws.addEventListener('open', () => {
      console.log('[AdbX] Connected to AdbX Node:', this.nodeUrl);
      setConnectionStatus('connected');
      document.getElementById('sidebar-node-status').textContent = 'Node: connected';
      clearTimeout(this._reconnectTimer);
    });

    this.ws.addEventListener('message', (e) => this._onMessage(JSON.parse(e.data)));

    this.ws.addEventListener('close', () => {
      setConnectionStatus('disconnected');
      document.getElementById('sidebar-node-status').textContent = 'Node: disconnected';
      this._scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      setConnectionStatus('disconnected');
    });
  },

  reconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    clearTimeout(this._reconnectTimer);
    this.connect();
  },

  _scheduleReconnect() {
    this._reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
  },

  _onMessage(msg) {
    switch (msg.event) {
      case 'deviceList':
        this._updateDeviceList(msg.devices);
        break;
      case 'deviceAdded':
        toast('Device connected: ' + (msg.device.id || msg.device), 'success');
        this.refreshDevices();
        break;
      case 'deviceRemoved':
        toast('Device disconnected: ' + (msg.device.id || msg.device), 'warning');
        this.refreshDevices();
        break;
      case 'deviceChanged':
        this.refreshDevices();
        break;
      case 'shellOutput':
      case 'shellError': {
        const cb = this._pendingCmds.get(msg.id);
        if (typeof cb === 'function') {
          this._pendingCmds.delete(msg.id);
          cb(msg.event === 'shellError' ? { error: msg.error } : { output: msg.output });
        }
        break;
      }
      case 'scrpyFrame':
        if (window.deviceView) deviceView.onFrame(msg.serial, msg.frame);
        break;
      default:
        break;
    }
  },

  /* ── Device management ──────────────────────────────────────────────── */

  async refreshDevices() {
    try {
      const res = await this.apiGet('/api/devices');
      this._updateDeviceList(res.devices || []);
    } catch (err) {
      console.warn('[AdbX] refreshDevices failed:', err.message);
    }
  },

  _updateDeviceList(devices) {
    this.devices = devices || [];
    renderDeviceList(this.devices);
    if (this.selectedSerial && !this.devices.find(d => d.id === this.selectedSerial)) {
      this.selectDevice(null);
    }
  },

  selectDevice(serial) {
    this.selectedSerial = serial;
    updateSelectedDeviceUI(serial);
    document.dispatchEvent(new CustomEvent('adbx:deviceSelected', { detail: { serial } }));
    document.getElementById('footer-selected-device').textContent =
      serial ? `Device: ${serial}` : 'No device selected';
  },

  /* ── Shell ──────────────────────────────────────────────────────────── */

  sendShell(serial, command) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('Not connected to AdbX Node'));
      }
      const id = ++this._cmdId;
      this._pendingCmds.set(id, (result) => {
        if (result.error) reject(new Error(result.error));
        else resolve(result.output);
      });
      this.ws.send(JSON.stringify({ type: 'shell', serial, command, id }));
    });
  },

  /* ── HTTP API helpers ───────────────────────────────────────────────── */

  async apiGet(path) {
    const res = await fetch(HTTP_BASE() + path);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async apiPost(path, body) {
    const res = await fetch(HTTP_BASE() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async apiDelete(path) {
    const res = await fetch(HTTP_BASE() + path, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

/* ── Tab navigation ─────────────────────────────────────────────────────── */
function activateTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById('tab-' + tabId);
  if (panel) panel.classList.add('active');
  const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  if (btn) btn.classList.add('active');
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

/* ── Profile dropdown ───────────────────────────────────────────────────── */
document.getElementById('profile-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = document.getElementById('profile-dropdown');
  dd.hidden = !dd.hidden;
});

document.addEventListener('click', () => {
  document.getElementById('profile-dropdown').hidden = true;
});

function showNodeSettings() {
  document.getElementById('node-settings-modal').hidden = false;
  document.getElementById('node-url-input').value = app.nodeUrl;
  document.getElementById('profile-dropdown').hidden = true;
}

function saveNodeSettings() {
  const url = document.getElementById('node-url-input').value.trim();
  if (!url) return;
  app.nodeUrl = url;
  localStorage.setItem('adbx_node_url', url);
  document.getElementById('node-url-display').textContent = url;
  closeModal('node-settings-modal');
  app.reconnect();
}

function closeModal(id) {
  document.getElementById(id).hidden = true;
}

/* ── Connection status ──────────────────────────────────────────────────── */
function setConnectionStatus(status) {
  const dot = document.getElementById('connection-status');
  dot.className = 'status-dot status-dot--' + status;
  dot.title = status.charAt(0).toUpperCase() + status.slice(1);
}

/* ── Device list rendering ──────────────────────────────────────────────── */
function renderDeviceList(devices) {
  const list = document.getElementById('device-list');
  list.innerHTML = '';
  if (!devices || devices.length === 0) {
    list.innerHTML = '<li class="device-list__empty">No devices connected</li>';
    return;
  }
  for (const device of devices) {
    const li = document.createElement('li');
    li.className = 'device-item' + (device.id === app.selectedSerial ? ' active' : '');
    li.innerHTML = `
      <span class="device-item__icon">📱</span>
      <div class="device-item__info">
        <div class="device-item__name">${escHtml(device.model || device.id)}</div>
        <div class="device-item__serial">${escHtml(device.id)}</div>
      </div>
      <div class="device-item__actions">
        <button class="icon-btn" data-serial="${escAttr(device.id)}" data-action="reboot" title="Reboot">↺</button>
      </div>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.dataset.action === 'reboot') {
        quickReboot(device.id);
      } else {
        app.selectDevice(device.id);
        document.querySelectorAll('.device-item').forEach(i => i.classList.remove('active'));
        li.classList.add('active');
      }
    });
    list.appendChild(li);
  }
}

async function quickReboot(serial) {
  if (!confirm(`Reboot device ${serial}?`)) return;
  try {
    await app.apiPost(`/api/devices/${serial}/reboot`, {});
    toast('Rebooting device…', 'info');
  } catch (err) {
    toast('Reboot failed: ' + err.message, 'error');
  }
}

/* ── Selected device UI ─────────────────────────────────────────────────── */
function updateSelectedDeviceUI(serial) {
  const device = app.devices.find(d => d.id === serial);

  document.getElementById('device-actions').hidden = !serial;
  document.getElementById('device-info-grid').hidden = !device;
  document.getElementById('device-empty-state').style.display = device ? 'none' : '';

  if (device) {
    document.getElementById('selected-device-title').textContent =
      device.model || device.id;
    document.getElementById('di-model').textContent        = device.model || '—';
    document.getElementById('di-mfr').textContent          = device.manufacturer || '—';
    document.getElementById('di-android').textContent      = device.androidVersion || '—';
    document.getElementById('di-sdk').textContent          = device.sdkVersion || '—';
    document.getElementById('di-resolution').textContent   = device.resolution || '—';
    document.getElementById('di-ram').textContent          = device.ram || '—';
    document.getElementById('di-serial').textContent       = device.id;
    document.getElementById('di-brand').textContent        = device.brand || '—';
  } else {
    document.getElementById('selected-device-title').textContent = 'Select a device';
  }
}

/* ── Refresh devices button ─────────────────────────────────────────────── */
document.getElementById('refresh-devices-btn').addEventListener('click', () => {
  app.refreshDevices();
});

/* ── Screenshot ─────────────────────────────────────────────────────────── */
document.getElementById('screenshot-btn')?.addEventListener('click', async () => {
  const serial = app.selectedSerial;
  if (!serial) return toast('No device selected', 'warning');
  try {
    const res = await fetch(HTTP_BASE() + `/api/devices/${serial}/screenshot`, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screenshot_${serial}_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Screenshot saved', 'success');
  } catch (err) {
    toast('Screenshot failed: ' + err.message, 'error');
  }
});

/* ── Reboot button ──────────────────────────────────────────────────────── */
document.getElementById('reboot-btn')?.addEventListener('click', async () => {
  const serial = app.selectedSerial;
  if (!serial) return toast('No device selected', 'warning');
  if (!confirm(`Reboot ${serial}?`)) return;
  try {
    await app.apiPost(`/api/devices/${serial}/reboot`, {});
    toast('Rebooting…', 'info');
  } catch (err) {
    toast('Reboot failed: ' + err.message, 'error');
  }
});

/* ── Toast notifications ─────────────────────────────────────────────────── */
function toast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/* ── Utility ─────────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

/* ── Init ─────────────────────────────────────────────────────────────────── */
document.getElementById('footer-ver').textContent = `AdbX Console v${VERSION}`;
document.getElementById('footer-version').textContent = `v${VERSION}`;
document.getElementById('node-url-display').textContent = app.nodeUrl;

app.connect();

// Expose globals for other modules
window.app = app;
window.toast = toast;
window.escHtml = escHtml;
window.escAttr = escAttr;
window.HTTP_BASE = HTTP_BASE;
window.closeModal = closeModal;
window.showNodeSettings = showNodeSettings;
window.saveNodeSettings = saveNodeSettings;
window.activateTab = activateTab;
