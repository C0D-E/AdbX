/**
 * AdbX Node - Main entry point
 *
 * Starts the background service that bridges Android devices (via ADB)
 * to the AdbX Console web UI over HTTP and WebSocket.
 */

'use strict';

const { createServer } = require('./server');
const { AdbManager } = require('./adb');
const { ScrpyEngine } = require('./scrpy');

const PORT = process.env.ADBX_PORT || 7272;
const HOST = process.env.ADBX_HOST || '127.0.0.1';

async function main() {
  console.log('[AdbX Node] Starting AdbX Node service...');

  const adbManager = new AdbManager();
  const scrpyEngine = new ScrpyEngine();

  const server = createServer({ adbManager, scrpyEngine });

  server.listen(PORT, HOST, () => {
    console.log(`[AdbX Node] HTTP server listening on http://${HOST}:${PORT}`);
    console.log('[AdbX Node] WebSocket endpoint: ws://' + HOST + ':' + PORT + '/ws');
  });

  // Start watching for ADB device changes
  adbManager.startTracking();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[AdbX Node] Shutting down...');
    adbManager.stopTracking();
    scrpyEngine.stopAll();
    server.close(() => {
      console.log('[AdbX Node] Server closed.');
      process.exit(0);
    });
  });

  process.on('SIGTERM', async () => {
    adbManager.stopTracking();
    scrpyEngine.stopAll();
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('[AdbX Node] Fatal error:', err);
  process.exit(1);
});
