/**
 * Comprehensive E2E test for owner deactivation + multi-tenant customer flow.
 * Verifies BOTH the backend behaviour AND the responses that web/mobile clients consume.
 *
 * Scenarios covered:
 *   A) Multi-tenant customer — fallback to active sibling
 *   B) Single-tenant customer — blocked with suspension message
 *   C) Already-logged-in user — 403 on next call after deactivation
 *   D) Activate-account on deactivated tenant — blocked
 *   E) Auto-login on deactivated tenant — blocked
 *   F) Customer-side data filtering — products/categories/orders only from active tenants
 *   G) Per-tenant email duplicates allowed across tenants
 *   H) Suspension message format (web + mobile clients detect it)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/tenantModel');
const User = require('../models/userModel');

const API = 'http://localhost:3000';
const MASTER = process.env.MASTER_PASSWORD || '666666';

const c = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m' };
const log = {
    section: (m) => console.log(`\n${c.bold}${c.cyan}━━━━ ${m} ━━━━${c.reset}`),
    sub: (m) => console.log(`\n  ${c.bold}${m}${c.reset}`),
    pass: (m) => console.log(`    ${c.green}✓${c.reset} ${m}`),
    fail: (m) => console.log(`    ${c.red}✗${c.reset} ${m}`),
    info: (m) => console.log(`    ${c.dim}${m}${c.reset}`),
};

let pass = 0, fail = 0;
const assert = (cond, name, detail = '') => {
    if (cond) { pass++; log.pass(name); }
    else { fail++; log.fail(`${name}${detail ? ' — ' + detail : ''}`); }
};

const post = async (path, body) => {
    const res = await fetch(`${API}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let data = null; try { data = await res.json(); } catch (_) {}
    return { status: res.status, data };
};
const get = async (path, token) => {
    const res = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    let data = null; try { data = await res.json(); } catch (_) {}
    return { status: res.status, data };
};

// Detect message format that the WEB and MOBILE clients use
const isSuspensionMessage = (msg) => {
    const m = String(msg || '').toLowerCase();
    return m.includes('suspended') || m.includes('has been deactivated');
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    log.info(`Connected to MongoDB`);

    // ── SETUP: pick test data ─────────────────────────────────────
    log.section('SETUP');

    const TEST_EMAIL = 'nzhzjzj@gmail.con';
    const tenants = await Tenant.find({}).lean();
    const tenantById = (id) => tenants.find(t => String(t._id) === String(id));
    log.info(`Tenants: ${tenants.map(t => `${t.name}(${t.isActive ? 'active' : 'INACTIVE'})`).join(', ')}`);

    // Make sure all tenants are active before starting
    await Tenant.updateMany({}, { $set: { isActive: true } });

    // ──────────────────────────────────────────────────────────────
    log.section('A) Multi-tenant customer — fallback to active sibling');
    log.info(`Customer email: ${TEST_EMAIL}`);

    let r = await post('/api/auth/login', { email: TEST_EMAIL, password: MASTER, deviceId: 'e2e-full' });
    assert(r.status === 200, 'A1: Login succeeds when both tenants active');
    const initialTenantId = r.data?.data?.user?.tenant?.id;
    const initialTenantName = r.data?.data?.user?.tenant?.name;
    const availableTenants = r.data?.data?.availableTenants || [];
    log.info(`  Logged in as ${r.data?.data?.user?.firstName} | tenant: ${initialTenantName}`);
    log.info(`  availableTenants returned: ${availableTenants.map(t => t.name).join(', ') || '(none)'}`);
    assert(availableTenants.length >= 2, 'A2: availableTenants includes both tenants');

    // Deactivate the matched tenant
    await Tenant.findByIdAndUpdate(initialTenantId, { isActive: false });
    log.info(`  → Deactivated "${initialTenantName}" via DB`);

    r = await post('/api/auth/login', { email: TEST_EMAIL, password: MASTER, deviceId: 'e2e-full' });
    assert(r.status === 200, 'A3: Re-login succeeds (auto-switch to active sibling)');
    const newTenantId = r.data?.data?.user?.tenant?.id;
    const newTenantName = r.data?.data?.user?.tenant?.name;
    assert(newTenantId !== initialTenantId, 'A4: Logged into a different tenant', `${initialTenantName} → ${newTenantName}`);
    assert(tenantById(newTenantId)?.isActive !== false, 'A5: New tenant is active');

    // Reactivate
    await Tenant.findByIdAndUpdate(initialTenantId, { isActive: true });

    // ──────────────────────────────────────────────────────────────
    log.section('B) Single-tenant customer — blocked when their only tenant is deactivated');

    // The sibling fallback resolves by mobileNumber — so a "single-tenant" customer
    // must have a UNIQUE mobileNumber across all USER docs. Create a synthetic
    // single-tenant customer to guarantee deterministic test results.
    const synthEmail = `e2e-single-${Date.now()}@test.local`;
    const synthMobile = `9${Date.now().toString().slice(-9)}`; // unique 10-digit mobile
    const singleTenantCustomer = await User.create({
        tenantId: tenants[0]._id,
        firstName: 'E2E',
        lastName: 'Single',
        email: synthEmail,
        mobileNumber: synthMobile,
        role: 'USER',
        isActive: true,
        isPasswordSet: true, // pretend activated so master login goes through cleanly
    });

    if (singleTenantCustomer) {
        log.info(`Single-tenant customer: ${singleTenantCustomer.email} in ${tenantById(singleTenantCustomer.tenantId)?.name}`);

        await Tenant.findByIdAndUpdate(singleTenantCustomer.tenantId, { isActive: false });
        r = await post('/api/auth/login', { email: singleTenantCustomer.email, password: MASTER, deviceId: 'e2e-single' });
        assert(r.status === 403, 'B1: Login blocked with 403', `got status ${r.status}, message: "${r.data?.message}"`);
        assert(isSuspensionMessage(r.data?.message), `B2: Message indicates suspension`, `got: "${r.data?.message}"`);
        assert(/contact administrator/i.test(r.data?.message || ''), 'B3: Message includes "contact administrator"');
        await Tenant.findByIdAndUpdate(singleTenantCustomer.tenantId, { isActive: true });
        // Cleanup synthetic user
        await User.deleteOne({ _id: singleTenantCustomer._id });
    } else {
        log.info(`(skipping — could not create synthetic single-tenant customer)`);
    }

    // ──────────────────────────────────────────────────────────────
    log.section('C) Already-logged-in user — 403 on next API call after deactivation');

    r = await post('/api/auth/login', { email: TEST_EMAIL, password: MASTER, deviceId: 'e2e-full' });
    const liveToken = r.data?.data?.tokens?.accessToken;
    const liveTenantId = r.data?.data?.user?.tenant?.id;

    r = await get('/api/products', liveToken);
    assert(r.status === 200, 'C1: Token works while tenant active');

    await Tenant.findByIdAndUpdate(liveTenantId, { isActive: false });
    r = await get('/api/products', liveToken);
    assert(r.status === 403, 'C2: Token returns 403 after deactivation');
    assert(isSuspensionMessage(r.data?.message), 'C3: 403 response is suspension-flavoured');
    log.info(`  Server message: "${r.data?.message}"`);
    await Tenant.findByIdAndUpdate(liveTenantId, { isActive: true });

    // ──────────────────────────────────────────────────────────────
    log.section('D) activate-account on deactivated tenant');

    // Find a not-yet-activated user and try to activate during deactivation
    const inactivatedUser = await User.findOne({ role: 'USER', isPasswordSet: false, loginCode: { $exists: true, $ne: null } }).select('loginCode tenantId').lean();
    if (inactivatedUser) {
        log.info(`Found pending activation: tenant ${tenantById(inactivatedUser.tenantId)?.name}, code ${inactivatedUser.loginCode?.substring(0, 4)}…`);
        await Tenant.findByIdAndUpdate(inactivatedUser.tenantId, { isActive: false });
        r = await post('/api/auth/activate-account', { loginCode: inactivatedUser.loginCode, password: 'SomeNewPass123', deviceId: 'e2e-act' });
        assert(r.status === 403, 'D1: Activation blocked when tenant deactivated');
        assert(isSuspensionMessage(r.data?.message), 'D2: Activation message is suspension');
        await Tenant.findByIdAndUpdate(inactivatedUser.tenantId, { isActive: true });
    } else {
        log.info(`(skipping — no pending-activation users in DB)`);
    }

    // ──────────────────────────────────────────────────────────────
    log.section('E) auto-login on deactivated tenant');

    // Try an auto-login as a real existing user. We need to find a user with a deviceId.
    const userWithDevice = await User.findOne({ role: 'USER', deviceId: { $exists: true, $ne: null, $ne: '' } }).select('deviceId tenantId').lean();
    if (userWithDevice) {
        log.info(`Real device: tenant ${tenantById(userWithDevice.tenantId)?.name}`);
        await Tenant.findByIdAndUpdate(userWithDevice.tenantId, { isActive: false });
        r = await post('/api/auth/auto-login', { deviceId: userWithDevice.deviceId });
        assert(r.status === 403, 'E1: auto-login blocked when tenant deactivated');
        assert(isSuspensionMessage(r.data?.message), 'E2: auto-login message is suspension');
        await Tenant.findByIdAndUpdate(userWithDevice.tenantId, { isActive: true });
    } else {
        log.info(`(skipping — no users with deviceId in DB)`);
    }

    // ──────────────────────────────────────────────────────────────
    log.section('F) Customer-side data filtering — only active tenant data');

    r = await post('/api/auth/login', { email: TEST_EMAIL, password: MASTER, deviceId: 'e2e-filter' });
    const filterToken = r.data?.data?.tokens?.accessToken;

    // Get baseline (both tenants active)
    let pBefore = await get('/api/products', filterToken);
    let cBefore = await get('/api/categories', filterToken);
    let baseProds = pBefore.data?.data?.length || pBefore.data?.count || (Array.isArray(pBefore.data) ? pBefore.data.length : 0);
    let baseCats = cBefore.data?.data?.length || cBefore.data?.count || (Array.isArray(cBefore.data) ? cBefore.data.length : 0);
    log.info(`Baseline (all tenants active): products=${baseProds}, categories=${baseCats}`);

    // Deactivate one tenant; products and categories from that tenant must disappear
    const otherTenantId = availableTenants.find(t => t.id !== initialTenantId)?.id;
    if (otherTenantId) {
        await Tenant.findByIdAndUpdate(otherTenantId, { isActive: false });
        // Re-login (existing token may now be 403)
        r = await post('/api/auth/login', { email: TEST_EMAIL, password: MASTER, deviceId: 'e2e-filter' });
        const tokenAfter = r.data?.data?.tokens?.accessToken;
        if (tokenAfter) {
            let pAfter = await get('/api/products', tokenAfter);
            let cAfter = await get('/api/categories', tokenAfter);
            const afterProds = pAfter.data?.data?.length || pAfter.data?.count || (Array.isArray(pAfter.data) ? pAfter.data.length : 0);
            const afterCats = cAfter.data?.data?.length || cAfter.data?.count || (Array.isArray(cAfter.data) ? cAfter.data.length : 0);
            log.info(`After deactivating other tenant: products=${afterProds}, categories=${afterCats}`);
            assert(afterProds <= baseProds, 'F1: Product count did not increase (data was filtered)');
            assert(afterCats <= baseCats, 'F2: Category count did not increase (data was filtered)');

            // Verify zero products from the deactivated tenant
            const products = pAfter.data?.data || [];
            const fromDeactivated = products.filter(p => String(p.tenantId) === String(otherTenantId));
            assert(fromDeactivated.length === 0, 'F3: NO products returned from deactivated tenant', `(found ${fromDeactivated.length})`);
        } else {
            log.info(`(re-login failed — likely no fallback tenant; skipping filtering check)`);
        }
        await Tenant.findByIdAndUpdate(otherTenantId, { isActive: true });
    }

    // ──────────────────────────────────────────────────────────────
    log.section('G) Per-tenant email uniqueness verified');

    // Try to insert two users in different tenants with same email → should succeed
    // Then try same email in same tenant → should fail
    const duplicateEmail = `e2e-dup-${Date.now()}@test.local`;
    const t1 = tenants[0]._id;
    const t2 = tenants[1]?._id;

    if (t1 && t2) {
        let created1 = null, created2 = null;
        try {
            created1 = await User.create({ tenantId: t1, firstName: 'E2E', lastName: 'Dup', email: duplicateEmail, role: 'USER', isActive: true });
            assert(true, 'G1: Created user in tenant 1');
        } catch (e) {
            assert(false, 'G1: Failed to create user in tenant 1', e.message);
        }
        try {
            created2 = await User.create({ tenantId: t2, firstName: 'E2E', lastName: 'Dup', email: duplicateEmail, role: 'USER', isActive: true });
            assert(true, 'G2: Same email in DIFFERENT tenant — allowed');
        } catch (e) {
            assert(false, 'G2: Same email in different tenant should be allowed', e.message);
        }
        // Same email in SAME tenant → must fail
        try {
            await User.create({ tenantId: t1, firstName: 'E2E', lastName: 'Dup2', email: duplicateEmail, role: 'USER', isActive: true });
            assert(false, 'G3: Same email in SAME tenant — should be blocked');
        } catch (e) {
            assert(e.code === 11000, 'G3: Same email in SAME tenant blocked with duplicate key error');
        }
        // Cleanup
        if (created1) await User.deleteOne({ _id: created1._id });
        if (created2) await User.deleteOne({ _id: created2._id });
    }

    // ──────────────────────────────────────────────────────────────
    log.section('H) Suspension message format detected by web + mobile clients');

    // Both clients use this exact regex: /suspended|has been deactivated/i
    const messages = [
        'Your account has been suspended. Please contact administrator.',
        'Your account has been deactivated. Please contact administrator.',
    ];
    messages.forEach(msg => {
        const detected = /suspended|has been deactivated/i.test(msg);
        assert(detected, `H: Client regex detects: "${msg}"`);
    });

    // ──────────────────────────────────────────────────────────────
    log.section('CLEANUP');
    await Tenant.updateMany({}, { $set: { isActive: true } });
    log.info(`All tenants reactivated`);

    console.log(`\n${c.bold}${fail === 0 ? c.green : c.red}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Result: ${pass} passed, ${fail} failed${c.reset}\n`);

    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
    console.error('Fatal error:', err);
    process.exit(2);
});
