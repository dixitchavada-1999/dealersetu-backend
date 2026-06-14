const mongoose = require('mongoose');
const Order = require('../models/orderModel');
const OrderItem = require('../models/orderItemModel');
const ProductVariant = require('../models/productVariantModel');
const Product = require('../models/productModel');
const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');
const { NOTIFICATION_TYPES } = require('../constants/notificationTypes');
const { createNotification, notifyTenantAdmins, notifyTenantDispatch, findUserByCustomerId } = require('../services/notificationService');
const { logActivity } = require('../utils/activityLogger');
const { getUserTenantContext } = require('../utils/tenantResolver');

// Detect whether the connected MongoDB supports transactions.
// Standalone MongoDB (no replica set) doesn't — MongoDB Atlas, replica sets,
// and sharded clusters do. We infer from the connection string so we never
// attempt a transaction the server can't honour.
const SUPPORTS_TRANSACTIONS = (() => {
    const uri = process.env.MONGO_URI || '';
    return uri.startsWith('mongodb+srv://') || /[?&]replicaSet=/.test(uri);
})();

const { CUSTOMER_ROLE_VALUES, isCustomerRole, isOwnerRole } = require('../config/roleValues');

// @desc    Get all orders (Tenant scoped)
// @route   GET /api/orders
// @access  Private (Admin/User)
const getOrders = async (req, res, next) => {
    try {
        // Customers see ONLY their own orders (scoped by their linked customer
        // records across accessible tenants). Staff/owner fall through below.
        if (isCustomerRole(req.user.role)) {
            const { tenantIds, tenantMap } = await getUserTenantContext(req.user);

            // Find all user accounts with same mobileNumber to get all linkedCustomerIds
            const userAccounts = await User.find({
                mobileNumber: req.user.mobileNumber,
                role: { $in: CUSTOMER_ROLE_VALUES },
                isActive: true,
            }).select('tenantId linkedCustomerId');

            // Always include the requester's own linked customer as a fallback.
            if (req.user.linkedCustomerId && !userAccounts.some(u => u.linkedCustomerId && u.linkedCustomerId.toString() === req.user.linkedCustomerId.toString())) {
                userAccounts.push({ tenantId: req.user.tenantId, linkedCustomerId: req.user.linkedCustomerId });
            }

            const customerIds = userAccounts
                .filter(u => u.linkedCustomerId)
                .map(u => u.linkedCustomerId);

            if (customerIds.length === 0) {
                return res.json({ success: true, count: 0, data: [] });
            }

            const orders = await Order.find({
                tenantId: { $in: tenantIds },
                customerId: { $in: customerIds },
            })
                .populate('customerId', 'name mobile shopName')
                .sort({ createdAt: -1 });

            // Attach tenantName to each order
            const ordersWithTenant = orders.map(o => {
                const obj = o.toObject();
                const tid = o.tenantId.toString();
                obj.tenantName = tenantMap[tid]?.name || '';
                return obj;
            });

            return res.json({
                success: true,
                count: ordersWithTenant.length,
                data: ordersWithTenant,
            });
        }

        // Staff / owner: single tenant
        const query = { tenantId: req.user.tenantId };
        const perms = req.user.permissions || [];

        // Dispatch-only staff (can dispatch but not fully manage orders) only need
        // to see actionable orders. Full managers/owners see everything.
        if (perms.includes('orders.dispatch') && !perms.includes('orders.update')) {
            query.orderStatus = { $in: ['Approved', 'Dispatched', 'Delivered'] };
        }

        if (req.query.customerId && (perms.includes('orders.update') || isOwnerRole(req.user.role))) {
            query.customerId = req.query.customerId;
        }

        const orders = await Order.find(query)
            .populate('customerId', 'name mobile shopName')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: orders.length,
            data: orders,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get single order by ID with items
// @route   GET /api/orders/:id
// @access  Private (Admin/User)
const getOrderById = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id)
            .populate('customerId', 'name mobile email shopName gstNumber address');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Check tenant ownership (multi-tenant for customers)
        const { tenantIds } = await getUserTenantContext(req.user);
        if (!tenantIds.map(id => id.toString()).includes(order.tenantId.toString())) {
            return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
        }

        // Customers may only view their OWN orders (not every order in the tenant).
        if (isCustomerRole(req.user.role)) {
            if (!req.user.linkedCustomerId || order.customerId._id.toString() !== req.user.linkedCustomerId.toString()) {
                return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
            }
        }

        // Get order items
        const orderItems = await OrderItem.find({ orderId: order._id })
            .populate({
                path: 'variantId',
                select: 'sku price finalPrice unit',
                populate: {
                    path: 'productId',
                    select: 'name productCode brand',
                },
            });

        res.json({
            success: true,
            data: {
                order,
                items: orderItems,
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Create new order with items (using transaction)
// @route   POST /api/orders
// @access  Private/Admin
const createOrder = async (req, res, next) => {
    try {
        const { customerId, items, paidAmount, notes } = req.body;

        // Fetch tenant common discount
        const tenantDoc = await Tenant.findById(req.user.tenantId).select('commonDiscount');
        const commonDiscount = tenantDoc?.commonDiscount ?? 0;

        // Validate input
        if (!customerId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide customer and order items' });
        }

        // Verify customer exists and belongs to tenant
        const customer = await Customer.findOne({
            _id: customerId,
            tenantId: req.user.tenantId,
        });

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        const customerDiscount = customer.discount ?? 0;

        // Generate unique order number
        const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        let totalAmount = 0;
        const orderItemsData = [];

        // Start MongoDB transaction (skipped on standalone MongoDB)
        let order;
        const session = SUPPORTS_TRANSACTIONS ? await mongoose.startSession() : null;
        if (session) session.startTransaction();
        try {
            // Validate variants and calculate total
            for (const item of items) {
                const { variantId, productId: itemProductId, quantity } = item;

                if (!quantity || quantity <= 0) {
                    if (session) { await session.abortTransaction(); session.endSession(); }
                    return res.status(400).json({ success: false, message: 'Invalid item data' });
                }

                if (variantId) {
                    // Existing variant logic
                    const variant = await ProductVariant.findOne({
                        _id: variantId,
                        tenantId: req.user.tenantId,
                        isActive: true,
                    }).populate('productId', 'name productCode brand discount');

                    if (!variant) {
                        if (session) { await session.abortTransaction(); session.endSession(); }
                        return res.status(404).json({ success: false, message: `Variant ${variantId} not found` });
                    }

                    if (variant.stockQty < quantity) {
                        if (session) { await session.abortTransaction(); session.endSession(); }
                        return res.status(400).json({ success: false, message: `Insufficient stock for variant ${variant.sku}` });
                    }

                    const productDiscount = variant.productId?.discount || 0;
                    const effectiveDiscount = productDiscount > 0 ? productDiscount : commonDiscount;
                    const totalDiscount = Math.min(100, effectiveDiscount + customerDiscount);
                    const discountedPrice = totalDiscount > 0
                        ? Math.round(variant.finalPrice * (1 - totalDiscount / 100) * 100) / 100
                        : variant.finalPrice;

                    variant.stockQty -= quantity;
                    await variant.save(session ? { session } : undefined);

                    const itemTotal = discountedPrice * quantity;
                    totalAmount += itemTotal;

                    orderItemsData.push({
                        tenantId: req.user.tenantId,
                        variantId: variant._id,
                        productName: variant.productId?.name || '',
                        productCode: variant.productId?.productCode || '',
                        variantSku: variant.sku,
                        brand: variant.productId?.brand || '',
                        originalPrice: variant.finalPrice,
                        discount: totalDiscount,
                        customerDiscount: customerDiscount,
                        taxPercentage: variant.taxPercentage || 0,
                        quantity,
                        unit: variant.unit || 'Piece',
                        pricePerUnit: discountedPrice,
                        totalPrice: itemTotal,
                    });
                } else if (itemProductId) {
                    // Product without variants
                    const product = await Product.findOne({
                        _id: itemProductId,
                        tenantId: req.user.tenantId,
                        isActive: true,
                        hasVariants: false,
                    });
                    if (!product) {
                        if (session) { await session.abortTransaction(); session.endSession(); }
                        return res.status(404).json({ success: false, message: `Product ${itemProductId} not found` });
                    }
                    if (product.stockQty < quantity) {
                        if (session) { await session.abortTransaction(); session.endSession(); }
                        return res.status(400).json({ success: false, message: `Insufficient stock for ${product.name}` });
                    }

                    const productDiscount = product.discount || 0;
                    const effectiveDiscount = productDiscount > 0 ? productDiscount : commonDiscount;
                    const totalDiscount = Math.min(100, effectiveDiscount + customerDiscount);
                    const discountedPrice = totalDiscount > 0
                        ? Math.round(product.finalPrice * (1 - totalDiscount / 100) * 100) / 100
                        : product.finalPrice;

                    product.stockQty -= quantity;
                    await product.save(session ? { session } : undefined);

                    const itemTotal = discountedPrice * quantity;
                    totalAmount += itemTotal;

                    orderItemsData.push({
                        tenantId: req.user.tenantId,
                        productId: product._id,
                        productName: product.name,
                        productCode: product.productCode || '',
                        variantSku: product.sku || product.productCode || '',
                        brand: product.brand || '',
                        originalPrice: product.finalPrice,
                        discount: totalDiscount,
                        customerDiscount: customerDiscount,
                        taxPercentage: product.taxPercentage || 0,
                        quantity,
                        unit: product.unit || 'Piece',
                        pricePerUnit: discountedPrice,
                        totalPrice: itemTotal,
                    });
                } else {
                    if (session) { await session.abortTransaction(); session.endSession(); }
                    return res.status(400).json({ success: false, message: 'Each item must have a variantId or productId' });
                }
            }

            // Create order
            [order] = await Order.create([{
                tenantId: req.user.tenantId,
                orderNumber,
                customerId,
                orderDate: new Date(),
                totalAmount,
                paidAmount: paidAmount || 0,
                paymentStatus:
                    paidAmount >= totalAmount
                        ? 'Paid'
                        : paidAmount > 0
                        ? 'Partial'
                        : 'Pending',
                orderStatus: 'Placed',
                notes,
            }], session ? { session } : {});

            // Create order items
            const orderItemsWithOrderId = orderItemsData.map((item) => ({
                ...item,
                orderId: order._id,
            }));

            await OrderItem.insertMany(orderItemsWithOrderId, session ? { session } : {});

            // Update customer outstanding amount
            const outstandingAmount = totalAmount - (paidAmount || 0);
            customer.outstandingAmount += outstandingAmount;
            await customer.save(session ? { session } : undefined);

            if (session) await session.commitTransaction();
        } catch (error) {
            if (session) await session.abortTransaction();
            throw error;
        } finally {
            if (session) session.endSession();
        }

        // Fetch complete order with items
        const createdOrder = await Order.findById(order._id).populate(
            'customerId',
            'name mobile shopName'
        );

        const createdItems = await OrderItem.find({ orderId: order._id }).populate({
            path: 'variantId',
            select: 'sku price finalPrice unit',
            populate: {
                path: 'productId',
                select: 'name productCode brand',
            },
        });

        res.status(201).json({
            success: true,
            data: {
                order: createdOrder,
                items: createdItems,
            },
        });

        logActivity({ req, action: 'create', module: 'order', description: `Order created: ${orderNumber}`, targetId: order._id, targetName: orderNumber, metadata: { totalAmount, customerId } });

        // Fire-and-forget: notify customer-user if linked
        const customerUser = await findUserByCustomerId(req.user.tenantId, customerId);
        if (customerUser) {
            createNotification({
                tenantId: req.user.tenantId,
                recipientId: customerUser._id,
                type: NOTIFICATION_TYPES.ORDER_PLACED,
                title: 'New Order Created',
                message: `Order ${orderNumber} has been created for ₹${totalAmount.toFixed(2)}`,
                data: { orderId: order._id, orderNumber, amount: totalAmount, customerId },
            });
        }

        // Check low stock after deductions
        const tenantSettings = await Tenant.findById(req.user.tenantId).select('lowStockThreshold');
        const threshold = tenantSettings?.lowStockThreshold ?? 10;
        for (const item of items) {
            if (item.variantId) {
                const variant = await ProductVariant.findOne({ _id: item.variantId, tenantId: req.user.tenantId }).select('stockQty sku');
                if (variant && variant.stockQty <= threshold) {
                    notifyTenantAdmins({
                        tenantId: req.user.tenantId,
                        type: NOTIFICATION_TYPES.LOW_STOCK,
                        title: 'Low Stock Alert',
                        message: `Variant ${variant.sku} has only ${variant.stockQty} units left`,
                        data: { productVariantId: variant._id, productId: variant.productId },
                    });
                }
            } else if (item.productId) {
                const product = await Product.findById(item.productId).select('stockQty name sku');
                if (product && product.stockQty <= threshold) {
                    notifyTenantAdmins({
                        tenantId: req.user.tenantId,
                        type: NOTIFICATION_TYPES.LOW_STOCK,
                        title: 'Low Stock Alert',
                        message: `Product ${product.name} has only ${product.stockQty} units left`,
                        data: { productId: product._id },
                    });
                }
            }
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Update order
// @route   PUT /api/orders/:id
// @access  Private/Admin
const updateOrder = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Check tenant ownership
        if (order.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
        }

        // Validate paidAmount
        const { paidAmount } = req.body;
        if (paidAmount !== undefined && (paidAmount < 0)) {
            return res.status(400).json({ success: false, message: 'Paid amount cannot be negative' });
        }

        // Capture previous values for notification logic and activity logging
        const previousStatus = order.orderStatus;
        const previousPaymentStatus = order.paymentStatus;
        const previousPaidAmount = order.paidAmount;

        // Update fields
        if (req.body.orderStatus) {
            const newStatus = req.body.orderStatus;

            // Track status change timestamps and actors
            if (newStatus === 'Approved' && order.orderStatus !== 'Approved') {
                order.approvedBy = req.user._id;
                order.approvedAt = new Date();
            }
            if (newStatus === 'Dispatched' && order.orderStatus !== 'Dispatched') {
                order.dispatchedBy = req.user._id;
                order.dispatchedAt = new Date();
            }
            if (newStatus === 'Delivered' && order.orderStatus !== 'Delivered') {
                order.deliveredAt = new Date();
            }

            order.orderStatus = newStatus;
        }

        order.paymentStatus = req.body.paymentStatus || order.paymentStatus;
        order.paidAmount = req.body.paidAmount !== undefined ? req.body.paidAmount : order.paidAmount;
        order.notes = req.body.notes !== undefined ? req.body.notes : order.notes;
        if (req.body.deliveryNotes !== undefined) {
            order.deliveryNotes = req.body.deliveryNotes;
        }
        if (req.body.courierCharge !== undefined) {
            order.courierCharge = req.body.courierCharge;
        }
        if (req.body.additionalDiscount !== undefined) {
            order.additionalDiscount = req.body.additionalDiscount;
        }
        if (req.body.additionalCharge !== undefined) {
            order.additionalCharge = req.body.additionalCharge;
        }
        if (req.body.additionalChargeNote !== undefined) {
            order.additionalChargeNote = req.body.additionalChargeNote;
        }

        // Recalculate totalAmount if any charge fields were updated
        if (
            req.body.courierCharge !== undefined ||
            req.body.additionalDiscount !== undefined ||
            req.body.additionalCharge !== undefined
        ) {
            const subtotal = order.subtotal || order.totalAmount;
            order.subtotal = subtotal;
            order.totalAmount =
                subtotal +
                (order.courierCharge || 0) +
                (order.additionalCharge || 0) -
                (order.additionalDiscount || 0);
        }

        const updatedOrder = await order.save();

        res.json({
            success: true,
            data: updatedOrder,
        });

        logActivity({ req, action: 'update', module: 'order', description: `Order ${updatedOrder.orderNumber} updated${req.body.orderStatus ? ` - status: ${req.body.orderStatus}` : ''}`, targetId: updatedOrder._id, targetName: updatedOrder.orderNumber, metadata: { previousStatus, newStatus: updatedOrder.orderStatus, oldValue: { orderStatus: previousStatus, paymentStatus: previousPaymentStatus, paidAmount: previousPaidAmount }, newValue: { orderStatus: updatedOrder.orderStatus, paymentStatus: updatedOrder.paymentStatus, paidAmount: updatedOrder.paidAmount } } });

        // Fire-and-forget notifications based on status change
        const newStatus = updatedOrder.orderStatus;
        const customerUser = await findUserByCustomerId(req.user.tenantId, updatedOrder.customerId);

        if (newStatus === 'Approved' && previousStatus !== 'Approved') {
            if (customerUser) {
                createNotification({
                    tenantId: req.user.tenantId,
                    recipientId: customerUser._id,
                    type: NOTIFICATION_TYPES.ORDER_APPROVED,
                    title: 'Order Approved',
                    message: `Your order ${updatedOrder.orderNumber} has been approved`,
                    data: { orderId: updatedOrder._id, orderNumber: updatedOrder.orderNumber },
                });
            }
            notifyTenantDispatch({
                tenantId: req.user.tenantId,
                type: NOTIFICATION_TYPES.ORDER_APPROVED,
                title: 'Order Ready for Dispatch',
                message: `Order ${updatedOrder.orderNumber} has been approved and is ready for dispatch`,
                data: { orderId: updatedOrder._id, orderNumber: updatedOrder.orderNumber },
            });
        }

        if (newStatus === 'Dispatched' && previousStatus !== 'Dispatched') {
            if (customerUser) {
                createNotification({
                    tenantId: req.user.tenantId,
                    recipientId: customerUser._id,
                    type: NOTIFICATION_TYPES.ORDER_DISPATCHED,
                    title: 'Order Dispatched',
                    message: `Your order ${updatedOrder.orderNumber} has been dispatched`,
                    data: { orderId: updatedOrder._id, orderNumber: updatedOrder.orderNumber },
                });
            }
        }

        if (newStatus === 'Delivered' && previousStatus !== 'Delivered') {
            notifyTenantAdmins({
                tenantId: req.user.tenantId,
                type: NOTIFICATION_TYPES.ORDER_DELIVERED,
                title: 'Order Delivered',
                message: `Order ${updatedOrder.orderNumber} has been delivered`,
                data: { orderId: updatedOrder._id, orderNumber: updatedOrder.orderNumber },
            });
        }

        // Payment notification
        if (req.body.paidAmount !== undefined && req.body.paidAmount > previousPaidAmount) {
            if (customerUser) {
                createNotification({
                    tenantId: req.user.tenantId,
                    recipientId: customerUser._id,
                    type: NOTIFICATION_TYPES.PAYMENT_RECEIVED,
                    title: 'Payment Received',
                    message: `Payment of ₹${req.body.paidAmount.toFixed(2)} received for order ${updatedOrder.orderNumber}`,
                    data: { orderId: updatedOrder._id, orderNumber: updatedOrder.orderNumber, amount: req.body.paidAmount },
                });
            }
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Delete order (soft delete by cancelling)
// @route   DELETE /api/orders/:id
// @access  Private/Admin
const deleteOrder = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Check tenant ownership
        if (order.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this order' });
        }

        // Check if already cancelled
        if (order.orderStatus === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Order is already cancelled' });
        }

        // Get order items to restore stock
        const orderItems = await OrderItem.find({ orderId: order._id });

        // Restore stock for each item
        for (const item of orderItems) {
            if (item.variantId) {
                const variant = await ProductVariant.findById(item.variantId);
                if (variant) {
                    variant.stockQty += item.quantity;
                    await variant.save();
                }
            } else if (item.productId) {
                const product = await Product.findById(item.productId);
                if (product) {
                    product.stockQty += item.quantity;
                    await product.save();
                }
            }
        }

        // Update customer outstanding
        const customer = await Customer.findById(order.customerId);
        if (customer) {
            const outstandingAmount = order.totalAmount - order.paidAmount;
            customer.outstandingAmount -= outstandingAmount;
            await customer.save();
        }

        // Mark order as cancelled
        order.orderStatus = 'Cancelled';
        await order.save();

        res.json({
            success: true,
            message: 'Order cancelled successfully',
        });

        logActivity({ req, action: 'delete', module: 'order', description: `Order cancelled: ${order.orderNumber}`, targetId: order._id, targetName: order.orderNumber });

        // Fire-and-forget: notify customer
        const cancelledCustomerUser = await findUserByCustomerId(req.user.tenantId, order.customerId);
        if (cancelledCustomerUser) {
            createNotification({
                tenantId: req.user.tenantId,
                recipientId: cancelledCustomerUser._id,
                type: NOTIFICATION_TYPES.ORDER_CANCELLED,
                title: 'Order Cancelled',
                message: `Order ${order.orderNumber} has been cancelled`,
                data: { orderId: order._id, orderNumber: order.orderNumber },
            });
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Permanently delete a cancelled order
// @route   DELETE /api/orders/:id/permanent
// @access  Private/Admin
const permanentDeleteOrder = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (order.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        if (order.orderStatus !== 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Only cancelled orders can be permanently deleted' });
        }

        // Delete order items first, then the order
        await OrderItem.deleteMany({ orderId: order._id });
        await Order.findByIdAndDelete(order._id);

        res.json({
            success: true,
            message: 'Order permanently deleted',
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Place order (for USER role, auto-creates customer if needed)
// @route   POST /api/orders/place
// @access  Private (User)
const placeOrder = async (req, res, next) => {
    try {
        const { items, notes } = req.body;

        // Validate input
        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide order items' });
        }

        for (const item of items) {
            if ((!item.variantId && !item.productId) || !item.quantity || item.quantity <= 0) {
                return res.status(400).json({ success: false, message: 'Each item must have a variantId or productId and quantity > 0' });
            }
        }

        // Auto-create customer if needed
        let customerId = req.user.linkedCustomerId;

        if (!customerId) {
            const fullName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.name || 'Customer';
            const newCustomer = await Customer.create({
                tenantId: req.user.tenantId,
                name: fullName,
                mobile: req.user.mobileNumber || 'N/A',
                email: req.user.email,
                shopName: req.user.shopName,
                address: req.user.address,
            });
            customerId = newCustomer._id;

            // Link customer to user
            await User.findByIdAndUpdate(req.user._id, { linkedCustomerId: customerId });
        }

        // Generate unique order number
        const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Fetch tenant common discount
        const placeTenantDoc = await Tenant.findById(req.user.tenantId).select('commonDiscount');
        const placeCommonDiscount = placeTenantDoc?.commonDiscount ?? 0;

        // Fetch customer discount
        const customerDoc = await Customer.findById(customerId).select('discount');
        const placeCustomerDiscount = customerDoc?.discount ?? 0;

        let totalAmount = 0;
        const orderItemsData = [];

        // Start MongoDB transaction (skipped on standalone MongoDB)
        let order;
        const session = SUPPORTS_TRANSACTIONS ? await mongoose.startSession() : null;
        if (session) session.startTransaction();
        try {
            // Validate variants and calculate total
            for (const item of items) {
                const { variantId, productId: itemProductId, quantity } = item;

                if (variantId) {
                    // Existing variant logic
                    const variant = await ProductVariant.findOne({
                        _id: variantId,
                        tenantId: req.user.tenantId,
                        isActive: true,
                    }).populate('productId', 'name productCode brand discount');

                    if (!variant) {
                        if (session) { await session.abortTransaction(); session.endSession(); }
                        return res.status(404).json({ success: false, message: `Variant ${variantId} not found` });
                    }

                    if (variant.stockQty < quantity) {
                        if (session) { await session.abortTransaction(); session.endSession(); }
                        return res.status(400).json({ success: false, message: `Insufficient stock for variant ${variant.sku}` });
                    }

                    const productDiscount = variant.productId?.discount || 0;
                    const effectiveDiscount = productDiscount > 0 ? productDiscount : placeCommonDiscount;
                    const totalDiscount = Math.min(100, effectiveDiscount + placeCustomerDiscount);
                    const discountedPrice = totalDiscount > 0
                        ? Math.round(variant.finalPrice * (1 - totalDiscount / 100) * 100) / 100
                        : variant.finalPrice;

                    variant.stockQty -= quantity;
                    await variant.save(session ? { session } : undefined);

                    const itemTotal = discountedPrice * quantity;
                    totalAmount += itemTotal;

                    orderItemsData.push({
                        tenantId: req.user.tenantId,
                        variantId: variant._id,
                        productName: variant.productId?.name || '',
                        productCode: variant.productId?.productCode || '',
                        variantSku: variant.sku,
                        brand: variant.productId?.brand || '',
                        originalPrice: variant.finalPrice,
                        discount: totalDiscount,
                        customerDiscount: placeCustomerDiscount || 0,
                        taxPercentage: variant.taxPercentage || 0,
                        quantity,
                        unit: variant.unit || 'Piece',
                        pricePerUnit: discountedPrice,
                        totalPrice: itemTotal,
                    });
                } else if (itemProductId) {
                    // Product without variants
                    const product = await Product.findOne({
                        _id: itemProductId,
                        tenantId: req.user.tenantId,
                        isActive: true,
                        hasVariants: false,
                    });
                    if (!product) {
                        if (session) { await session.abortTransaction(); session.endSession(); }
                        return res.status(404).json({ success: false, message: `Product ${itemProductId} not found` });
                    }
                    if (product.stockQty < quantity) {
                        if (session) { await session.abortTransaction(); session.endSession(); }
                        return res.status(400).json({ success: false, message: `Insufficient stock for ${product.name}` });
                    }

                    const productDiscount = product.discount || 0;
                    const effectiveDiscount = productDiscount > 0 ? productDiscount : placeCommonDiscount;
                    const totalDiscount = Math.min(100, effectiveDiscount + placeCustomerDiscount);
                    const discountedPrice = totalDiscount > 0
                        ? Math.round(product.finalPrice * (1 - totalDiscount / 100) * 100) / 100
                        : product.finalPrice;

                    product.stockQty -= quantity;
                    await product.save(session ? { session } : undefined);

                    const itemTotal = discountedPrice * quantity;
                    totalAmount += itemTotal;

                    orderItemsData.push({
                        tenantId: req.user.tenantId,
                        productId: product._id,
                        productName: product.name,
                        productCode: product.productCode || '',
                        variantSku: product.sku || product.productCode || '',
                        brand: product.brand || '',
                        originalPrice: product.finalPrice,
                        discount: totalDiscount,
                        customerDiscount: placeCustomerDiscount || 0,
                        taxPercentage: product.taxPercentage || 0,
                        quantity,
                        unit: product.unit || 'Piece',
                        pricePerUnit: discountedPrice,
                        totalPrice: itemTotal,
                    });
                } else {
                    if (session) { await session.abortTransaction(); session.endSession(); }
                    return res.status(400).json({ success: false, message: 'Each item must have a variantId or productId' });
                }
            }

            // Create order
            [order] = await Order.create([{
                tenantId: req.user.tenantId,
                orderNumber,
                customerId,
                orderDate: new Date(),
                totalAmount,
                paidAmount: 0,
                paymentStatus: 'Pending',
                orderStatus: 'Placed',
                notes,
            }], session ? { session } : {});

            // Create order items
            const orderItemsWithOrderId = orderItemsData.map((item) => ({
                ...item,
                orderId: order._id,
            }));

            await OrderItem.insertMany(orderItemsWithOrderId, session ? { session } : {});

            // Update customer outstanding amount
            const customer = await Customer.findById(customerId);
            customer.outstandingAmount += totalAmount;
            await customer.save(session ? { session } : undefined);

            if (session) await session.commitTransaction();
        } catch (error) {
            if (session) await session.abortTransaction();
            throw error;
        } finally {
            if (session) session.endSession();
        }

        // Fetch complete order
        const createdOrder = await Order.findById(order._id).populate(
            'customerId',
            'name mobile shopName'
        );

        res.status(201).json({
            success: true,
            data: createdOrder,
        });

        logActivity({ req, action: 'place_order', module: 'order', description: `Order placed: ${orderNumber}`, targetId: order._id, targetName: orderNumber, metadata: { totalAmount } });

        // Fire-and-forget notifications
        const customerName = createdOrder.customerId?.name || 'A customer';
        notifyTenantAdmins({
            tenantId: req.user.tenantId,
            type: NOTIFICATION_TYPES.ORDER_PLACED,
            title: 'New Order Placed',
            message: `${customerName} placed order ${orderNumber} for ₹${totalAmount.toFixed(2)}`,
            data: { orderId: order._id, orderNumber, amount: totalAmount },
        });

        // Check low stock after deductions
        const placeOrderTenant = await Tenant.findById(req.user.tenantId).select('lowStockThreshold');
        const placeThreshold = placeOrderTenant?.lowStockThreshold ?? 10;
        for (const item of items) {
            if (item.variantId) {
                const variant = await ProductVariant.findById(item.variantId).select('stockQty sku');
                if (variant && variant.stockQty <= placeThreshold) {
                    notifyTenantAdmins({
                        tenantId: req.user.tenantId,
                        type: NOTIFICATION_TYPES.LOW_STOCK,
                        title: 'Low Stock Alert',
                        message: `Variant ${variant.sku} has only ${variant.stockQty} units left`,
                        data: { productVariantId: variant._id, productId: variant.productId },
                    });
                }
            } else if (item.productId) {
                const product = await Product.findById(item.productId).select('stockQty name sku');
                if (product && product.stockQty <= placeThreshold) {
                    notifyTenantAdmins({
                        tenantId: req.user.tenantId,
                        type: NOTIFICATION_TYPES.LOW_STOCK,
                        title: 'Low Stock Alert',
                        message: `Product ${product.name} has only ${product.stockQty} units left`,
                        data: { productId: product._id },
                    });
                }
            }
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Confirm delivery (for USER role - customer confirms they received the order)
// @route   PUT /api/orders/:id/confirm-delivery
// @access  Private (User)
const confirmDelivery = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Check tenant ownership
        if (order.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
        }

        // For customers, verify the order belongs to them
        if (isCustomerRole(req.user.role)) {
            if (!req.user.linkedCustomerId || order.customerId.toString() !== req.user.linkedCustomerId.toString()) {
                return res.status(403).json({ success: false, message: 'Not authorized to confirm this order' });
            }
        }

        // Only dispatched orders can be confirmed as delivered
        if (order.orderStatus !== 'Dispatched') {
            return res.status(400).json({ success: false, message: 'Only dispatched orders can be confirmed as delivered' });
        }

        order.orderStatus = 'Delivered';
        order.deliveredAt = new Date();
        order.deliveryConfirmedBy = 'customer';

        const updatedOrder = await order.save();

        // Populate customer info
        await updatedOrder.populate('customerId', 'name mobile shopName');

        res.json({
            success: true,
            message: 'Delivery confirmed successfully',
            data: updatedOrder,
        });

        // Fire-and-forget: notify admins about delivery confirmation
        notifyTenantAdmins({
            tenantId: req.user.tenantId,
            type: NOTIFICATION_TYPES.ORDER_DELIVERED,
            title: 'Delivery Confirmed',
            message: `Customer confirmed delivery of order ${updatedOrder.orderNumber}`,
            data: { orderId: updatedOrder._id, orderNumber: updatedOrder.orderNumber },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Edit order (items + charges)
// @route   PUT /api/orders/:id/edit
// @access  Private (Admin can edit most states, User can edit only 'Placed' orders)
const editOrder = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Check tenant ownership
        if (order.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to access this order' });
        }

        // The route already enforces the `orders.update` permission. Here we only
        // apply business rules: customers may edit only their own Placed orders;
        // staff/owner may edit anything except cancelled/delivered orders.
        const isCustomer = isCustomerRole(req.user.role);
        // Staff / owner (anyone who is not a customer) may update charges below.
        const isAdmin = !isCustomer;

        if (isCustomer) {
            // Customer must own the order
            if (!req.user.linkedCustomerId || order.customerId.toString() !== req.user.linkedCustomerId.toString()) {
                return res.status(403).json({ success: false, message: 'Not authorized to edit this order' });
            }
            // Customer can only edit when status is 'Placed'
            if (order.orderStatus !== 'Placed') {
                return res.status(400).json({ success: false, message: 'You can only edit orders with status Placed' });
            }
        } else {
            // Staff / owner
            if (order.orderStatus === 'Cancelled' || order.orderStatus === 'Delivered') {
                return res.status(400).json({ success: false, message: 'Cannot edit cancelled or delivered orders' });
            }
        }

        const { items, courierCharge, additionalDiscount, additionalCharge, additionalChargeNote } = req.body;

        // Process items update if provided
        if (items && items.length > 0) {
            // Get existing order items to restore stock
            const existingItems = await OrderItem.find({ orderId: order._id });
            for (const existingItem of existingItems) {
                const variant = await ProductVariant.findById(existingItem.variantId);
                if (variant) {
                    variant.stockQty += existingItem.quantity;
                    await variant.save();
                }
            }

            // Delete existing order items
            await OrderItem.deleteMany({ orderId: order._id });

            let subtotal = 0;
            const newOrderItemsData = [];

            for (const item of items) {
                const { variantId, quantity } = item;

                if (!variantId || !quantity || quantity <= 0) {
                    return res.status(400).json({ success: false, message: 'Invalid item data' });
                }

                const variant = await ProductVariant.findOne({
                    _id: variantId,
                    tenantId: req.user.tenantId,
                    isActive: true,
                });

                if (!variant) {
                    return res.status(404).json({ success: false, message: `Variant ${variantId} not found` });
                }

                if (variant.stockQty < quantity) {
                    return res.status(400).json({ success: false, message: `Insufficient stock for variant ${variant.sku}` });
                }

                // Deduct stock
                variant.stockQty -= quantity;
                await variant.save();

                const pricePerUnit = variant.finalPrice;
                const totalPrice = pricePerUnit * quantity;
                subtotal += totalPrice;

                newOrderItemsData.push({
                    tenantId: req.user.tenantId,
                    orderId: order._id,
                    variantId: variant._id,
                    quantity,
                    unit: variant.unit || 'Piece',
                    pricePerUnit,
                    totalPrice,
                });
            }

            // Create new order items
            await OrderItem.insertMany(newOrderItemsData);

            order.subtotal = subtotal;
        }

        // Admin can update charges; User cannot
        if (isAdmin) {
            if (courierCharge !== undefined) order.courierCharge = courierCharge;
            if (additionalDiscount !== undefined) order.additionalDiscount = additionalDiscount;
            if (additionalCharge !== undefined) order.additionalCharge = additionalCharge;
            if (additionalChargeNote !== undefined) order.additionalChargeNote = additionalChargeNote;
        }

        // Capture old total before recalculation
        const oldTotalAmount = order.totalAmount;

        // Recalculate totalAmount
        const subtotal = order.subtotal || 0;
        order.totalAmount =
            subtotal +
            (order.courierCharge || 0) +
            (order.additionalCharge || 0) -
            (order.additionalDiscount || 0);

        await order.save();

        // Fetch updated order with populated fields
        const updatedOrder = await Order.findById(order._id)
            .populate('customerId', 'name mobile email shopName gstNumber address');

        const orderItems = await OrderItem.find({ orderId: order._id })
            .populate({
                path: 'variantId',
                select: 'sku price finalPrice unit',
                populate: {
                    path: 'productId',
                    select: 'name productCode brand',
                },
            });

        res.json({
            success: true,
            data: {
                order: updatedOrder,
                items: orderItems,
            },
        });

        logActivity({ req, action: 'edit', module: 'order', description: `Order edited: ${order.orderNumber}`, targetId: order._id, targetName: order.orderNumber, metadata: { oldTotal: oldTotalAmount, newTotal: order.totalAmount, oldValue: { totalAmount: oldTotalAmount }, newValue: { totalAmount: order.totalAmount, subtotal: order.subtotal, courierCharge: order.courierCharge } } });

        // Fire-and-forget: notify customer when admin edits
        if (isAdmin) {
            const customerUser = await findUserByCustomerId(req.user.tenantId, order.customerId);
            if (customerUser) {
                createNotification({
                    tenantId: req.user.tenantId,
                    recipientId: customerUser._id,
                    type: NOTIFICATION_TYPES.ORDER_PLACED,
                    title: 'Order Updated',
                    message: `Your order ${order.orderNumber} has been updated`,
                    data: { orderId: order._id, orderNumber: order.orderNumber },
                });
            }
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Place orders from multiple tenants (customer multi-company cart)
// @route   POST /api/orders/place-multi
// @access  Private (User)
const placeMultiOrder = async (req, res, next) => {
    try {
        const { items, notes } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide order items' });
        }

        // Validate all items have tenantId
        for (const item of items) {
            if (!item.tenantId) {
                return res.status(400).json({ success: false, message: 'Each item must have a tenantId' });
            }
            if ((!item.variantId && !item.productId) || !item.quantity || item.quantity <= 0) {
                return res.status(400).json({ success: false, message: 'Each item must have a variantId or productId and quantity > 0' });
            }
        }

        // Get user's tenant context
        const { tenantIds, tenantMap } = await getUserTenantContext(req.user);
        const tenantIdStrs = tenantIds.map(id => id.toString());

        // Validate all item tenantIds are accessible
        const itemTenantIds = [...new Set(items.map(i => i.tenantId))];
        for (const tid of itemTenantIds) {
            if (!tenantIdStrs.includes(tid)) {
                return res.status(403).json({ success: false, message: `Not authorized to order from tenant ${tid}` });
            }
        }

        // Group items by tenantId
        const grouped = {};
        items.forEach(item => {
            if (!grouped[item.tenantId]) grouped[item.tenantId] = [];
            grouped[item.tenantId].push(item);
        });

        // Find user accounts per tenant (for linkedCustomerId)
        const userAccounts = await User.find({
            mobileNumber: req.user.mobileNumber,
            role: { $in: CUSTOMER_ROLE_VALUES },
            isActive: true,
        }).select('tenantId linkedCustomerId');

        const userByTenant = {};
        userAccounts.forEach(u => {
            userByTenant[u.tenantId.toString()] = u;
        });

        const createdOrders = [];

        // Process each tenant's order separately
        for (const [tenantId, tenantItems] of Object.entries(grouped)) {
            const tenantInfo = tenantMap[tenantId] || {};
            const commonDiscount = tenantInfo.commonDiscount ?? 0;
            const customerDiscount = tenantInfo.customerDiscount ?? 0;

            // Get or auto-create customer for this tenant
            let customerId = userByTenant[tenantId]?.linkedCustomerId;

            if (!customerId) {
                const fullName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.name || 'Customer';
                const newCustomer = await Customer.create({
                    tenantId,
                    name: fullName,
                    mobile: req.user.mobileNumber || 'N/A',
                    email: req.user.email,
                    shopName: req.user.shopName,
                    address: req.user.address,
                });
                customerId = newCustomer._id;

                // Link customer to user account in this tenant
                const userAccount = userByTenant[tenantId];
                if (userAccount) {
                    await User.findByIdAndUpdate(userAccount._id, { linkedCustomerId: customerId });
                }
            }

            const orderNumber = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            let totalAmount = 0;
            const orderItemsData = [];

            // Transaction per tenant — only when the server supports it.
            // On standalone MongoDB we run the writes without a session;
            // not atomic, but functional for dev / single-node setups.
            const session = SUPPORTS_TRANSACTIONS ? await mongoose.startSession() : null;
            if (session) session.startTransaction();
            try {
                for (const item of tenantItems) {
                    const { variantId, productId: itemProductId, quantity } = item;

                    if (variantId) {
                        const variant = await ProductVariant.findOne({
                            _id: variantId, tenantId, isActive: true,
                        }).populate('productId', 'name productCode brand discount');

                        if (!variant) {
                            if (session) { await session.abortTransaction(); session.endSession(); }
                            return res.status(404).json({ success: false, message: `Variant ${variantId} not found in ${tenantInfo.name}` });
                        }
                        if (variant.stockQty < quantity) {
                            if (session) { await session.abortTransaction(); session.endSession(); }
                            return res.status(400).json({ success: false, message: `Insufficient stock for ${variant.sku} in ${tenantInfo.name}` });
                        }

                        const productDiscount = variant.productId?.discount || 0;
                        const effectiveDiscount = productDiscount > 0 ? productDiscount : commonDiscount;
                        const totalDisc = Math.min(100, effectiveDiscount + customerDiscount);
                        const discountedPrice = totalDisc > 0
                            ? Math.round(variant.finalPrice * (1 - totalDisc / 100) * 100) / 100
                            : variant.finalPrice;

                        variant.stockQty -= quantity;
                        await variant.save(session ? { session } : undefined);

                        const itemTotal = discountedPrice * quantity;
                        totalAmount += itemTotal;

                        orderItemsData.push({
                            tenantId, variantId: variant._id,
                            productName: variant.productId?.name || '', productCode: variant.productId?.productCode || '',
                            variantSku: variant.sku, brand: variant.productId?.brand || '',
                            originalPrice: variant.finalPrice, discount: totalDisc, customerDiscount: customerDiscount || 0,
                            taxPercentage: variant.taxPercentage || 0, quantity, unit: variant.unit || 'Piece',
                            pricePerUnit: discountedPrice, totalPrice: itemTotal,
                        });
                    } else if (itemProductId) {
                        const product = await Product.findOne({
                            _id: itemProductId, tenantId, isActive: true, hasVariants: false,
                        });
                        if (!product) {
                            if (session) { await session.abortTransaction(); session.endSession(); }
                            return res.status(404).json({ success: false, message: `Product ${itemProductId} not found in ${tenantInfo.name}` });
                        }
                        if (product.stockQty < quantity) {
                            if (session) { await session.abortTransaction(); session.endSession(); }
                            return res.status(400).json({ success: false, message: `Insufficient stock for ${product.name} in ${tenantInfo.name}` });
                        }

                        const productDiscount = product.discount || 0;
                        const effectiveDiscount = productDiscount > 0 ? productDiscount : commonDiscount;
                        const totalDisc = Math.min(100, effectiveDiscount + customerDiscount);
                        const discountedPrice = totalDisc > 0
                            ? Math.round(product.finalPrice * (1 - totalDisc / 100) * 100) / 100
                            : product.finalPrice;

                        product.stockQty -= quantity;
                        await product.save(session ? { session } : undefined);

                        const itemTotal = discountedPrice * quantity;
                        totalAmount += itemTotal;

                        orderItemsData.push({
                            tenantId, productId: product._id,
                            productName: product.name, productCode: product.productCode || '',
                            variantSku: product.sku || product.productCode || '', brand: product.brand || '',
                            originalPrice: product.finalPrice, discount: totalDisc, customerDiscount: customerDiscount || 0,
                            taxPercentage: product.taxPercentage || 0, quantity, unit: product.unit || 'Piece',
                            pricePerUnit: discountedPrice, totalPrice: itemTotal,
                        });
                    }
                }

                const orderCreateOpts = session ? { session } : {};
                const [order] = await Order.create([{
                    tenantId, orderNumber, customerId,
                    orderDate: new Date(), totalAmount,
                    paidAmount: 0, paymentStatus: 'Pending', orderStatus: 'Placed', notes,
                }], orderCreateOpts);

                await OrderItem.insertMany(
                    orderItemsData.map(item => ({ ...item, orderId: order._id })),
                    orderCreateOpts
                );

                const customer = await Customer.findById(customerId);
                if (customer) {
                    customer.outstandingAmount += totalAmount;
                    await customer.save(session ? { session } : undefined);
                }

                if (session) await session.commitTransaction();

                const createdOrder = await Order.findById(order._id).populate('customerId', 'name mobile shopName');
                const orderObj = createdOrder.toObject();
                orderObj.tenantName = tenantInfo.name || '';
                createdOrders.push(orderObj);

                // Fire-and-forget notifications
                notifyTenantAdmins({
                    tenantId,
                    type: NOTIFICATION_TYPES.ORDER_PLACED,
                    title: 'New Order Placed',
                    message: `${customer?.name || 'Customer'} placed order ${orderNumber} for ₹${totalAmount.toFixed(2)}`,
                    data: { orderId: order._id, orderNumber, amount: totalAmount },
                });
            } catch (err) {
                if (session) await session.abortTransaction();
                throw err;
            } finally {
                if (session) session.endSession();
            }
        }

        res.status(201).json({
            success: true,
            message: `${createdOrders.length} order(s) placed successfully`,
            data: { orders: createdOrders },
        });

        logActivity({ req, action: 'place_order', module: 'order', description: `Multi-tenant order: ${createdOrders.length} orders placed`, targetId: createdOrders[0]?._id });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getOrders,
    getOrderById,
    createOrder,
    updateOrder,
    deleteOrder,
    permanentDeleteOrder,
    placeOrder,
    placeMultiOrder,
    confirmDelivery,
    editOrder,
};
