// 200-user capacity test (run against a LOAD_TEST=true instance so the per-IP
// rate limits — which only exist because all traffic is from one test machine —
// don't mask true server capacity). Phases: register → login → concurrent reads.
// Pure Node http, keep-alive, concurrency-controlled. No deps.
import http from 'node:http';
import https from 'node:https';

// BASE accepts a full URL so this runs against local OR a staging/prod https host.
// e.g. BASE=https://dealersetu-backend-staging.up.railway.app N=200 node load-test-200.mjs
const BASE = process.env.BASE || `http://localhost:${process.env.PORT || 3001}`;
const U = new URL(BASE);
const isHttps = U.protocol === 'https:';
const lib = isHttps ? https : http;
const PORTNUM = U.port ? Number(U.port) : (isHttps ? 443 : 80);
const N = Number(process.env.N || 200);
const RUN = String(Date.now()).slice(-6);
const agent = new lib.Agent({ keepAlive: true, maxSockets: 300 });

function call({ method = 'GET', path, headers = {}, body }) {
  const data = body ? JSON.stringify(body) : null;
  const t0 = process.hrtime.bigint();
  return new Promise((resolve) => {
    const r = lib.request({ hostname: U.hostname, port: PORTNUM, path, method, agent, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6, body: buf }));
    });
    r.on('error', (e) => resolve({ status: 0, ms: Number(process.hrtime.bigint() - t0) / 1e6, body: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

function report(name, results) {
  const lat = results.map((r) => r.ms);
  const status = {};
  for (const r of results) status[r.status] = (status[r.status] || 0) + 1;
  const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
  console.log(`\n── ${name} ──`);
  console.log(`  ok: ${ok}/${results.length}   status: ${Object.entries(status).map(([s, c]) => `${s}×${c}`).join('  ')}`);
  console.log(`  latency ms — p50:${pct(lat,50).toFixed(0)} p95:${pct(lat,95).toFixed(0)} p99:${pct(lat,99).toFixed(0)} max:${pct(lat,100).toFixed(0)}`);
  return { name, ok, total: results.length, status, p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99) };
}

const users = Array.from({ length: N }, (_, i) => ({
  firstName: 'LT', lastName: `U${i}`,
  email: `loadtest.${RUN}.${i}@example.com`,
  userName: `lt${RUN}u${i}`,
  password: 'Test@1234',
  mobileNumber: `9${RUN}${String(i).padStart(4, '0')}`.slice(0, 12),
  businessName: `LT ${RUN} ${i}`,
  token: null,
}));

console.log(`Capacity test: ${N} users against ${BASE}  (run ${RUN})`);

// Probe that the target is up + bypass active
const probe = await call({ path: '/health' });
console.log(`Health: ${probe.status} ${probe.status === 200 ? '(target up)' : '(NOT reachable — check BASE / instance)'}`);
if (probe.status !== 200) process.exit(1);

// ── Phase 1: REGISTER 200 concurrently ──
const t1 = Date.now();
const reg = await pool(users, 100, async (u) => {
  const r = await call({ method: 'POST', path: '/api/auth/register', body: u });
  try { u.token = JSON.parse(r.body)?.data?.tokens?.accessToken || null; } catch {}
  return r;
});
const regWall = (Date.now() - t1) / 1000;
const r1 = report(`REGISTER ${N} (concurrency 100, ${regWall.toFixed(2)}s, ${(reg.length / regWall).toFixed(0)} req/s)`, reg);

// ── Phase 2: LOGIN 200 concurrently ──
const t2 = Date.now();
const login = await pool(users, 100, async (u) => {
  const r = await call({ method: 'POST', path: '/api/auth/login', body: { email: u.email, password: u.password, deviceId: `lt-${u.userName}` } });
  try { const tok = JSON.parse(r.body)?.data?.tokens?.accessToken; if (tok) u.token = tok; } catch {}
  return r;
});
const loginWall = (Date.now() - t2) / 1000;
const r2 = report(`LOGIN ${N} (concurrency 100, ${loginWall.toFixed(2)}s, ${(login.length / loginWall).toFixed(0)} req/s)`, login);

// ── Phase 3: 200 concurrent authed reads (all at once) ──
const authed = users.filter((u) => u.token);
const t3 = Date.now();
const reads = await pool(authed, N, async (u) => call({ path: '/api/products', headers: { Authorization: `Bearer ${u.token}` } }));
const readWall = (Date.now() - t3) / 1000;
const r3 = report(`READ /api/products ×${authed.length} ALL-AT-ONCE (${readWall.toFixed(2)}s, ${(reads.length / readWall).toFixed(0)} req/s)`, reads);

// ── Phase 4: 200 concurrent dashboard (heaviest endpoint) ──
const t4 = Date.now();
const dash = await pool(authed, N, async (u) => call({ path: '/api/dashboard', headers: { Authorization: `Bearer ${u.token}` } }));
const dashWall = (Date.now() - t4) / 1000;
const r4 = report(`READ /api/dashboard ×${authed.length} ALL-AT-ONCE (${dashWall.toFixed(2)}s, ${(dash.length / dashWall).toFixed(0)} req/s)`, dash);

// ── Verdict ──
const allOk = [r1, r2, r3, r4].every((r) => r.ok / r.total >= 0.99);
const errors = [r1, r2, r3, r4].flatMap((r) => Object.entries(r.status).filter(([s]) => Number(s) >= 500 || Number(s) === 0));
console.log(`\n========== VERDICT (${N} simultaneous users) ==========`);
console.log(`Register: ${r1.ok}/${N}  | Login: ${r2.ok}/${N}  | Reads: ${r3.ok}/${r3.total}  | Dashboard: ${r4.ok}/${r4.total}`);
console.log(`Worst-case latency under full load: reads p99 ${r3.p99.toFixed(0)}ms, dashboard p99 ${r4.p99.toFixed(0)}ms`);
console.log(errors.length ? `⚠️  Server errors/timeouts: ${errors.map(([s, c]) => `${s}×${c}`).join(' ')}` : `✅ Zero server errors / timeouts (no 5xx, no dropped connections)`);
console.log(allOk ? `✅ Handled ${N} simultaneous users cleanly (≥99% success every phase).` : `⚠️  Some phase dropped below 99% success — see above.`);
console.log(`Test users tagged: loadtest.${RUN}.*@example.com  (cleanup: delete by this prefix)`);
console.log('=====================================================');
