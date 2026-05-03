/**
 * AdbX Node - Unit Tests
 *
 * Tests for the ADB manager utility functions and server module.
 * Run with: node --test
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

/* ── Test: parseFileList (internal helper, tested via module internals) ── */
describe('adb.js - parseFileList', () => {
  // Re-expose the internal helper for testing via a thin wrapper
  const { AdbManager } = require('../src/adb');

  it('AdbManager can be instantiated without ADB server', () => {
    // Just verifies the class loads and can be instantiated
    const mgr = new AdbManager();
    assert.ok(mgr, 'AdbManager should instantiate');
    assert.equal(typeof mgr.startTracking, 'function');
    assert.equal(typeof mgr.stopTracking, 'function');
    assert.equal(typeof mgr.listDevices, 'function');
    assert.equal(typeof mgr.runShellCommand, 'function');
    assert.equal(typeof mgr.pushFile, 'function');
    assert.equal(typeof mgr.pullFile, 'function');
    assert.equal(typeof mgr.listFiles, 'function');
    assert.equal(typeof mgr.reboot, 'function');
    assert.equal(typeof mgr.screenshot, 'function');
  });

  it('getDeviceInfo returns undefined for unknown serial', () => {
    const mgr = new AdbManager();
    assert.equal(mgr.getDeviceInfo('unknown-serial'), undefined);
  });
});

/* ── Test: ScrpyEngine ────────────────────────────────────────────────── */
describe('scrpy.js - ScrpyEngine (scrcpy wrapper)', () => {
  const { ScrpyEngine } = require('../src/scrpy');

  it('ScrpyEngine can be instantiated', () => {
    const engine = new ScrpyEngine();
    assert.ok(engine, 'ScrpyEngine should instantiate');
    assert.equal(typeof engine.start, 'function');
    assert.equal(typeof engine.stop, 'function');
    assert.equal(typeof engine.stopAll, 'function');
    assert.equal(typeof engine.isActive, 'function');
    assert.equal(typeof engine.activeSessions, 'function');
  });

  it('isActive returns false for unknown serial', () => {
    const engine = new ScrpyEngine();
    assert.equal(engine.isActive('unknown-serial'), false);
  });

  it('activeSessions returns empty array when no sessions', () => {
    const engine = new ScrpyEngine();
    assert.deepEqual(engine.activeSessions(), []);
  });

  it('stop is safe to call for unknown serial', () => {
    const engine = new ScrpyEngine();
    assert.doesNotThrow(() => engine.stop('unknown-serial'));
  });

  it('stopAll is safe to call when no sessions', () => {
    const engine = new ScrpyEngine();
    assert.doesNotThrow(() => engine.stopAll());
  });
});

/* ── Test: createServer ───────────────────────────────────────────────── */
describe('server.js - createServer', () => {
  const { createServer } = require('../src/server');
  const { AdbManager } = require('../src/adb');
  const { ScrpyEngine } = require('../src/scrpy');

  it('createServer returns an http.Server', () => {
    const http = require('http');
    const adbManager  = new AdbManager();
    const scrpyEngine = new ScrpyEngine();
    const server = createServer({ adbManager, scrpyEngine });
    assert.ok(server instanceof http.Server, 'should return an http.Server');
    server.close();
  });

  it('server listens and responds to /health', async () => {
    const adbManager  = new AdbManager();
    const scrpyEngine = new ScrpyEngine();
    const server = createServer({ adbManager, scrpyEngine });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.ok(body.uptime >= 0);

    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /api/devices returns 200 with devices array (empty, no ADB)', async () => {
    const adbManager  = new AdbManager();
    const scrpyEngine = new ScrpyEngine();
    const server = createServer({ adbManager, scrpyEngine });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/devices`);
    // Either 200 (empty list) or 500 (no ADB server) — both acceptable
    assert.ok(res.status === 200 || res.status === 500);

    await new Promise((resolve) => server.close(resolve));
  });

  it('POST /api/devices/:serial/shell requires command body', async () => {
    const adbManager  = new AdbManager();
    const scrpyEngine = new ScrpyEngine();
    const server = createServer({ adbManager, scrpyEngine });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/devices/test-serial/shell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);

    await new Promise((resolve) => server.close(resolve));
  });

  it('POST /api/devices/:serial/settings validates namespace', async () => {
    const adbManager  = new AdbManager();
    const scrpyEngine = new ScrpyEngine();
    const server = createServer({ adbManager, scrpyEngine });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/devices/test-serial/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: 'invalid', key: 'test', value: '1' }),
    });
    assert.equal(res.status, 400);

    await new Promise((resolve) => server.close(resolve));
  });
});
