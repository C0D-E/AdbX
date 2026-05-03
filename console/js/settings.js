/**
 * AdbX Console - Device Settings
 *
 * Handles applying Gaming, Performance, Security, Display, Audio,
 * Network, and other ADB settings to the selected device.
 */

'use strict';

const settings = {
  init() {
    document.getElementById('apply-gaming-btn')?.addEventListener('click',   () => this.applyGaming());
    document.getElementById('apply-perf-btn')?.addEventListener('click',     () => this.applyPerformance());
    document.getElementById('apply-security-btn')?.addEventListener('click', () => this.applySecurity());
    document.getElementById('apply-display-btn')?.addEventListener('click',  () => this.applyDisplay());
    document.getElementById('apply-audio-btn')?.addEventListener('click',    () => this.applyAudio());
    document.getElementById('apply-network-btn')?.addEventListener('click',  () => this.applyNetwork());
    document.getElementById('load-props-btn')?.addEventListener('click',     () => this.loadProperties());
    document.getElementById('run-custom-btn')?.addEventListener('click',     () => this.runCustomAdb());
  },

  requireDevice() {
    const serial = app.selectedSerial;
    if (!serial) { toast('No device selected', 'warning'); return null; }
    return serial;
  },

  async shell(serial, cmd) {
    return app.sendShell(serial, cmd);
  },

  /* ── Gaming ─────────────────────────────────────────────────────────── */
  async applyGaming() {
    const serial = this.requireDevice();
    if (!serial) return;

    const profile    = document.getElementById('gaming-profile').value;
    const resolution = document.getElementById('gaming-resolution').value;
    const fps        = document.getElementById('gaming-fps').value;

    try {
      // Set display resolution
      const resMap = { '480': '480x854', '720': '720x1280', '1080': '1080x1920' };
      const res = resMap[resolution] || '720x1280';
      await app.apiPost(`/api/devices/${serial}/display/resolution`, { resolution: res });

      // Disable animations for gaming
      if (profile === 'high') {
        await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'window_animation_scale', value: '0' });
        await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'transition_animation_scale', value: '0' });
        await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'animator_duration_scale', value: '0' });
      } else if (profile === 'medium') {
        await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'window_animation_scale', value: '0.5' });
        await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'transition_animation_scale', value: '0.5' });
        await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'animator_duration_scale', value: '0.5' });
      } else {
        await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'window_animation_scale', value: '1' });
        await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'transition_animation_scale', value: '1' });
        await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'animator_duration_scale', value: '1' });
      }

      toast(`Gaming profile "${profile}" applied (${resolution}p, ${fps}fps)`, 'success');
    } catch (err) {
      toast('Failed to apply gaming settings: ' + err.message, 'error');
    }
  },

  /* ── Performance ────────────────────────────────────────────────────── */
  async applyPerformance() {
    const serial = this.requireDevice();
    if (!serial) return;

    const animatorScale  = document.getElementById('animator-scale').value;
    const transitionScale = document.getElementById('transition-scale').value;
    const windowScale    = document.getElementById('window-scale').value;

    try {
      await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'animator_duration_scale', value: animatorScale });
      await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'transition_animation_scale', value: transitionScale });
      await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'window_animation_scale', value: windowScale });

      toast('Performance settings applied', 'success');
    } catch (err) {
      toast('Failed to apply performance settings: ' + err.message, 'error');
    }
  },

  /* ── Security ───────────────────────────────────────────────────────── */
  async applySecurity() {
    const serial = this.requireDevice();
    if (!serial) return;

    const stayAwake    = document.getElementById('stay-awake').value;
    const screenTimeout = document.getElementById('screen-timeout').value;

    try {
      await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'stay_on_while_plugged_in', value: stayAwake });
      await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'system', key: 'screen_off_timeout', value: screenTimeout });

      toast('Security settings applied', 'success');
    } catch (err) {
      toast('Failed to apply security settings: ' + err.message, 'error');
    }
  },

  /* ── Display ────────────────────────────────────────────────────────── */
  async applyDisplay() {
    const serial = this.requireDevice();
    if (!serial) return;

    const resolution = document.getElementById('display-resolution').value;
    const density    = document.getElementById('display-density').value;
    const brightness = document.getElementById('display-brightness').value;
    const autoRotate = document.getElementById('display-rotate').value;

    try {
      await app.apiPost(`/api/devices/${serial}/display/resolution`, { resolution });
      await app.apiPost(`/api/devices/${serial}/display/density`,    { dpi: density });
      await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'system', key: 'screen_brightness', value: brightness });
      await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'system', key: 'accelerometer_rotation', value: autoRotate });

      toast('Display settings applied', 'success');
    } catch (err) {
      toast('Failed to apply display settings: ' + err.message, 'error');
    }
  },

  /* ── Audio ──────────────────────────────────────────────────────────── */
  async applyAudio() {
    const serial = this.requireDevice();
    if (!serial) return;

    const media  = document.getElementById('audio-media').value;
    const ring   = document.getElementById('audio-ring').value;
    const notif  = document.getElementById('audio-notif').value;
    const system = document.getElementById('audio-system').value;

    try {
      // Use media_volume_index via settings, fallback to input keyevent approach
      await this.shell(serial, `media volume --stream 3 --set ${media}`);
      await this.shell(serial, `media volume --stream 2 --set ${ring}`);
      await this.shell(serial, `media volume --stream 5 --set ${notif}`);
      await this.shell(serial, `media volume --stream 1 --set ${system}`);

      toast('Audio settings applied', 'success');
    } catch (err) {
      toast('Failed to apply audio settings: ' + err.message, 'error');
    }
  },

  /* ── Network ────────────────────────────────────────────────────────── */
  async applyNetwork() {
    const serial = this.requireDevice();
    if (!serial) return;

    const wifi     = document.getElementById('wifi-state').value;
    const airplane = document.getElementById('airplane-mode').value;

    try {
      await this.shell(serial, `svc wifi ${wifi}`);
      await app.apiPost(`/api/devices/${serial}/settings`, { namespace: 'global', key: 'airplane_mode_on', value: airplane });
      if (airplane === '1') {
        await this.shell(serial, `am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true`);
      }

      toast('Network settings applied', 'success');
    } catch (err) {
      toast('Failed to apply network settings: ' + err.message, 'error');
    }
  },

  /* ── Load device properties ─────────────────────────────────────────── */
  async loadProperties() {
    const serial = this.requireDevice();
    if (!serial) return;

    const output = document.getElementById('props-output');
    output.textContent = 'Loading…';

    try {
      const props = await app.sendShell(serial, 'getprop');
      output.textContent = props;
    } catch (err) {
      output.textContent = 'Error: ' + err.message;
    }
  },

  /* ── Custom ADB command ─────────────────────────────────────────────── */
  async runCustomAdb() {
    const serial = this.requireDevice();
    if (!serial) return;

    const input  = document.getElementById('custom-adb-input').value.trim();
    const output = document.getElementById('custom-output');
    if (!input) return;

    output.textContent = 'Running…';

    // Support multi-line: run each line as a separate command
    const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
    const results = [];

    for (const line of lines) {
      // Strip leading "adb " or "shell " prefix if user types it
      const cmd = line.replace(/^adb\s+/, '').replace(/^shell\s+/, '');
      try {
        const result = await app.sendShell(serial, cmd);
        results.push(`$ ${cmd}\n${result}`);
      } catch (err) {
        results.push(`$ ${cmd}\nError: ${err.message}`);
      }
    }

    output.textContent = results.join('\n\n');
  },
};

window.settings = settings;
settings.init();
