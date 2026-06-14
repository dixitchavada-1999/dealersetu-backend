const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const ProductVariant = require('../models/productVariantModel');
const Customer = require('../models/customerModel');
const Category = require('../models/categoryModel');
const Tenant = require('../models/tenantModel');
const { isCustomerRole } = require('../config/roleValues');

// @desc    Get dashboard stats
// @route   GET /api/dashboard
// @access  Private
const getDashboardStats = async (req, res, next) => {
    try {
        const tenantId = req.user.tenantId;

        // Customer-specific dashboard
        if (isCustomerRole(req.user.role) && req.user.linkedCustomerId) {
            return getCustomerDashboard(req, res, next);
        }

        // Basic counts
        const categoryCount = await Category.countDocuments({ tenantId, isActive: true });
        const productCount = await Product.countDocuments({ tenantId, isActive: true });
        const variantCount = await ProductVariant.countDocuments({ tenantId, isActive: true });
        const customerCount = await Customer.countDocuments({ tenantId, isActive: true });
        const orderCount = await Order.countDocuments({ tenantId });

        // Calculate total revenue
        const orders = await Order.find({ tenantId });
        const totalRevenue = orders.reduce((acc, order) => acc + order.totalAmount, 0);
        const totalPaid = orders.reduce((acc, order) => acc + order.paidAmount, 0);
        const totalOutstanding = totalRevenue - totalPaid;

        // Order status breakdown
        const ordersByStatus = await Order.aggregate([
            { $match: { tenantId } },
            { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
        ]);

        // Payment status breakdown
        const ordersByPayment = await Order.aggregate([
            { $match: { tenantId } },
            { $group: { _id: '$paymentStatus', count: { $sum: 1 } } },
        ]);

        // Total stock value
        const variants = await ProductVariant.find({ tenantId, isActive: true });
        const totalStockValue = variants.reduce(
            (acc, variant) => acc + variant.finalPrice * variant.stockQty,
            0
        );

        // Low stock variants (dynamic threshold)
        const tenantDoc = await Tenant.findById(tenantId).select('lowStockThreshold');
        const lowStockThreshold = tenantDoc?.lowStockThreshold ?? 10;
        const lowStockCount = await ProductVariant.countDocuments({
            tenantId,
            isActive: true,
            stockQty: { $lte: lowStockThreshold },
        });

        const stats = {
            role: 'ADMIN',
            counts: {
                categories: categoryCount,
                products: productCount,
                variants: variantCount,
                customers: customerCount,
                orders: orderCount,
            },
            revenue: {
                total: Math.round(totalRevenue * 100) / 100,
                paid: Math.round(totalPaid * 100) / 100,
                outstanding: Math.round(totalOutstanding * 100) / 100,
            },
            inventory: {
                totalStockValue: Math.round(totalStockValue * 100) / 100,
                lowStockItems: lowStockCount,
            },
            ordersByStatus: ordersByStatus.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            ordersByPayment: ordersByPayment.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
        };

        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get customer-specific dashboard stats
const getCustomerDashboard = async (req, res, next) => {
    try {
        const tenantId = req.user.tenantId;
        const customerId = req.user.linkedCustomerId;

        // Get customer info
        const customer = await Customer.findById(customerId);

        // Customer's orders only
        const orders = await Order.find({ tenantId, customerId });
        const orderCount = orders.length;
        const totalSpent = orders.reduce((acc, order) => acc + order.totalAmount, 0);
        const totalPaid = orders.reduce((acc, order) => acc + order.paidAmount, 0);
        const outstanding = totalSpent - totalPaid;

        // Order status breakdown
        const ordersByStatus = {};
        const ordersByPayment = {};
        orders.forEach(order => {
            ordersByStatus[order.orderStatus] = (ordersByStatus[order.orderStatus] || 0) + 1;
            ordersByPayment[order.paymentStatus] = (ordersByPayment[order.paymentStatus] || 0) + 1;
        });

        // Recent orders (last 5)
        const recentOrders = orders
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5)
            .map(o => ({
                id: o._id,
                orderNumber: o.orderNumber,
                totalAmount: o.totalAmount,
                paidAmount: o.paidAmount,
                orderStatus: o.orderStatus,
                paymentStatus: o.paymentStatus,
                createdAt: o.createdAt,
            }));

        const stats = {
            role: 'USER',
            customer: customer ? {
                name: customer.name,
                phone: customer.phone,
                email: customer.email,
            } : null,
            counts: {
                orders: orderCount,
            },
            revenue: {
                total: Math.round(totalSpent * 100) / 100,
                paid: Math.round(totalPaid * 100) / 100,
                outstanding: Math.round(outstanding * 100) / 100,
            },
            ordersByStatus,
            ordersByPayment,
            recentOrders,
        };

        res.json({
            success: true,
            data: stats,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { getDashboardStats };
