/**
 * MongoDB Migration Script: Jewelry B2B → Generic B2B Product Management
 *
 * Run this script ONCE to update your existing MongoDB data.
 *
 * Usage:
 *   node migrate-to-generic.js
 *
 * What it does:
 *   1. Products: renames designCode → productCode, removes metalType
 *   2. ProductVariants: sets price = finalPrice, adds defaults, removes jewelry fields
 *   3. OrderItems: removes grossWeight/netWeight, adds unit = "Piece"
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/api-shop';

async function migrate() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected successfully.\n');

        const db = mongoose.connection.db;

        // ── 1. Products ──
        console.log('=== Migrating Products ===');

        // Rename designCode → productCode
        const renameResult = await db.collection('products').updateMany(
            { designCode: { $exists: true } },
            { $rename: { designCode: 'productCode' } }
        );
        console.log(`  Renamed designCode → productCode: ${renameResult.modifiedCount} docs`);

        // Remove metalType field
        const removeMetalResult = await db.collection('products').updateMany(
            { metalType: { $exists: true } },
            { $unset: { metalType: '' } }
        );
        console.log(`  Removed metalType: ${removeMetalResult.modifiedCount} docs`);

        // Add default unit where missing
        const addUnitResult = await db.collection('products').updateMany(
            { unit: { $exists: false } },
            { $set: { unit: 'Piece' } }
        );
        console.log(`  Added default unit: ${addUnitResult.modifiedCount} docs`);

        // ── 2. Product Variants ──
        console.log('\n=== Migrating Product Variants ===');

        // Set price = finalPrice (use aggregation pipeline update for referencing own fields)
        const setPriceResult = await db.collection('productvariants').updateMany(
            { price: { $exists: false }, finalPrice: { $exists: true } },
            [{ $set: { price: '$finalPrice' } }]
        );
        console.log(`  Set price = finalPrice: ${setPriceResult.modifiedCount} docs`);

        // Add default taxPercentage and unit
        const addDefaultsResult = await db.collection('productvariants').updateMany(
            { taxPercentage: { $exists: false } },
            { $set: { taxPercentage: 0, unit: 'Piece' } }
        );
        console.log(`  Added taxPercentage + unit defaults: ${addDefaultsResult.modifiedCount} docs`);

        // Remove all jewelry-specific fields
        const removeJewelryResult = await db.collection('productvariants').updateMany(
            {},
            {
                $unset: {
                    purity: '',
                    grossWeight: '',
                    netWeight: '',
                    stoneWeight: '',
                    metalRate: '',
                    makingChargeType: '',
                    makingChargeValue: '',
                    wastagePercentage: '',
                    stonePrice: '',
                    gstPercentage: '',
                }
            }
        );
        console.log(`  Removed jewelry fields: ${removeJewelryResult.modifiedCount} docs`);

        // ── 3. Order Items ──
        console.log('\n=== Migrating Order Items ===');

        // Remove grossWeight and netWeight
        const removeWeightsResult = await db.collection('orderitems').updateMany(
            {},
            { $unset: { grossWeight: '', netWeight: '' } }
        );
        console.log(`  Removed weight fields: ${removeWeightsResult.modifiedCount} docs`);

        // Add unit = "Piece" where missing
        const addOrderUnitResult = await db.collection('orderitems').updateMany(
            { unit: { $exists: false } },
            { $set: { unit: 'Piece' } }
        );
        console.log(`  Added default unit: ${addOrderUnitResult.modifiedCount} docs`);

        console.log('\n✅ Migration completed successfully!');
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
    }
}

migrate();
