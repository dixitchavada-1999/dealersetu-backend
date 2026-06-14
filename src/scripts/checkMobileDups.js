require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    // Group by tenantId + mobileNumber, count duplicates
    const dups = await User.aggregate([
        { $match: { tenantId: { $exists: true }, mobileNumber: { $exists: true } } },
        { $group: { _id: { tenantId: '$tenantId', mobile: '$mobileNumber' }, count: { $sum: 1 }, ids: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
    ]);
    console.log(`Duplicate (tenantId, mobileNumber) groups: ${dups.length}`);
    dups.slice(0, 10).forEach(d => console.log(`  tenant=${d._id.tenantId} mobile="${d._id.mobile}" count=${d.count}`));
    await mongoose.disconnect();
})();
