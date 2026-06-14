/**
 * Migrate local /uploads/ images to Cloudinary and update DB references.
 *
 * For each Product/Banner/Category/Tenant/Variant document holding a
 * "/uploads/<file>" URL:
 *   1. Read the local file
 *   2. Upload to Cloudinary (folder: b2b-app/migrated)
 *   3. Update the DB field to the new Cloudinary URL
 *
 * Re-runs are safe — already-Cloudinary URLs are skipped, and the local
 * file is not deleted (so we keep a fallback if anything goes wrong).
 *
 * Run: node src/scripts/migrateImagesToCloudinary.js
 *      node src/scripts/migrateImagesToCloudinary.js --dry-run
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const cloudinary = require('cloudinary').v2;

const Product = require('../models/productModel');
const Banner = require('../models/bannerModel');
const Category = require('../models/categoryModel');
const Tenant = require('../models/tenantModel');
const ProductVariant = require('../models/productVariantModel');

const DRY_RUN = process.argv.includes('--dry-run');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const c = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m' };

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error(`${c.red}✗ Cloudinary credentials missing in .env${c.reset}`);
    process.exit(1);
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// In-process cache: same local file referenced by multiple docs only uploads once
const uploadCache = new Map();

const isLocal = (url) => typeof url === 'string' && url.startsWith('/uploads/');

const localPathFromUrl = (url) => {
    const filename = url.replace(/^\/uploads\//, '');
    return path.join(UPLOADS_DIR, filename);
};

const stats = {
    skipped: 0, missing: 0, uploaded: 0, dbUpdated: 0, errors: 0,
};

const uploadOne = async (localUrl) => {
    if (uploadCache.has(localUrl)) return uploadCache.get(localUrl);

    const filePath = localPathFromUrl(localUrl);
    if (!fs.existsSync(filePath)) {
        console.log(`  ${c.yellow}∅ missing file:${c.reset} ${localUrl}`);
        stats.missing++;
        uploadCache.set(localUrl, null);
        return null;
    }

    if (DRY_RUN) {
        console.log(`  ${c.dim}[dry-run] would upload:${c.reset} ${localUrl}`);
        const fakeUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/migrated/${path.basename(filePath)}`;
        uploadCache.set(localUrl, fakeUrl);
        return fakeUrl;
    }

    try {
        const res = await cloudinary.uploader.upload(filePath, {
            folder: 'b2b-app/migrated',
            transformation: [{ width: 1000, crop: 'limit' }],
        });
        const newUrl = res.secure_url;
        uploadCache.set(localUrl, newUrl);
        stats.uploaded++;
        console.log(`  ${c.green}✓${c.reset} ${path.basename(filePath)} → ${newUrl.substring(0, 80)}…`);
        return newUrl;
    } catch (err) {
        console.error(`  ${c.red}✗ upload failed:${c.reset} ${localUrl} — ${err.message}`);
        stats.errors++;
        uploadCache.set(localUrl, null);
        return null;
    }
};

const migrateField = async (doc, field, label) => {
    const url = doc.get(field);
    if (!url) return false;
    if (!isLocal(url)) { stats.skipped++; return false; }

    const newUrl = await uploadOne(url);
    if (!newUrl) return false;

    if (!DRY_RUN) {
        doc.set(field, newUrl);
    }
    return true;
};

const migrateArrayField = async (doc, field) => {
    const arr = doc.get(field);
    if (!Array.isArray(arr) || arr.length === 0) return false;
    let changed = false;
    const newArr = [];
    for (const url of arr) {
        if (!isLocal(url)) {
            newArr.push(url);
            stats.skipped++;
            continue;
        }
        const newUrl = await uploadOne(url);
        newArr.push(newUrl || url); // keep old if upload failed
        if (newUrl) changed = true;
    }
    if (changed && !DRY_RUN) doc.set(field, newArr);
    return changed;
};

(async () => {
    console.log(`\n${c.cyan}━━━ Image Migration → Cloudinary ━━━${c.reset}`);
    console.log(`${c.dim}Mode: ${DRY_RUN ? 'DRY-RUN (no uploads, no DB writes)' : 'LIVE'}${c.reset}\n`);

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`${c.dim}Connected to MongoDB${c.reset}\n`);

    // ── Products ──────────────────────────────────────────
    console.log(`${c.cyan}[1/5] Products${c.reset}`);
    const products = await Product.find({
        $or: [
            { imageUrl: { $regex: '^/uploads/' } },
            { imageUrls: { $elemMatch: { $regex: '^/uploads/' } } },
        ],
    });
    console.log(`  Found ${products.length} products with local images`);
    for (const p of products) {
        let touched = false;
        if (await migrateField(p, 'imageUrl', 'product')) touched = true;
        if (await migrateArrayField(p, 'imageUrls')) touched = true;
        if (touched && !DRY_RUN) {
            await p.save();
            stats.dbUpdated++;
        }
    }

    // ── Banners ───────────────────────────────────────────
    console.log(`\n${c.cyan}[2/5] Banners${c.reset}`);
    const banners = await Banner.find({ imageUrl: { $regex: '^/uploads/' } });
    console.log(`  Found ${banners.length} banners with local images`);
    for (const b of banners) {
        if (await migrateField(b, 'imageUrl', 'banner')) {
            if (!DRY_RUN) {
                await b.save();
                stats.dbUpdated++;
            }
        }
    }

    // ── Categories ────────────────────────────────────────
    console.log(`\n${c.cyan}[3/5] Categories${c.reset}`);
    const categories = await Category.find({ imageUrl: { $regex: '^/uploads/' } });
    console.log(`  Found ${categories.length} categories with local images`);
    for (const cat of categories) {
        if (await migrateField(cat, 'imageUrl', 'category')) {
            if (!DRY_RUN) {
                await cat.save();
                stats.dbUpdated++;
            }
        }
    }

    // ── Tenant logos ──────────────────────────────────────
    console.log(`\n${c.cyan}[4/5] Tenant logos${c.reset}`);
    const tenants = await Tenant.find({ logo: { $regex: '^/uploads/' } });
    console.log(`  Found ${tenants.length} tenants with local logos`);
    for (const t of tenants) {
        if (await migrateField(t, 'logo', 'tenant')) {
            if (!DRY_RUN) {
                await t.save();
                stats.dbUpdated++;
            }
        }
    }

    // ── Variants ──────────────────────────────────────────
    console.log(`\n${c.cyan}[5/5] Product variants${c.reset}`);
    const variants = await ProductVariant.find({ images: { $elemMatch: { $regex: '^/uploads/' } } });
    console.log(`  Found ${variants.length} variants with local images`);
    for (const v of variants) {
        if (await migrateArrayField(v, 'images')) {
            if (!DRY_RUN) {
                await v.save();
                stats.dbUpdated++;
            }
        }
    }

    // ── Summary ───────────────────────────────────────────
    console.log(`\n${c.cyan}━━━ Summary ━━━${c.reset}`);
    console.log(`  Uploaded to Cloudinary: ${c.green}${stats.uploaded}${c.reset}`);
    console.log(`  Already-Cloudinary (skipped): ${stats.skipped}`);
    console.log(`  Local file missing: ${stats.missing}`);
    console.log(`  DB documents updated: ${c.green}${stats.dbUpdated}${c.reset}`);
    console.log(`  Errors: ${stats.errors > 0 ? c.red : ''}${stats.errors}${c.reset}`);

    if (DRY_RUN) {
        console.log(`\n${c.yellow}⚠ Dry-run mode — no changes made. Re-run without --dry-run to apply.${c.reset}`);
    } else {
        console.log(`\n${c.green}✓ Migration complete.${c.reset}`);
        console.log(`${c.dim}Local files in api-shop/src/uploads/ are kept as a fallback. Delete manually after verifying production.${c.reset}`);
    }

    await mongoose.disconnect();
    process.exit(stats.errors > 0 ? 1 : 0);
})().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
