const mongoose = require('mongoose');
const Feedback = require('../models/feedbackModel');
const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const { notifyTenantAdmins } = require('../services/notificationService');
const { logActivity } = require('../utils/activityLogger');
const { isCustomerRole } = require('../config/roleValues');
const { getUserTenantContext } = require('../utils/tenantResolver');

// @desc    Create feedback (order/product/general)
// @route   POST /api/feedback
// @access  Private
const createFeedback = async (req, res, next) => {
    try {
        const { type, orderId, productId, rating, comment } = req.body;

        if (!type || !rating) {
            res.status(400);
            throw new Error('Please provide type and rating');
        }

        if (rating < 1 || rating > 5) {
            res.status(400);
            throw new Error('Rating must be between 1 and 5');
        }

        // Multi-tenant: customer can leave feedback for any tenant they belong to.
        // Resolve the actual tenant of the order/product instead of assuming req.user.tenantId.
        const { tenantIds } = await getUserTenantContext(req.user);

        const feedbackData = {
            userId: req.user._id,
            type,
            rating,
            comment,
        };

        // Validate order feedback
        if (type === 'order') {
            if (!orderId) {
                res.status(400);
                throw new Error('orderId is required for order feedback');
            }

            const order = await Order.findOne({
                _id: orderId,
                tenantId: { $in: tenantIds },
            });

            if (!order) {
                res.status(404);
                throw new Error('Order not found');
            }

            if (order.orderStatus !== 'Delivered') {
                res.status(400);
                throw new Error('Feedback can only be given for delivered orders');
            }

            // Check duplicate
            const existing = await Feedback.findOne({
                userId: req.user._id,
                orderId,
            });

            if (existing) {
                res.status(400);
                throw new Error('You have already given feedback for this order');
            }

            feedbackData.tenantId = order.tenantId;
            feedbackData.orderId = orderId;
        }

        // Validate product feedback
        if (type === 'product') {
            if (!productId) {
                res.status(400);
                throw new Error('productId is required for product feedback');
            }

            const product = await Product.findOne({
                _id: productId,
                tenantId: { $in: tenantIds },
            });

            if (!product) {
                res.status(404);
                throw new Error('Product not found');
            }

            // Check duplicate
            const existing = await Feedback.findOne({
                userId: req.user._id,
                productId,
            });

            if (existing) {
                res.status(400);
                throw new Error('You have already given feedback for this product');
            }

            feedbackData.tenantId = product.tenantId;
            feedbackData.productId = productId;
        }

        // General feedback — fall back to user's primary tenant
        if (type === 'general') {
            feedbackData.tenantId = req.user.tenantId;
        }

        const feedback = await Feedback.create(feedbackData);

        // Recalculate product average rating
        if (type === 'product' && productId) {
            const stats = await Feedback.aggregate([
                { $match: { productId: new mongoose.Types.ObjectId(productId), type: 'product', isActive: true } },
                { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } }
            ]);
            const avg = stats.length > 0 ? Math.round(stats[0].avgRating * 10) / 10 : 0;
            const count = stats.length > 0 ? stats[0].count : 0;
            await Product.findByIdAndUpdate(productId, { averageRating: avg, ratingCount: count });
        }

        res.status(201).json({
            success: true,
            message: 'Feedback submitted successfully',
            data: feedback,
        });

        logActivity({ req, action: 'create', module: 'feedback', description: `Feedback submitted: ${type} - ${rating} stars`, targetId: feedback._id, targetName: type, metadata: { type, rating } });

        // Fire-and-forget: notify admins of the tenant the feedback belongs to
        notifyTenantAdmins({
            tenantId: feedback.tenantId,
            type: 'feedback_received',
            title: 'New Feedback',
            message: `${req.user.firstName} gave ${rating} star feedback${type === 'order' ? ' on an order' : type === 'product' ? ' on a product' : ''}`,
            data: { feedbackId: feedback._id.toString() },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get logged-in user's feedback
// @route   GET /api/feedback/my
// @access  Private
const getMyFeedback = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Multi-tenant: include feedback from any tenant the customer belongs to
        const { tenantIds } = await getUserTenantContext(req.user);

        const query = {
            tenantId: { $in: tenantIds },
            userId: req.user._id,
            isActive: true,
        };

        if (req.query.type) {
            query.type = req.query.type;
        }

        const [feedback, total] = await Promise.all([
            Feedback.find(query)
                .populate('orderId', 'orderNumber')
                .populate('productId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Feedback.countDocuments(query),
        ]);

        res.json({
            success: true,
            data: {
                feedbacks: feedback,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get all feedback for tenant (Admin only)
// @route   GET /api/feedback/all
// @access  Private/Admin
const getAllFeedback = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const query = {
            tenantId: req.user.tenantId,
            isActive: true,
        };

        if (req.query.type) {
            query.type = req.query.type;
        }

        const [feedback, total] = await Promise.all([
            Feedback.find(query)
                .populate('userId', 'firstName lastName')
                .populate('orderId', 'orderNumber')
                .populate('productId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Feedback.countDocuments(query),
        ]);

        res.json({
            success: true,
            data: {
                feedbacks: feedback,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get feedback for a specific order
// @route   GET /api/feedback/order/:orderId
// @access  Private
const getFeedbackByOrder = async (req, res, next) => {
    try {
        // Multi-tenant: order may live in any of the customer's tenants
        const { tenantIds } = await getUserTenantContext(req.user);

        const feedback = await Feedback.findOne({
            tenantId: { $in: tenantIds },
            orderId: req.params.orderId,
            isActive: true,
        }).populate('userId', 'firstName lastName');

        res.json({
            success: true,
            data: feedback,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get all feedback for a specific product (with average rating)
// @route   GET /api/feedback/product/:productId
// @access  Private
const getFeedbackByProduct = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Multi-tenant: product may live in any of the customer's tenants
        const { tenantIds } = await getUserTenantContext(req.user);

        const query = {
            tenantId: { $in: tenantIds },
            productId: req.params.productId,
            isActive: true,
        };

        const [feedback, total, aggregation] = await Promise.all([
            Feedback.find(query)
                .populate('userId', 'firstName lastName')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Feedback.countDocuments(query),
            Feedback.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: null,
                        averageRating: { $avg: '$rating' },
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);

        const stats = aggregation[0] || { averageRating: 0, count: 0 };

        res.json({
            success: true,
            data: feedback,
            averageRating: Math.round(stats.averageRating * 10) / 10,
            totalReviews: stats.count,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Admin replies to feedback
// @route   PUT /api/feedback/:id/reply
// @access  Private/Admin
const adminReply = async (req, res, next) => {
    try {
        const { reply } = req.body;

        if (!reply) {
            res.status(400);
            throw new Error('Please provide a reply');
        }

        const feedback = await Feedback.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
        });

        if (!feedback) {
            res.status(404);
            throw new Error('Feedback not found');
        }

        feedback.adminReply = reply;
        feedback.adminRepliedAt = new Date();
        await feedback.save();

        logActivity({ req, action: 'reply', module: 'feedback', description: `Admin replied to feedback`, targetId: feedback._id, targetName: feedback.type });

        res.json({
            success: true,
            message: 'Reply added successfully',
            data: feedback,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete feedback (user can delete own, admin can delete any)
// @route   DELETE /api/feedback/:id
// @access  Private
const deleteFeedback = async (req, res, next) => {
    try {
        const feedback = await Feedback.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
        });

        if (!feedback) {
            res.status(404);
            throw new Error('Feedback not found');
        }

        // Customers may only delete their own feedback; staff/owner (who hold the
        // feedback.delete permission this route requires) can delete any.
        if (isCustomerRole(req.user.role) && feedback.userId.toString() !== req.user._id.toString()) {
            res.status(403);
            throw new Error('Not authorized to delete this feedback');
        }

        feedback.isActive = false;
        await feedback.save();

        logActivity({ req, action: 'delete', module: 'feedback', description: `Feedback deleted`, targetId: feedback._id, targetName: feedback.type });

        // Recalculate product average rating after deletion
        if (feedback.type === 'product' && feedback.productId) {
            const stats = await Feedback.aggregate([
                { $match: { productId: new mongoose.Types.ObjectId(feedback.productId), type: 'product', isActive: true } },
                { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } }
            ]);
            const avg = stats.length > 0 ? Math.round(stats[0].avgRating * 10) / 10 : 0;
            const count = stats.length > 0 ? stats[0].count : 0;
            await Product.findByIdAndUpdate(feedback.productId, { averageRating: avg, ratingCount: count });
        }

        res.json({
            success: true,
            message: 'Feedback deleted successfully',
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createFeedback,
    getMyFeedback,
    getAllFeedback,
    getFeedbackByOrder,
    getFeedbackByProduct,
    adminReply,
    deleteFeedback,
};
