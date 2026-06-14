const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const Tenant = require('../models/tenantModel');
const User = require('../models/userModel');
const Category = require('../models/categoryModel');
const Product = require('../models/productModel');
const ProductVariant = require('../models/productVariantModel');
const Customer = require('../models/customerModel');
const Order = require('../models/orderModel');
const OrderItem = require('../models/orderItemModel');
const ActivityLog = require('../models/activityLogModel');
const Session = require('../models/sessionModel');
const ApiLog = require('../models/apiLogModel');

// Helper: verify tenant exists and return it
const findTenantOrFail = async (id, res) => {
    const tenant = await Tenant.findById(id);
    if (!tenant) {
        res.status(404).json({ success: false, message: 'Tenant not found', data: null, errors: [] });
        return null;
    }
    return tenant;
};

// @desc    Get super admin dashboard stats
// @route   GET /api/super-admin/dashboard
const getDashboard = async (req, res) => {
    try {
        const [totalTenants, activeTenants, inactiveTenants, totalUsers] = await Promise.all([
            Tenant.countDocuments(),
            Tenant.countDocuments({ isActive: true }),
            Tenant.countDocuments({ isActive: false }),
            User.countDocuments({ role: { $ne: 'SUPER_ADMIN' } }),
        ]);

        return res.status(200).json({
            success: true,
            message: 'Dashboard stats fetched',
            data: { totalTenants, activeTenants, inactiveTenants, totalUsers },
        });
    } catch (error) {
        console.error('Super admin dashboard error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch dashboard stats', data: null, errors: [] });
    }
};

// @desc    Get all tenants (paginated, searchable)
// @route   GET /api/super-admin/tenants
const getAllTenants = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';

        const query = {};
        if (search) {
            const safeSearch = escapeRegex(search);
            query.$or = [
                { name: { $regex: safeSearch, $options: 'i' } },
                { email: { $regex: safeSearch, $options: 'i' } },
            ];
        }

        const [tenants, total] = await Promise.all([
            Tenant.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            Tenant.countDocuments(query),
        ]);

        const tenantIds = tenants.map(t => t._id);
        const userCounts = await User.aggregate([
            { $match: { tenantId: { $in: tenantIds }, role: { $ne: 'SUPER_ADMIN' } } },
            { $group: { _id: '$tenantId', count: { $sum: 1 } } },
        ]);
        const countMap = {};
        userCounts.forEach(uc => { countMap[uc._id.toString()] = uc.count; });

        const data = tenants.map(t => ({
            id: t._id.toString(),
            name: t.name,
            email: t.email || '',
            phone: t.phone || '',
            businessType: t.businessType || '',
            isActive: t.isActive,
            userCount: countMap[t._id.toString()] || 0,
            createdAt: t.createdAt,
        }));

        return res.status(200).json({ success: true, message: 'Tenants fetched', data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
        console.error('Get all tenants error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch tenants', data: null, errors: [] });
    }
};

// @desc    Get single tenant detail
// @route   GET /api/super-admin/tenants/:id
const getTenantDetail = async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.params.id).lean();
        if (!tenant) {
            return res.status(404).json({ success: false, message: 'Tenant not found', data: null, errors: [] });
        }

        const [userCount, categoryCount, productCount, customerCount, orderCount] = await Promise.all([
            User.countDocuments({ tenantId: tenant._id, role: { $ne: 'SUPER_ADMIN' } }),
            Category.countDocuments({ tenantId: tenant._id }),
            Product.countDocuments({ tenantId: tenant._id }),
            Customer.countDocuments({ tenantId: tenant._id }),
            Order.countDocuments({ tenantId: tenant._id }),
        ]);

        return res.status(200).json({
            success: true,
            message: 'Tenant detail fetched',
            data: {
                id: tenant._id.toString(),
                name: tenant.name,
                email: tenant.email || '',
                phone: tenant.phone || '',
                businessType: tenant.businessType || '',
                address: tenant.address || '',
                logo: tenant.logo || '',
                isActive: tenant.isActive,
                userCount,
                categoryCount,
                productCount,
                customerCount,
                orderCount,
                createdAt: tenant.createdAt,
                updatedAt: tenant.updatedAt,
            },
        });
    } catch (error) {
        console.error('Get tenant detail error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch tenant detail', data: null, errors: [] });
    }
};

// @desc    Toggle tenant active/inactive
// @route   PATCH /api/super-admin/tenants/:id/toggle-active
const toggleTenantActive = async (req, res) => {
    try {
        const tenant = await findTenantOrFail(req.params.id, res);
        if (!tenant) return;

        tenant.isActive = !tenant.isActive;
        await tenant.save();

        return res.status(200).json({
            success: true,
            message: `Tenant ${tenant.isActive ? 'activated' : 'deactivated'} successfully`,
            data: { id: tenant._id.toString(), name: tenant.name, isActive: tenant.isActive },
        });
    } catch (error) {
        console.error('Toggle tenant active error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to toggle tenant status', data: null, errors: [] });
    }
};

// @desc    Get users for a specific tenant
// @route   GET /api/super-admin/tenants/:id/users
const getTenantUsers = async (req, res) => {
    try {
        const tenant = await findTenantOrFail(req.params.id, res);
        if (!tenant) return;

        const users = await User.find({ tenantId: tenant._id, role: { $ne: 'SUPER_ADMIN' } })
            .select('-password -refreshToken')
            .sort({ createdAt: -1 })
            .lean();

        const data = users.map(u => ({
            id: u._id.toString(),
            firstName: u.firstName || u.name?.split(' ')[0] || '',
            lastName: u.lastName || u.name?.split(' ').slice(1).join(' ') || '',
            email: u.email || '',
            role: u.role,
            isActive: u.isActive,
            createdAt: u.createdAt,
        }));

        return res.status(200).json({ success: true, message: 'Tenant users fetched', data });
    } catch (error) {
        console.error('Get tenant users error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch tenant users', data: null, errors: [] });
    }
};

// @desc    Get categories for a specific tenant
// @route   GET /api/super-admin/tenants/:id/categories
const getTenantCategories = async (req, res) => {
    try {
        const tenant = await findTenantOrFail(req.params.id, res);
        if (!tenant) return;

        const categories = await Category.find({ tenantId: tenant._id }).sort({ createdAt: -1 }).lean();

        const data = categories.map(c => ({
            id: c._id.toString(),
            name: c.name,
            description: c.description || '',
            imageUrl: c.imageUrl || '',
            isActive: c.isActive,
            createdAt: c.createdAt,
        }));

        return res.status(200).json({ success: true, message: 'Tenant categories fetched', data });
    } catch (error) {
        console.error('Get tenant categories error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch categories', data: null, errors: [] });
    }
};

// @desc    Get products for a specific tenant (with variant count)
// @route   GET /api/super-admin/tenants/:id/products
const getTenantProducts = async (req, res) => {
    try {
        const tenant = await findTenantOrFail(req.params.id, res);
        if (!tenant) return;

        const products = await Product.find({ tenantId: tenant._id })
            .populate('categoryId', 'name')
            .sort({ createdAt: -1 })
            .lean();

        // Get variant counts per product
        const productIds = products.map(p => p._id);
        const variantCounts = await ProductVariant.aggregate([
            { $match: { productId: { $in: productIds } } },
            { $group: { _id: '$productId', count: { $sum: 1 }, totalStock: { $sum: '$stockQty' } } },
        ]);
        const variantMap = {};
        variantCounts.forEach(v => { variantMap[v._id.toString()] = { count: v.count, totalStock: v.totalStock }; });

        const data = products.map(p => ({
            id: p._id.toString(),
            name: p.name,
            productCode: p.productCode || '',
            brand: p.brand || '',
            categoryName: p.categoryId?.name || '',
            unit: p.unit || 'Piece',
            imageUrl: p.imageUrls?.[0] || p.imageUrl || '',
            isActive: p.isActive,
            variantCount: variantMap[p._id.toString()]?.count || 0,
            totalStock: variantMap[p._id.toString()]?.totalStock || 0,
            createdAt: p.createdAt,
        }));

        return res.status(200).json({ success: true, message: 'Tenant products fetched', data });
    } catch (error) {
        console.error('Get tenant products error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch products', data: null, errors: [] });
    }
};

// @desc    Get customers for a specific tenant
// @route   GET /api/super-admin/tenants/:id/customers
const getTenantCustomers = async (req, res) => {
    try {
        const tenant = await findTenantOrFail(req.params.id, res);
        if (!tenant) return;

        const customers = await Customer.find({ tenantId: tenant._id }).sort({ createdAt: -1 }).lean();

        const data = customers.map(c => ({
            id: c._id.toString(),
            name: c.name,
            mobile: c.mobile || '',
            email: c.email || '',
            shopName: c.shopName || '',
            gstNumber: c.gstNumber || '',
            address: c.address || {},
            outstandingAmount: c.outstandingAmount || 0,
            isActive: c.isActive,
            createdAt: c.createdAt,
        }));

        return res.status(200).json({ success: true, message: 'Tenant customers fetched', data });
    } catch (error) {
        console.error('Get tenant customers error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch customers', data: null, errors: [] });
    }
};

// @desc    Get orders for a specific tenant
// @route   GET /api/super-admin/tenants/:id/orders
const getTenantOrders = async (req, res) => {
    try {
        const tenant = await findTenantOrFail(req.params.id, res);
        if (!tenant) return;

        const orders = await Order.find({ tenantId: tenant._id })
            .populate('customerId', 'name mobile')
            .sort({ createdAt: -1 })
            .lean();

        const data = orders.map(o => ({
            id: o._id.toString(),
            orderNumber: o.orderNumber,
            customerName: o.customerId?.name || 'Unknown',
            customerMobile: o.customerId?.mobile || '',
            orderDate: o.orderDate,
            totalAmount: o.totalAmount,
            paidAmount: o.paidAmount,
            paymentStatus: o.paymentStatus,
            orderStatus: o.orderStatus,
            createdAt: o.createdAt,
        }));

        return res.status(200).json({ success: true, message: 'Tenant orders fetched', data });
    } catch (error) {
        console.error('Get tenant orders error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch orders', data: null, errors: [] });
    }
};

// @desc    Get order detail for a specific tenant
// @route   GET /api/super-admin/tenants/:id/orders/:orderId
const getTenantOrderDetail = async (req, res) => {
    try {
        const tenant = await findTenantOrFail(req.params.id, res);
        if (!tenant) return;

        const order = await Order.findOne({ _id: req.params.orderId, tenantId: tenant._id })
            .populate('customerId', 'name mobile email shopName gstNumber address')
            .lean();

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found', data: null, errors: [] });
        }

        const items = await OrderItem.find({ orderId: order._id })
            .populate({
                path: 'variantId',
                select: 'sku price finalPrice unit',
                populate: { path: 'productId', select: 'name productCode brand' },
            })
            .lean();

        const orderData = {
            id: order._id.toString(),
            orderNumber: order.orderNumber,
            customer: order.customerId ? {
                id: order.customerId._id.toString(),
                name: order.customerId.name,
                mobile: order.customerId.mobile || '',
                email: order.customerId.email || '',
                shopName: order.customerId.shopName || '',
            } : null,
            orderDate: order.orderDate,
            totalAmount: order.totalAmount,
            paidAmount: order.paidAmount,
            paymentStatus: order.paymentStatus,
            orderStatus: order.orderStatus,
            notes: order.notes || '',
            deliveryNotes: order.deliveryNotes || '',
            approvedAt: order.approvedAt,
            dispatchedAt: order.dispatchedAt,
            deliveredAt: order.deliveredAt,
            createdAt: order.createdAt,
        };

        const itemsData = items.map(item => {
            const variant = item.variantId || {};
            const product = variant.productId || {};
            return {
                id: item._id.toString(),
                productName: product.name || '',
                productCode: product.productCode || '',
                brand: product.brand || '',
                sku: variant.sku || '',
                quantity: item.quantity,
                unit: item.unit || 'Piece',
                pricePerUnit: item.pricePerUnit,
                totalPrice: item.totalPrice,
            };
        });

        return res.status(200).json({ success: true, message: 'Order detail fetched', data: { order: orderData, items: itemsData } });
    } catch (error) {
        console.error('Get tenant order detail error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch order detail', data: null, errors: [] });
    }
};

// @desc    Get single product detail with variants for a specific tenant
// @route   GET /api/super-admin/tenants/:id/products/:productId
const getTenantProductDetail = async (req, res) => {
    try {
        const tenant = await findTenantOrFail(req.params.id, res);
        if (!tenant) return;

        const product = await Product.findOne({ _id: req.params.productId, tenantId: tenant._id })
            .populate('categoryId', 'name variantAttributes')
            .lean();

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found', data: null, errors: [] });
        }

        const variants = await ProductVariant.find({ productId: product._id })
            .sort({ createdAt: -1 })
            .lean();

        const productData = {
            id: product._id.toString(),
            name: product.name,
            productCode: product.productCode || '',
            description: product.description || '',
            brand: product.brand || '',
            costPrice: product.costPrice || 0,
            categoryName: product.categoryId?.name || '',
            unit: product.unit || 'Piece',
            imageUrls: product.imageUrls?.length ? product.imageUrls : product.imageUrl ? [product.imageUrl] : [],
            isActive: product.isActive,
            variantAttributes: product.variantAttributes || product.categoryId?.variantAttributes || [],
            createdAt: product.createdAt,
        };

        const variantsData = variants.map(v => ({
            id: v._id.toString(),
            sku: v.sku,
            price: v.price,
            costPrice: v.costPrice || 0,
            taxPercentage: v.taxPercentage || 0,
            finalPrice: v.finalPrice,
            stockQty: v.stockQty,
            unit: v.unit || 'Piece',
            weight: v.weight || 0,
            dimensions: v.dimensions || '',
            attributes: v.attributes || {},
            isActive: v.isActive,
        }));

        return res.status(200).json({
            success: true,
            message: 'Product detail fetched',
            data: { product: productData, variants: variantsData },
        });
    } catch (error) {
        console.error('Get tenant product detail error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to fetch product detail', data: null, errors: [] });
    }
};

// @desc    Get activity logs (paginated, filterable)
// @route   GET /api/super-admin/activity-logs
const getActivityLogs = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const query = {};

        if (req.query.tenantId) query.tenantId = req.query.tenantId;
        if (req.query.userId) query.userId = req.query.userId;
        if (req.query.module) query.module = req.query.module;
        if (req.query.action) query.action = req.query.action;
        if (req.query.userRole) query.userRole = req.query.userRole;
        if (req.query.search) {
            const safeSearch = escapeRegex(req.query.search);
            query.$or = [
                { description: { $regex: safeSearch, $options: 'i' } },
                { userName: { $regex: safeSearch, $options: 'i' } },
                { targetName: { $regex: safeSearch, $options: 'i' } },
            ];
        }
        if (req.query.startDate || req.query.endDate) {
            query.createdAt = {};
            if (req.query.startDate) query.createdAt.$gte = new Date(req.query.startDate);
            if (req.query.endDate) query.createdAt.$lte = new Date(req.query.endDate);
        }

        const [logs, total] = await Promise.all([
            ActivityLog.find(query)
                .populate('tenantId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            ActivityLog.countDocuments(query),
        ]);

        res.json({
            success: true,
            data: {
                logs,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            },
        });
    } catch (error) {
        next(error);
    }
};

const getSessions = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const query = {};
        if (req.query.tenantId) query.tenantId = req.query.tenantId;
        if (req.query.userId) query.userId = req.query.userId;
        if (req.query.isActive === 'true') query.isActive = true;
        if (req.query.isActive === 'false') query.isActive = false;

        const [sessions, total] = await Promise.all([
            Session.find(query).populate('userId', 'firstName lastName email role').populate('tenantId', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
            Session.countDocuments(query),
        ]);
        res.json({ success: true, data: { sessions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
    } catch (error) { next(error); }
};

const getApiLogs = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const query = {};
        if (req.query.tenantId) query.tenantId = req.query.tenantId;
        if (req.query.userId) query.userId = req.query.userId;
        if (req.query.method) query.method = req.query.method;
        if (req.query.statusCode) query.statusCode = parseInt(req.query.statusCode);
        if (req.query.search) query.path = { $regex: escapeRegex(req.query.search), $options: 'i' };

        const [logs, total] = await Promise.all([
            ApiLog.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
            ApiLog.countDocuments(query),
        ]);
        res.json({ success: true, data: { logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
    } catch (error) { next(error); }
};

module.exports = {
    getDashboard,
    getAllTenants,
    getTenantDetail,
    toggleTenantActive,
    getTenantUsers,
    getTenantCategories,
    getTenantProducts,
    getTenantProductDetail,
    getTenantCustomers,
    getTenantOrders,
    getTenantOrderDetail,
    getActivityLogs,
    getSessions,
    getApiLogs,
};
