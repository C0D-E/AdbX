/**
 * AdbX Core - Cloudflare Worker
 *
 * Cloud layer responsible for:
 *   - Authentication (JWT-based)
 *   - Routing API requests to registered AdbX Nodes
 *   - Device session management (Durable Objects via KV fallback)
 *   - Delivering the AdbX Console web UI
 *
 * Environment variables (set in Cloudflare dashboard or wrangler.toml):
 *   JWT_SECRET     - Secret used to sign/verify JWT tokens
 *   ALLOWED_ORIGIN - Comma-separated list of allowed CORS origins
 */

'use strict';

const CONSOLE_VERSION = '1.0.0';

/* ── CORS helper ──────────────────────────────────────────────────────── */
function corsHeaders(origin, allowedOrigins) {
  const allowed = allowedOrigins || '*';
  const list = typeof allowed === 'string' ? allowed.split(',').map(s => s.trim()) : allowed;
  const allowOrigin = list.includes('*') || list.includes(origin) ? origin : list[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function errorResponse(message, status = 400, extraHeaders = {}) {
  return jsonResponse({ error: message }, status, extraHeaders);
}

/* ── JWT helpers (minimal, no external libs) ──────────────────────────── */
async function signJWT(payload, secret) {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body    = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const enc     = new TextEncoder();
  const key     = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig     = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`));
  const sigB64  = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${header}.${body}.${sigB64}`;
}

async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`${header}.${body}`));
  if (!valid) return null;
  const payload = JSON.parse(atob(body));
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

function extractBearer(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/* ── Main fetch handler ───────────────────────────────────────────────── */
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors   = corsHeaders(origin, env.ALLOWED_ORIGIN);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const path = url.pathname;

    /* ── Health check ─────────────────────────────────────────────── */
    if (path === '/health') {
      return jsonResponse({ status: 'ok', version: CONSOLE_VERSION }, 200, cors);
    }

    /* ── Authentication ───────────────────────────────────────────── */
    if (path === '/auth/login' && request.method === 'POST') {
      return this.handleLogin(request, env, cors);
    }

    if (path === '/auth/refresh' && request.method === 'POST') {
      return this.handleRefresh(request, env, cors);
    }

    /* ── Protected routes (require valid JWT) ─────────────────────── */
    if (path.startsWith('/api/')) {
      const token = extractBearer(request);
      if (!token) return errorResponse('Unauthorized', 401, cors);

      const jwtSecret = env.JWT_SECRET || 'dev-secret-change-me';
      const payload   = await verifyJWT(token, jwtSecret);
      if (!payload) return errorResponse('Invalid or expired token', 401, cors);

      return this.handleApi(request, url, env, cors, payload);
    }

    /* ── 404 ──────────────────────────────────────────────────────── */
    return errorResponse('Not found', 404, cors);
  },

  /* ── Login ──────────────────────────────────────────────────────── */
  async handleLogin(request, env, cors) {
    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON', 400, cors); }

    const { username, password } = body;
    if (!username || !password) return errorResponse('username and password required', 400, cors);

    // In production this would validate against a user store.
    // For demonstration a fixed dev credential is accepted when no KV is configured.
    const storedHash = env.USER_KV ? await env.USER_KV.get(`user:${username}`) : null;
    const devMode    = !storedHash && username === 'admin' && password === 'adbx';
    const valid      = devMode || (storedHash && storedHash === await sha256(password));

    if (!valid) return errorResponse('Invalid credentials', 401, cors);

    const secret  = env.JWT_SECRET || 'dev-secret-change-me';
    const now     = Math.floor(Date.now() / 1000);
    const token   = await signJWT({ sub: username, iat: now, exp: now + 3600 }, secret);
    const refresh = await signJWT({ sub: username, iat: now, exp: now + 86400, type: 'refresh' }, secret);

    return jsonResponse({ token, refresh, expiresIn: 3600 }, 200, cors);
  },

  /* ── Token refresh ─────────────────────────────────────────────── */
  async handleRefresh(request, env, cors) {
    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON', 400, cors); }

    const secret  = env.JWT_SECRET || 'dev-secret-change-me';
    const payload = await verifyJWT(body.refresh, secret);
    if (!payload || payload.type !== 'refresh') return errorResponse('Invalid refresh token', 401, cors);

    const now   = Math.floor(Date.now() / 1000);
    const token = await signJWT({ sub: payload.sub, iat: now, exp: now + 3600 }, secret);
    return jsonResponse({ token, expiresIn: 3600 }, 200, cors);
  },

  /* ── API routes ─────────────────────────────────────────────────── */
  async handleApi(request, url, env, cors, authPayload) {
    const path = url.pathname;

    /* ── Sessions ─────────────────────────────────────────────── */
    if (path === '/api/sessions' && request.method === 'GET') {
      const sessions = await this.listSessions(env);
      return jsonResponse({ sessions }, 200, cors);
    }

    if (path === '/api/sessions' && request.method === 'POST') {
      return this.createSession(request, env, cors, authPayload);
    }

    if (path.match(/^\/api\/sessions\/[\w-]+$/) && request.method === 'DELETE') {
      const id = path.split('/').pop();
      await this.deleteSession(id, env);
      return jsonResponse({ success: true }, 200, cors);
    }

    /* ── Nodes (registered AdbX Node endpoints) ───────────────── */
    if (path === '/api/nodes' && request.method === 'GET') {
      const nodes = await this.listNodes(env);
      return jsonResponse({ nodes }, 200, cors);
    }

    if (path === '/api/nodes' && request.method === 'POST') {
      return this.registerNode(request, env, cors, authPayload);
    }

    if (path.match(/^\/api\/nodes\/[\w-]+$/) && request.method === 'DELETE') {
      const id = path.split('/').pop();
      await this.deleteNode(id, env);
      return jsonResponse({ success: true }, 200, cors);
    }

    /* ── Proxy request to a Node ──────────────────────────────── */
    if (path.startsWith('/api/proxy/')) {
      return this.proxyToNode(request, url, env, cors);
    }

    return errorResponse('API route not found', 404, cors);
  },

  /* ── Session management ─────────────────────────────────────────── */
  async listSessions(env) {
    if (!env.SESSIONS_KV) return [];
    const list = await env.SESSIONS_KV.list({ prefix: 'session:' });
    const sessions = await Promise.all(
      list.keys.map(async (k) => {
        const v = await env.SESSIONS_KV.get(k.name, { type: 'json' });
        return v;
      })
    );
    return sessions.filter(Boolean);
  },

  async createSession(request, env, cors, authPayload) {
    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON', 400, cors); }

    const sessionId = crypto.randomUUID();
    const session   = {
      id:        sessionId,
      nodeId:    body.nodeId,
      serial:    body.serial,
      user:      authPayload.sub,
      createdAt: new Date().toISOString(),
    };

    if (env.SESSIONS_KV) {
      await env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: 86400 });
    }

    return jsonResponse({ session }, 201, cors);
  },

  async deleteSession(id, env) {
    if (env.SESSIONS_KV) {
      await env.SESSIONS_KV.delete(`session:${id}`);
    }
  },

  /* ── Node registry ──────────────────────────────────────────────── */
  async listNodes(env) {
    if (!env.NODES_KV) return [];
    const list = await env.NODES_KV.list({ prefix: 'node:' });
    const nodes = await Promise.all(
      list.keys.map(async (k) => env.NODES_KV.get(k.name, { type: 'json' }))
    );
    return nodes.filter(Boolean);
  },

  async registerNode(request, env, cors, authPayload) {
    let body;
    try { body = await request.json(); } catch { return errorResponse('Invalid JSON', 400, cors); }
    if (!body.url) return errorResponse('url is required', 400, cors);

    const nodeId = crypto.randomUUID();
    const node   = {
      id:          nodeId,
      url:         body.url,
      label:       body.label || nodeId,
      owner:       authPayload.sub,
      registeredAt: new Date().toISOString(),
    };

    if (env.NODES_KV) {
      await env.NODES_KV.put(`node:${nodeId}`, JSON.stringify(node));
    }

    return jsonResponse({ node }, 201, cors);
  },

  async deleteNode(id, env) {
    if (env.NODES_KV) {
      await env.NODES_KV.delete(`node:${id}`);
    }
  },

  /* ── Proxy to AdbX Node ─────────────────────────────────────────── */
  async proxyToNode(request, url, env, cors) {
    // /api/proxy/:nodeId/<path>
    const parts  = url.pathname.split('/');
    const nodeId = parts[3];
    const tail   = '/' + parts.slice(4).join('/');

    if (!nodeId) return errorResponse('nodeId required', 400, cors);

    let nodeUrl;
    if (env.NODES_KV) {
      const node = await env.NODES_KV.get(`node:${nodeId}`, { type: 'json' });
      if (!node) return errorResponse('Node not found', 404, cors);
      nodeUrl = node.url;
    } else {
      return errorResponse('Node registry not configured', 503, cors);
    }

    const targetUrl = nodeUrl.replace(/\/$/, '') + tail + url.search;
    const proxyReq  = new Request(targetUrl, {
      method:  request.method,
      headers: request.headers,
      body:    ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    });

    try {
      const response = await fetch(proxyReq);
      const headers  = new Headers(response.headers);
      Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      return errorResponse('Node unreachable: ' + err.message, 502, cors);
    }
  },
};

/* ── Utility ──────────────────────────────────────────────────────────── */
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
