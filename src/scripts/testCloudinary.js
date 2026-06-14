/**
 * Smoke test: upload one image to /api/upload/image and verify the returned
 * URL is a Cloudinary URL (https://res.cloudinary.com/...) instead of /uploads/.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/userModel');

const API = 'http://localhost:3000';
const MASTER = process.env.MASTER_PASSWORD || '666666';

(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    // Find any ADMIN user to login as
    const admin = await User.findOne({ role: 'ADMIN' }).lean();
    if (!admin) {
        console.error('No ADMIN user found in DB');
        process.exit(1);
    }

    // Login with master password
    const loginBody = { password: MASTER, deviceId: 'cloudinary-test' };
    if (admin.email) loginBody.email = admin.email;
    else if (admin.userName) loginBody.userName = admin.userName;

    const loginRes = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginBody),
    });
    const loginData = await loginRes.json();
    if (!loginData.success) {
        console.error('Login failed:', loginData);
        process.exit(1);
    }
    const token = loginData.data.tokens.accessToken;
    console.log(`✓ Logged in as: ${admin.email || admin.userName}`);

    // Find an existing local image to use as test payload
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const files = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)) : [];
    if (files.length === 0) {
        console.error('No test image found in', uploadsDir);
        process.exit(1);
    }
    const testFile = path.join(uploadsDir, files[0]);
    console.log(`✓ Using test file: ${files[0]} (${(fs.statSync(testFile).size / 1024).toFixed(1)} KB)`);

    // Upload via FormData
    const buffer = fs.readFileSync(testFile);
    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    formData.append('image', blob, files[0]);

    const uploadRes = await fetch(`${API}/api/upload/image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
    });
    const uploadData = await uploadRes.json();

    console.log(`\n=== Upload Response ===`);
    console.log(`Status: ${uploadRes.status}`);
    console.log(`Body:   ${JSON.stringify(uploadData, null, 2)}`);

    if (!uploadData?.data?.imageUrl) {
        console.error('\n✗ Upload failed — no imageUrl in response');
        process.exit(1);
    }

    const url = uploadData.data.imageUrl;
    const isCloudinary = url.startsWith('https://res.cloudinary.com/') || url.includes('cloudinary.com');
    const isLocal = url.startsWith('/uploads/');

    console.log(`\n=== Verdict ===`);
    if (isCloudinary) {
        console.log(`✅ SUCCESS — image is on Cloudinary`);
        console.log(`   URL: ${url}`);
    } else if (isLocal) {
        console.log(`⚠️  Image still going to LOCAL storage`);
        console.log(`   URL: ${url}`);
        console.log(`   → Cloudinary credentials may not be loaded. Restart backend.`);
    } else {
        console.log(`?  Unexpected URL format`);
        console.log(`   URL: ${url}`);
    }

    // Verify public access
    console.log(`\n=== Verifying public fetch ===`);
    const fullUrl = isCloudinary ? url : `${API}${url}`;
    const fetchRes = await fetch(fullUrl);
    console.log(`HTTP ${fetchRes.status} on ${fullUrl}`);
    if (fetchRes.ok) console.log(`✓ Image publicly accessible`);
    else console.log(`✗ Image not accessible (status ${fetchRes.status})`);

    await mongoose.disconnect();
    process.exit(0);
})().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
