/**
 * AdbX Node - ADB Device Manager
 *
 * Handles ADB device discovery, tracking, command execution,
 * shell access, and file transfer using @devicefarmer/adbkit.
 */

'use strict';

const { Adb } = require('@devicefarmer/adbkit');
const { EventEmitter } = require('events');

class AdbManager extends EventEmitter {
  constructor() {
    super();
    this._client = Adb.createClient();
    this._tracker = null;
    this._devices = new Map(); // serialNumber -> deviceInfo
  }

  /**
   * Begin tracking device connect/disconnect events.
   */
  startTracking() {
    this._client.trackDevices()
      .then((tracker) => {
        this._tracker = tracker;

        tracker.on('add', (device) => {
          console.log(`[AdbManager] Device added: ${device.id} (${device.type})`);
          this._devices.set(device.id, { id: device.id, type: device.type });
          this._enrichDevice(device.id).catch(() => {});
          this.emit('deviceAdded', device);
        });

        tracker.on('remove', (device) => {
          console.log(`[AdbManager] Device removed: ${device.id}`);
          this._devices.delete(device.id);
          this.emit('deviceRemoved', device);
        });

        tracker.on('change', (device) => {
          this._devices.set(device.id, {
            ...this._devices.get(device.id),
            type: device.type,
          });
          this.emit('deviceChanged', device);
        });

        tracker.on('error', (err) => {
          console.error('[AdbManager] Tracker error:', err.message);
          this.emit('trackerError', err);
        });

        tracker.on('end', () => {
          console.log('[AdbManager] Tracker ended.');
        });
      })
      .catch((err) => {
        console.error('[AdbManager] Could not start device tracker:', err.message);
        console.error('[AdbManager] Make sure ADB server is running (adb start-server)');
      });
  }

  /**
   * Stop tracking device changes.
   */
  stopTracking() {
    if (this._tracker) {
      this._tracker.end();
      this._tracker = null;
    }
  }

  /**
   * Get list of currently connected devices with info.
   * @returns {Promise<Array>}
   */
  async listDevices() {
    try {
      const devices = await this._client.listDevices();
      const enriched = await Promise.allSettled(
        devices.map((d) => this._enrichDevice(d.id))
      );
      return enriched
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);
    } catch (err) {
      console.error('[AdbManager] listDevices error:', err.message);
      return [];
    }
  }

  /**
   * Fetch device properties and enrich stored device info.
   * @param {string} serial - Device serial number
   * @returns {Promise<Object>}
   */
  async _enrichDevice(serial) {
    const props = await this._getDeviceProperties(serial);
    const info = {
      id: serial,
      type: this._devices.get(serial)?.type || 'device',
      model: props['ro.product.model'] || 'Unknown',
      manufacturer: props['ro.product.manufacturer'] || 'Unknown',
      androidVersion: props['ro.build.version.release'] || 'Unknown',
      sdkVersion: props['ro.build.version.sdk'] || 'Unknown',
      product: props['ro.product.name'] || 'Unknown',
      brand: props['ro.product.brand'] || 'Unknown',
      resolution: await this._getResolution(serial),
      ram: await this._getRamInfo(serial),
    };
    this._devices.set(serial, info);
    return info;
  }

  /**
   * Get all system properties from a device.
   * @param {string} serial
   * @returns {Promise<Object>}
   */
  async _getDeviceProperties(serial) {
    try {
      const props = await this._client.getProperties(serial);
      return props;
    } catch {
      return {};
    }
  }

  /**
   * Get screen resolution via wm size.
   * @param {string} serial
   * @returns {Promise<string>}
   */
  async _getResolution(serial) {
    try {
      const output = await this.runShellCommand(serial, 'wm size');
      const match = output.match(/Physical size:\s*(\d+x\d+)/);
      return match ? match[1] : 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Get total RAM info via /proc/meminfo.
   * @param {string} serial
   * @returns {Promise<string>}
   */
  async _getRamInfo(serial) {
    try {
      const output = await this.runShellCommand(serial, 'cat /proc/meminfo | head -1');
      const match = output.match(/MemTotal:\s+(\d+)\s+kB/);
      if (match) {
        const mb = Math.round(parseInt(match[1], 10) / 1024);
        return `${mb} MB`;
      }
      return 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Get stored info for a device.
   * @param {string} serial
   * @returns {Object|undefined}
   */
  getDeviceInfo(serial) {
    return this._devices.get(serial);
  }

  /**
   * Execute a shell command on a device and return its stdout as a string.
   * @param {string} serial
   * @param {string} command
   * @returns {Promise<string>}
   */
  async runShellCommand(serial, command) {
    const stream = await this._client.shell(serial, command);
    return collectStream(stream);
  }

  /**
   * Push a file to the device.
   * @param {string} serial
   * @param {string} localPath - Path on host
   * @param {string} remotePath - Path on device
   * @returns {Promise<void>}
   */
  async pushFile(serial, localPath, remotePath) {
    const transfer = await this._client.push(serial, localPath, remotePath);
    return new Promise((resolve, reject) => {
      transfer.on('end', resolve);
      transfer.on('error', reject);
    });
  }

  /**
   * Pull a file from the device.
   * @param {string} serial
   * @param {string} remotePath - Path on device
   * @param {string} localPath - Path on host
   * @returns {Promise<void>}
   */
  async pullFile(serial, remotePath, localPath) {
    const transfer = await this._client.pull(serial, remotePath);
    const fs = require('fs');
    const dest = fs.createWriteStream(localPath);
    return new Promise((resolve, reject) => {
      transfer.pipe(dest);
      transfer.on('end', resolve);
      transfer.on('error', reject);
    });
  }

  /**
   * List files in a directory on the device.
   * @param {string} serial
   * @param {string} remotePath
   * @returns {Promise<Array<{name: string, type: string, size: number, mtime: number}>>}
   */
  async listFiles(serial, remotePath) {
    try {
      const output = await this.runShellCommand(
        serial,
        `ls -la "${remotePath}" 2>/dev/null`
      );
      return parseFileList(output);
    } catch {
      return [];
    }
  }

  /**
   * Reboot the device.
   * @param {string} serial
   * @returns {Promise<void>}
   */
  async reboot(serial) {
    return this._client.reboot(serial);
  }

  /**
   * Install an APK on the device.
   * @param {string} serial
   * @param {string} apkPath
   * @returns {Promise<void>}
   */
  async installApk(serial, apkPath) {
    return this._client.install(serial, apkPath);
  }

  /**
   * Take a screenshot of the device screen.
   * @param {string} serial
   * @returns {Promise<Buffer>}
   */
  async screenshot(serial) {
    const stream = await this._client.screencap(serial);
    const chunks = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}

/**
 * Collect a readable stream into a string.
 * @param {import('stream').Readable} stream
 * @returns {Promise<string>}
 */
function collectStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
    stream.on('error', reject);
  });
}

/**
 * Parse `ls -la` output into file entry objects.
 * @param {string} output
 * @returns {Array}
 */
function parseFileList(output) {
  const lines = output.split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    if (line.startsWith('total')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 8) continue;
    const perms = parts[0];
    const size = parseInt(parts[4], 10) || 0;
    const name = parts.slice(7).join(' ');
    if (name === '.' || name === '..') continue;
    entries.push({
      name,
      type: perms.startsWith('d') ? 'directory' : 'file',
      size,
      permissions: perms,
    });
  }
  return entries;
}

module.exports = { AdbManager };
