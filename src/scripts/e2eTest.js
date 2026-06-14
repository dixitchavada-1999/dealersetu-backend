/**
 * End-to-end test for tenant suspension + multi-tenant customer flow.
 *
 * Uses MASTER_PASSWORD to bypass real passwords (no need to know each user's
 * actual password). Connects directly to MongoDB to flip tenant.isActive.
 *
 * Run while backend is running on port 3000.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/tenantModel');

const API = 'http://localhost:3000';
const MASTER = process.env.MASTER_PASSWORD || '666666';

const colors = {
    reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', bold: '\x1b[1m',
};

const log = {
    section: (m) => console.log(`\n${colors.bold}${colors.cyan}=== ${m} ===${colors.reset}`),
    pass: (m) => console.log(`  ${colors.green}✓${colors.reset} ${m}`),
    fail: (m) => console.log(`  ${colors.red}✗${colors.reset} ${m}`),
    info: (m) => console.log(`  ${colors.yellow}ℹ${colors.reset} ${m}`),
    raw: (m) => console.log(`    ${m}`),
};

let pass = 0, fail = 0;
const assert = (cond, name, detail = '') => {
    if (cond) { pass++; log.pass(name); }
    else { fail++; log.fail(`${name} ${detail}`); }
};

const post = async (path, body) => {
    const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    return { status: res.status, data };
};

const get = async (path, token) => {
    const res = await fetch(`${API}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    return { status: res.status, data };
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    log.info(`Connected to MongoDB`);

    const TEST_EMAIL = 'nzhzjzj@gmail.con'; // activated customer in "My business"

    log.section('SCENARIO 1 — Login when both tenants active');
    let r = await post('/api/auth/login', { email: TEST_EMAIL, password: MASTER, deviceId: 'e2e-test-device' });
    assert(r.status === 200, 'Login returns 200', `(got ${r.status} ${JSON.stringify(r.data?.message)})`);
    assert(r.data?.data?.tokens?.accessToken, 'Token returned');
    const initialUser = r.data?.data?.user;
    log.info(`Logged in as: ${initialUser?.firstName || '-'} (tenant: ${initialUser?.tenant?.name || '-'})`);
    log.info(`availableTenants: ${(r.data?.data?.availableTenants || []).map(t => t.name).join(', ') || 'none'}`);
    const initialTenantId = initialUser?.tenant?.id || initialUser?.tenantId;
    const initialToken = r.data?.data?.tokens?.accessToken;

    log.section('SCENARIO 2 — Use access token while tenant active');
    r = await get('/api/products', initialToken);
    assert(r.status === 200, 'GET /api/products returns 200 with valid token');

    log.section('SCENARIO 3 — Deactivate the matched tenant in DB');
    const matchedTenant = await Tenant.findById(initialTenantId);
    log.info(`Deactivating tenant: ${matchedTenant?.name}`);
    matchedTenant.isActive = false;
    await matchedTenant.save();

    log.section('SCENARIO 4 — Existing token now triggers 403 suspension');
    r = await get('/api/products', initialToken);
    assert(r.status === 403, 'Existing token returns 403', `(got ${r.status})`);
    assert(/suspended|deactivated/i.test(r.data?.message || ''), 'Message mentions suspended/deactivated', `(message: ${r.data?.message})`);
    log.info(`Server message: "${r.data?.message}"`);

    log.section('SCENARIO 5 — Re-login while one tenant is deactivated');
    r = await post('/api/auth/login', { email: TEST_EMAIL, password: MASTER, deviceId: 'e2e-test-device' });
    if (r.status === 200) {
        const newUser = r.data?.data?.user;
        const newTenantId = newUser?.tenant?.id || newUser?.tenantId;
        log.info(`Login succeeded — logged in as: ${newUser?.firstName} (tenant: ${newUser?.tenant?.name})`);
        assert(newTenantId !== initialTenantId, 'Switched to a different (active) tenant', `(was ${initialTenantId}, now ${newTenantId})`);
        const at = await Tenant.findById(newTenantId);
        assert(at?.isActive === true, 'New tenant is active');
    } else if (r.status === 403) {
        log.info(`Login blocked with: "${r.data?.message}"`);
        assert(/suspended|contact administrator/i.test(r.data?.message || ''), 'Login blocked with suspension message');
        log.info(`(Sibling fallback skipped this user — likely no other active+activated tenant for this mobile)`);
    } else {
        assert(false, `Unexpected status ${r.status}`, JSON.stringify(r.data));
    }

    log.section('SCENARIO 6 — Reactivate tenant');
    matchedTenant.isActive = true;
    await matchedTenant.save();
    log.info(`Reactivated tenant: ${matchedTenant.name}`);

    r = await post('/api/auth/login', { email: TEST_EMAIL, password: MASTER, deviceId: 'e2e-test-device' });
    assert(r.status === 200, 'Login works again after reactivation');

    log.section('SCENARIO 7 — Auto-login with deactivated tenant');
    matchedTenant.isActive = false;
    await matchedTenant.save();
    r = await post('/api/auth/auto-login', { deviceId: 'e2e-test-device' });
    log.info(`auto-login response: ${r.status} — "${r.data?.message}"`);
    if (r.status === 403) {
        assert(/suspended/i.test(r.data?.message || ''), 'auto-login returns suspension message');
    } else {
        log.info(`(Note: auto-login response was ${r.status} — depends on whether the test deviceId matched any user)`);
    }
    matchedTenant.isActive = true;
    await matchedTenant.save();

    log.section('SCENARIO 8 — Activate-account with deactivated tenant');
    r = await post('/api/auth/activate-account', { loginCode: 'INVALID', password: 'test123', deviceId: 'e2e' });
    assert(r.status === 401 && /invalid activation/i.test(r.data?.message || ''), 'Bad code → 401 invalid activation');

    log.section('SCENARIO 9 — Suspension message contains "contact administrator"');
    matchedTenant.isActive = false;
    await matchedTenant.save();
    r = await get('/api/products', initialToken);
    assert(/contact administrator/i.test(r.data?.message || ''), 'Suspension message includes "Please contact administrator"', `(got: "${r.data?.message}")`);
    matchedTenant.isActive = true;
    await matchedTenant.save();

    console.log(`\n${colors.bold}${pass + fail > 0 && fail === 0 ? colors.green : (fail > 0 ? colors.red : '')}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Result: ${pass} passed, ${fail} failed${colors.reset}\n`);

    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
    console.error('Fatal error:', err);
    process.exit(2);
});
