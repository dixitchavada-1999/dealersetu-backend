/**
 * Seed Super Admin user
 * Usage: node src/scripts/seedSuperAdmin.js
 *
 * Set environment variables or create .env in api-shop root:
 *   MONGO_URI=mongodb+srv://...
 *   SUPER_ADMIN_EMAIL=admin@platform.com
 *   SUPER_ADMIN_PASSWORD=yourpassword
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'superadmin@platform.com';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!';

async function seed() {
    try {
        if (!process.env.MONGO_URI) {
            console.error('MONGO_URI not set. Create a .env file or set the env variable.');
            process.exit(1);
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const existing = await User.findOne({ email: SUPER_ADMIN_EMAIL });
        if (existing) {
            console.log(`Super Admin already exists: ${SUPER_ADMIN_EMAIL}`);
            process.exit(0);
        }

        const user = await User.create({
            firstName: 'Super',
            lastName: 'Admin',
            name: 'Super Admin',
            email: SUPER_ADMIN_EMAIL,
            userName: 'superadmin',
            password: SUPER_ADMIN_PASSWORD,
            role: 'SUPER_ADMIN',
            isActive: true,
        });

        console.log('Super Admin created successfully!');
        console.log(`  Email: ${SUPER_ADMIN_EMAIL}`);
        console.log(`  ID: ${user._id}`);
        process.exit(0);
    } catch (error) {
        console.error('Seed failed:', error.message);
        process.exit(1);
    }
}

seed();
