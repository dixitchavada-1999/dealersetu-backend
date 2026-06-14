const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
    {
        mobileNumber: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        otp: {
            type: String,
            required: true,
        },
        attempts: {
            type: Number,
            default: 0,
        },
        verified: {
            type: Boolean,
            default: false,
        },
        expiresAt: {
            type: Date,
            required: true,
            // TTL index: MongoDB auto-deletes expired docs
            index: { expires: 0 },
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Otp', otpSchema);
