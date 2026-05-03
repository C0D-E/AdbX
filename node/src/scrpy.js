/**
 * AdbX Node - scrcpy Engine
 *
 * Manages scrcpy processes per device to capture and stream device screens.
 * Frames are emitted as 'frame' events so the WebSocket server can forward
 * them to connected browser clients.
 *
 * Requires scrcpy to be installed and available in PATH.
 */

'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class ScrpyEngine extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, {proc: import('child_process').ChildProcess, opts: object}>} */
    this._sessions = new Map();
  }

  /**
   * Start a scrcpy capture session for a device.
   * Scrcpy is launched with --no-display so it runs headlessly;
   * its raw H.264 frames are piped and emitted as 'frame' events.
   *
   * @param {string} serial - ADB device serial
   * @param {{ maxFps?: number, maxSize?: number, bitrate?: number }} opts
   */
  async start(serial, opts = {}) {
    if (this._sessions.has(serial)) {
      this.stop(serial);
    }

    const { maxFps = 30, maxSize = 1080, bitrate = 2000000 } = opts;

    const args = [
      '--serial', serial,
      '--no-display',
      '--no-audio',
      '--max-fps', String(maxFps),
      '--max-size', String(maxSize),
      '--bit-rate', String(bitrate),
      '--record', '-',           // stream raw H.264 to stdout
      '--record-format', 'h264',
    ];

    let proc;
    try {
      proc = spawn('scrcpy', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      throw new Error(`Failed to spawn scrcpy: ${err.message}. Ensure scrcpy is installed.`);
    }

    proc.stdout.on('data', (chunk) => {
      this.emit('frame', { serial, data: chunk });
    });

    proc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      if (line) console.log(`[SCRPY:${serial}] ${line}`);
    });

    proc.on('exit', (code) => {
      console.log(`[SCRPY:${serial}] Process exited with code ${code}`);
      this._sessions.delete(serial);
      this.emit('sessionEnd', { serial, code });
    });

    proc.on('error', (err) => {
      console.error(`[SCRPY:${serial}] Error: ${err.message}`);
      this._sessions.delete(serial);
      this.emit('sessionError', { serial, error: err });
    });

    this._sessions.set(serial, { proc, opts });
    console.log(`[SCRPY] Started session for ${serial} (${maxFps}fps, ${maxSize}px, ${bitrate}bps)`);
  }

  /**
   * Stop a scrcpy session for a device.
   * @param {string} serial
   */
  stop(serial) {
    const session = this._sessions.get(serial);
    if (session) {
      session.proc.kill('SIGTERM');
      this._sessions.delete(serial);
      console.log(`[SCRPY] Stopped session for ${serial}`);
    }
  }

  /**
   * Stop all active scrcpy sessions.
   */
  stopAll() {
    for (const serial of this._sessions.keys()) {
      this.stop(serial);
    }
  }

  /**
   * Check if a session is active for the given device.
   * @param {string} serial
   * @returns {boolean}
   */
  isActive(serial) {
    return this._sessions.has(serial);
  }

  /**
   * List serials with active sessions.
   * @returns {string[]}
   */
  activeSessions() {
    return [...this._sessions.keys()];
  }
}

module.exports = { ScrpyEngine };
