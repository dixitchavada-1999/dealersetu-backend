const mongoose = require('mongoose');

const validateId = (paramName = 'id') => (req, res, next) => {
    const id = req.params[paramName];
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: `Invalid ${paramName} format` });
    }
    next();
};

module.exports = { validateId };
