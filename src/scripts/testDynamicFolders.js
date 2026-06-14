/**
 * Verify dynamic per-tenant Cloudinary folders.
 *
 * For each ADMIN user in the DB:
 *   1. Login (master password)
 *   2. Upload one image with module=products
 *   3. Verify the returned URL contains b2b-app/<tenantId>/products/
 *
 * Also tests:
 *   • Without module param → folder=general
 *   • module=banners → folder=banners
 *   • Invalid module=xss/../bad → folder=general (whitelisted)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/userModel');

const API = 'http://localhost:3000';
const MASTER = process.env.MASTER_PASSWORD || '666666';

const c = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', dim: '\x1b[2m', yellow: '\x1b[33m' };

let pass = 0, fail = 0;
const assert = (cond, msg, detail = '') => {
    if (cond) { pass++; console.log(`  ${c.green}✓${c.reset} ${msg}`); }
    else { fail++; console.log(`  ${c.red}✗${c.reset} ${msg}${detail ? ' — ' + detail : ''}`); }
};

const login = async (admin) => {
    const body = { password: MASTER, deviceId: 'dynfolder-test' };
    if (admin.email) body.email = admin.email;
    else if (admin.userName) body.userName = admin.userName;
    const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    return data?.data?.tokens?.accessToken;
};

const uploadWith = async (token, testFile, fieldName, fieldValue, query = '') => {
    const buffer = fs.readFileSync(testFile);
    const fd = new FormData();
    // Important: non-file fields must come BEFORE the file in FormData so
    // multer parses them into req.body before the storage handler fires.
    if (fieldValue !== undefined) fd.append(fieldName, fieldValue);
    fd.append('image', new Blob([buffer], { type: 'image/jpeg' }), path.basename(testFile));
    const res = await fetch(`${API}/api/upload/image${query}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
    });
    const data = await res.json();
    return data?.data?.imageUrl;
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const files = fs.readdirSync(uploadsDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
    if (!files.length) { console.error('No test images'); process.exit(1); }
    const testFile = path.join(uploadsDir, files[0]);

    // Test 1: ADMIN with tenantId, module=products
    console.log(`\n${c.cyan}━━━ Test 1: ADMIN + module=products ━━━${c.reset}`);
    const admin1 = await User.findOne({ role: 'ADMIN' }).lean();
    if (!admin1) { console.error('No ADMIN user'); process.exit(1); }
    const token1 = await login(admin1);
    if (!token1) { console.error('Login failed'); process.exit(1); }
    const url1 = await uploadWith(token1, testFile, 'module', 'products');
    console.log(`  ${c.dim}URL: ${url1}${c.reset}`);
    assert(/cloudinary\.com/.test(url1), 'URL is Cloudinary');
    assert(url1.includes(`b2b-app/${admin1.tenantId}/products/`), `Folder includes b2b-app/${admin1.tenantId}/products/`);

    // Test 2: Different ADMIN (different tenant), module=banners
    console.log(`\n${c.cyan}━━━ Test 2: Different ADMIN + module=banners ━━━${c.reset}`);
    const admin2 = await User.findOne({ role: 'ADMIN', tenantId: { $ne: admin1.tenantId } }).lean();
    if (admin2) {
        const token2 = await login(admin2);
        const url2 = await uploadWith(token2, testFile, 'module', 'banners');
        console.log(`  ${c.dim}URL: ${url2}${c.reset}`);
        assert(url2.includes(`b2b-app/${admin2.tenantId}/banners/`), `Folder includes b2b-app/${admin2.tenantId}/banners/`);
        assert(!url2.includes(`b2b-app/${admin1.tenantId}/`), 'Does NOT bleed into other tenant folder');
    } else {
        console.log(`  ${c.yellow}skipped — only one tenant in DB${c.reset}`);
    }

    // Test 3: No module param → general
    console.log(`\n${c.cyan}━━━ Test 3: No module param ━━━${c.reset}`);
    const url3 = await uploadWith(token1, testFile, 'module', undefined);
    console.log(`  ${c.dim}URL: ${url3}${c.reset}`);
    assert(url3.includes(`b2b-app/${admin1.tenantId}/general/`), 'Defaults to general folder');

    // Test 4: Invalid module (path injection attempt) → general
    console.log(`\n${c.cyan}━━━ Test 4: Invalid module param (security) ━━━${c.reset}`);
    const url4 = await uploadWith(token1, testFile, 'module', '../../evil');
    console.log(`  ${c.dim}URL: ${url4}${c.reset}`);
    assert(url4.includes(`b2b-app/${admin1.tenantId}/general/`), 'Invalid module rejected, falls back to general');
    assert(!url4.includes('..'), 'No path traversal');

    // Test 5: Module via query string
    console.log(`\n${c.cyan}━━━ Test 5: module via query string ━━━${c.reset}`);
    const url5 = await uploadWith(token1, testFile, 'module', undefined, '?module=categories');
    console.log(`  ${c.dim}URL: ${url5}${c.reset}`);
    assert(url5.includes(`b2b-app/${admin1.tenantId}/categories/`), 'Reads module from query string too');

    console.log(`\n${pass + fail > 0 && fail === 0 ? c.green : c.red}━━━ ${pass} passed, ${fail} failed ━━━${c.reset}\n`);
    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
