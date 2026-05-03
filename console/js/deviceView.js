/**
 * AdbX Console - Live Device View
 *
 * Manages scrcpy screen streaming: starts/stops the scrcpy session on
 * AdbX Node, subscribes to WebSocket frames, and renders them on a
 * <canvas> element. Also handles touch/swipe/key input forwarding.
 */

'use strict';

const deviceView = {
  _active: false,
  _serial: null,
  _canvas: null,
  _ctx: null,
  _imageQueue: [],

  init() {
    this._canvas  = document.getElementById('device-canvas');
    this._ctx     = this._canvas.getContext('2d');
    this._overlay = document.getElementById('device-overlay');

    document.getElementById('start-view-btn')?.addEventListener('click', () => this.start());
    document.getElementById('stop-view-btn')?.addEventListener('click',  () => this.stop());

    // Forward touch events on canvas to device
    this._canvas.addEventListener('click',      (e) => this._onCanvasClick(e));
    this._canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

    document.addEventListener('adbx:deviceSelected', (e) => {
      if (this._active) this.stop();
    });
  },

  async start() {
    const serial = app.selectedSerial;
    if (!serial) return toast('No device selected', 'warning');

    const fps     = parseInt(document.getElementById('fps-select').value, 10)     || 30;
    const maxSize = parseInt(document.getElementById('quality-select').value, 10) || 720;

    try {
      const data = await app.apiPost(`/api/devices/${serial}/scrpy/start`, {
        maxFps: fps,
        maxSize,
        bitrate: 2000000,
      });

      // Subscribe to scrcpy frames over WebSocket
      if (app.ws && app.ws.readyState === WebSocket.OPEN) {
        app.ws.send(JSON.stringify({ type: 'subscribe_scrpy', serial }));
      }

      this._active = true;
      this._serial = serial;

      document.getElementById('device-view-container').hidden = false;
      document.getElementById('device-info-grid').hidden = true;
      this._overlay.classList.remove('hidden');
      this._overlay.innerHTML = '<span>Waiting for first frame…</span>';

      toast('Live view started', 'success');
    } catch (err) {
      toast('Could not start live view: ' + err.message, 'error');
    }
  },

  async stop() {
    if (!this._active) return;
    const serial = this._serial;
    this._active = false;
    this._serial = null;

    try {
      await app.apiPost(`/api/devices/${serial}/scrpy/stop`, {});
    } catch { /* ignore */ }

    document.getElementById('device-view-container').hidden = true;
    document.getElementById('device-info-grid').hidden = false;
    toast('Live view stopped', 'info');
  },

  /**
   * Called by app.js when a scrpyFrame WebSocket event arrives.
   * @param {string} serial
   * @param {string} base64Frame - base64-encoded JPEG/PNG frame
   */
  onFrame(serial, base64Frame) {
    if (!this._active || serial !== this._serial) return;

    const img = new Image();
    img.onload = () => {
      if (this._canvas.width !== img.naturalWidth) {
        this._canvas.width  = img.naturalWidth;
        this._canvas.height = img.naturalHeight;
      }
      this._ctx.drawImage(img, 0, 0);
      this._overlay.classList.add('hidden');
    };
    img.src = 'data:image/jpeg;base64,' + base64Frame;
  },

  _onCanvasClick(e) {
    if (!this._active || !this._serial) return;
    const rect   = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width  / rect.width;
    const scaleY = this._canvas.height / rect.height;
    const x = (e.clientX - rect.left)  * scaleX;
    const y = (e.clientY - rect.top)   * scaleY;

    if (app.ws && app.ws.readyState === WebSocket.OPEN) {
      app.ws.send(JSON.stringify({
        type: 'touch',
        serial: this._serial,
        x: Math.round(x),
        y: Math.round(y),
      }));
    }
  },
};

window.deviceView = deviceView;

// Initialize after DOM is ready (scripts are at end of body)
deviceView.init();
