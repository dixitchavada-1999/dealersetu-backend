const Product = require('../models/productModel');
const Category = require('../models/categoryModel');
const Feedback = require('../models/feedbackModel');
const Tenant = require('../models/tenantModel');
const Order = require('../models/orderModel');
const OrderItem = require('../models/orderItemModel');
const ProductVariant = require('../models/productVariantModel');
const User = require('../models/userModel');
const { notifyTenantAdmins } = require('../services/notificationService');
const { logActivity } = require('../utils/activityLogger');
const { getUserTenantContext } = require('../utils/tenantResolver');

// Build a productId -> { averageRating, reviewCount } map from the Feedback model.
const buildRatingMap = async (productIds) => {
    const ratings = await Feedback.aggregate([
        { $match: { productId: { $in: productIds }, type: 'product', isActive: true } },
        { $group: {
            _id: '$productId',
            averageRating: { $avg: '$rating' },
            reviewCount: { $sum: 1 },
        }},
    ]);
    const ratingMap = {};
    ratings.forEach(r => {
        ratingMap[r._id.toString()] = {
            averageRating: Math.round(r.averageRating * 10) / 10,
            reviewCount: r.reviewCount,
        };
    });
    return ratingMap;
};

// Enrich a list of product docs with rating, per-tenant discount and tenant info.
// Shared by getProducts and getMyPurchasedProducts so the customer-facing shape
// stays identical across catalog and "My Products" views.
const enrichProducts = (products, tenantMap, ratingMap) => products.map(p => {
    const obj = p.toObject();
    const tid = p.tenantId.toString();
    const tenantInfo = tenantMap[tid] || {};
    const commonDiscount = tenantInfo.commonDiscount ?? 0;

    const rating = ratingMap[p._id.toString()];
    obj.averageRating = rating?.averageRating || 0;
    obj.reviewCount = rating?.reviewCount || 0;

    obj.effectiveDiscount = obj.discount > 0 ? obj.discount : commonDiscount;
    if (!obj.hasVariants && obj.finalPrice) {
        obj.discountedPrice = obj.effectiveDiscount > 0
            ? Math.round(obj.finalPrice * (1 - obj.effectiveDiscount / 100) * 100) / 100
            : obj.finalPrice;
    }

    obj.tenantId = tid;
    obj.tenantName = tenantInfo.name || '';
    obj.tenantLogo = tenantInfo.logo || '';

    return obj;
});

// @desc    Get all products (Tenant scoped)
// @route   GET /api/products
// @access  Private (Admin/User)
const getProducts = async (req, res, next) => {
    try {
        // Multi-tenant: USER role sees products from all accessible tenants
        const { tenantIds, tenantMap } = await getUserTenantContext(req.user);

        const products = await Product.find({
            tenantId: { $in: tenantIds },
            isActive: true,
        }).populate('categoryId', 'name description');

        const ratingMap = await buildRatingMap(products.map(p => p._id));
        const productsWithRatings = enrichProducts(products, tenantMap, ratingMap);

        res.json({
            success: true,
            count: productsWithRatings.length,
            data: productsWithRatings,
        });
    } catch (error) {
        next(error);
    }
};

// Build the logged-in customer's purchase history, folded per product AND per
// variant. Returns { tenantIds, tenantMap, purchaseMap } where:
//   purchaseMap[productId] = {
//     lastPurchasedAt, totalQuantity, orderIds:Set,
//     variants: { [variantId]: { lastPurchasedAt, totalQuantity, orderIds:Set } },
//   }
// Shared by the "My Products" list and the per-product purchased-variants lookup.
const buildCustomerPurchaseMap = async (user) => {
    const { tenantIds, tenantMap } = await getUserTenantContext(user);

    // Resolve every Customer record tied to this person. The role enum is
    // mid-migration (legacy 'USER' → new 'CUSTOMER'), so match either, and
    // always include the requester's own linked customer as a fallback.
    const customerIdSet = new Set();
    if (user.linkedCustomerId) customerIdSet.add(user.linkedCustomerId.toString());
    if (user.mobileNumber) {
        const userAccounts = await User.find({
            mobileNumber: user.mobileNumber,
            role: { $in: ['USER', 'CUSTOMER'] },
            isActive: true,
        }).select('linkedCustomerId');
        userAccounts.forEach(u => { if (u.linkedCustomerId) customerIdSet.add(u.linkedCustomerId.toString()); });
    }
    const customerIds = [...customerIdSet];
    if (customerIds.length === 0) return { tenantIds, tenantMap, purchaseMap: {} };

    const orders = await Order.find({
        tenantId: { $in: tenantIds },
        customerId: { $in: customerIds },
    }).select('_id orderDate createdAt');
    if (orders.length === 0) return { tenantIds, tenantMap, purchaseMap: {} };

    const orderDateMap = {};
    orders.forEach(o => { orderDateMap[o._id.toString()] = o.orderDate || o.createdAt; });
    const orderIds = orders.map(o => o._id);

    // Line items reference a productId directly OR (more commonly) a variant.
    // Resolve any variant-only items to their productId so both shapes fold into
    // the same per-product stats; the variantId is kept for per-variant stats.
    const items = await OrderItem.find({
        orderId: { $in: orderIds },
    }).select('orderId productId variantId quantity');

    const variantIdsToResolve = items
        .filter(it => !it.productId && it.variantId)
        .map(it => it.variantId);
    const variantToProduct = {};
    if (variantIdsToResolve.length > 0) {
        const variants = await ProductVariant.find({ _id: { $in: variantIdsToResolve } }).select('productId');
        variants.forEach(v => { if (v.productId) variantToProduct[v._id.toString()] = v.productId.toString(); });
    }

    const bump = (entry, orderedAt, qty, orderId) => {
        entry.totalQuantity += qty || 0;
        entry.orderIds.add(orderId);
        if (orderedAt && (!entry.lastPurchasedAt || orderedAt > entry.lastPurchasedAt)) {
            entry.lastPurchasedAt = orderedAt;
        }
    };

    const purchaseMap = {};
    items.forEach(it => {
        const pid = it.productId
            ? it.productId.toString()
            : (it.variantId ? variantToProduct[it.variantId.toString()] : null);
        if (!pid) return;
        const orderedAt = orderDateMap[it.orderId.toString()];
        const oid = it.orderId.toString();
        if (!purchaseMap[pid]) {
            purchaseMap[pid] = { lastPurchasedAt: orderedAt, totalQuantity: 0, orderIds: new Set(), variants: {} };
        }
        bump(purchaseMap[pid], orderedAt, it.quantity, oid);
        if (it.variantId) {
            const vid = it.variantId.toString();
            if (!purchaseMap[pid].variants[vid]) {
                purchaseMap[pid].variants[vid] = { lastPurchasedAt: orderedAt, totalQuantity: 0, orderIds: new Set() };
            }
            bump(purchaseMap[pid].variants[vid], orderedAt, it.quantity, oid);
        }
    });

    return { tenantIds, tenantMap, purchaseMap };
};

// Shape a purchaseMap entry's variants object into a plain array for the API.
const serializeVariantPurchases = (variants = {}) =>
    Object.entries(variants).map(([variantId, s]) => ({
        variantId,
        totalQuantity: s.totalQuantity,
        orderCount: s.orderIds.size,
        lastPurchasedAt: s.lastPurchasedAt,
    }));

// @desc    Get products the logged-in customer has previously purchased
// @route   GET /api/products/my-purchased
// @access  Private (customer — products.read)
// Derives the list from the customer's own order history. Each product carries a
// `purchaseInfo` block (last ordered, total qty, order count) PLUS the exact
// variants the customer bought (`purchaseInfo.variants`) so the detail view can
// show only those variants for quick re-ordering.
const getMyPurchasedProducts = async (req, res, next) => {
    try {
        const { tenantIds, tenantMap, purchaseMap } = await buildCustomerPurchaseMap(req.user);

        const purchasedProductIds = Object.keys(purchaseMap);
        if (purchasedProductIds.length === 0) {
            return res.json({ success: true, count: 0, data: [] });
        }

        // Only surface products that still exist, are active, and live in an
        // accessible tenant.
        const products = await Product.find({
            _id: { $in: purchasedProductIds },
            tenantId: { $in: tenantIds },
            isActive: true,
        }).populate('categoryId', 'name description');

        const ratingMap = await buildRatingMap(products.map(p => p._id));
        const enriched = enrichProducts(products, tenantMap, ratingMap).map(obj => {
            const info = purchaseMap[obj._id.toString()];
            obj.purchaseInfo = {
                lastPurchasedAt: info.lastPurchasedAt,
                totalQuantity: info.totalQuantity,
                orderCount: info.orderIds.size,
                variants: serializeVariantPurchases(info.variants),
            };
            return obj;
        });

        // Most recently purchased first.
        enriched.sort((a, b) => {
            const da = a.purchaseInfo.lastPurchasedAt ? new Date(a.purchaseInfo.lastPurchasedAt).getTime() : 0;
            const db = b.purchaseInfo.lastPurchasedAt ? new Date(b.purchaseInfo.lastPurchasedAt).getTime() : 0;
            return db - da;
        });

        res.json({
            success: true,
            count: enriched.length,
            data: enriched,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get the variants of one product the customer has previously purchased
// @route   GET /api/products/:id/my-purchased-variants
// @access  Private (customer — products.read)
// Powers the "My Products" detail view: returns only the variants this customer
// actually ordered for the given product, with per-variant qty / last-ordered.
const getMyPurchasedVariants = async (req, res, next) => {
    try {
        const { purchaseMap } = await buildCustomerPurchaseMap(req.user);
        const entry = purchaseMap[req.params.id];
        if (!entry) {
            return res.json({ success: true, data: { productId: req.params.id, totalQuantity: 0, orderCount: 0, lastPurchasedAt: null, variants: [] } });
        }
        res.json({
            success: true,
            data: {
                productId: req.params.id,
                totalQuantity: entry.totalQuantity,
                orderCount: entry.orderIds.size,
                lastPurchasedAt: entry.lastPurchasedAt,
                variants: serializeVariantPurchases(entry.variants),
            },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get single product by ID
// @route   GET /api/products/:id
// @access  Private (Admin/User)
const getProductById = async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id).populate('categoryId', 'name description');

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        // Multi-tenant: USER role can access products from any accessible tenant
        const { tenantIds, tenantMap } = await getUserTenantContext(req.user);
        const tid = product.tenantId.toString();

        if (!tenantIds.map(id => id.toString()).includes(tid)) {
            return res.status(403).json({ success: false, message: 'Not authorized to access this product' });
        }

        // Aggregate rating for this product
        const ratingResult = await Feedback.aggregate([
            { $match: { productId: product._id, type: 'product', isActive: true } },
            { $group: {
                _id: '$productId',
                averageRating: { $avg: '$rating' },
                reviewCount: { $sum: 1 },
            }},
        ]);

        const productObj = product.toObject();
        if (ratingResult.length > 0) {
            productObj.averageRating = Math.round(ratingResult[0].averageRating * 10) / 10;
            productObj.reviewCount = ratingResult[0].reviewCount;
        } else {
            productObj.averageRating = 0;
            productObj.reviewCount = 0;
        }

        // Calculate effectiveDiscount (per-tenant)
        const tenantInfo = tenantMap[tid] || {};
        const commonDiscount = tenantInfo.commonDiscount ?? 0;
        productObj.effectiveDiscount = productObj.discount > 0 ? productObj.discount : commonDiscount;
        if (!productObj.hasVariants && productObj.finalPrice) {
            productObj.discountedPrice = productObj.effectiveDiscount > 0
                ? Math.round(productObj.finalPrice * (1 - productObj.effectiveDiscount / 100) * 100) / 100
                : productObj.finalPrice;
        }

        // Tenant info
        productObj.tenantName = tenantInfo.name || '';
        productObj.tenantLogo = tenantInfo.logo || '';

        res.json({
            success: true,
            data: productObj,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Create product
// @route   POST /api/products
// @access  Private/Admin
const createProduct = async (req, res, next) => {
    try {
        // Parse JSON fields if they come as strings (common with multipart/form-data)
        let { name, categoryId, productCode, brand, unit, description, costPrice, imageUrl, imageUrls, variantAttributes, taxPercentage, discount, hasVariants, price, stockQty, sku } = req.body;

        // Parse JSON strings if needed
        if (typeof imageUrls === 'string') {
            try {
                imageUrls = JSON.parse(imageUrls);
            } catch (e) {
                imageUrls = undefined;
            }
        }

        if (typeof variantAttributes === 'string') {
            try {
                variantAttributes = JSON.parse(variantAttributes);
            } catch (e) {
                variantAttributes = undefined;
            }
        }

        // Validate required fields
        if (!name || !categoryId) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        // Verify category exists and belongs to tenant
        const category = await Category.findOne({
            _id: categoryId,
            tenantId: req.user.tenantId,
        });

        if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }

        // Handle uploaded files first (from multer)
        // Check if Cloudinary is being used
        const useCloudinary = process.env.CLOUDINARY_CLOUD_NAME && 
                              process.env.CLOUDINARY_API_KEY && 
                              process.env.CLOUDINARY_API_SECRET;
        
        let uploadedImageUrls = [];
        if (req.files && req.files.length > 0) {
            // Map files to URLs - Cloudinary returns full URL in path/secure_url, local storage uses filename
            uploadedImageUrls = req.files.map(file => {
                if (useCloudinary && (file.path || file.secure_url)) {
                    // Cloudinary: use the full URL
                    return file.path || file.secure_url;
                } else {
                    // Local storage: convert filename to URL path
                    return `/uploads/${file.filename}`;
                }
            });
        } else if (req.file) {
            if (useCloudinary && (req.file.path || req.file.secure_url)) {
                // Cloudinary: use the full URL
                uploadedImageUrls = [req.file.path || req.file.secure_url];
            } else {
                // Local storage: convert filename to URL path
                uploadedImageUrls = [`/uploads/${req.file.filename}`];
            }
        }

        // Handle both uploaded files and URL strings
        // Priority: uploaded files > imageUrls array > single imageUrl
        let finalImageUrls = [];
        if (uploadedImageUrls.length > 0) {
            finalImageUrls = uploadedImageUrls;
        } else if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
            finalImageUrls = imageUrls;
        } else if (imageUrl) {
            finalImageUrls = [imageUrl];
        }

        const product = await Product.create({
            tenantId: req.user.tenantId,
            categoryId,
            name,
            productCode,
            brand,
            unit,
            description,
            costPrice: costPrice !== undefined ? Number(costPrice) : undefined,
            taxPercentage: taxPercentage !== undefined ? Math.min(100, Math.max(0, Number(taxPercentage) || 0)) : 0,
            discount: discount !== undefined ? Math.min(100, Math.max(0, Number(discount) || 0)) : 0,
            variantAttributes: Array.isArray(variantAttributes) ? variantAttributes : [],
            imageUrl: finalImageUrls.length > 0 ? finalImageUrls[0] : undefined, // Keep for backward compatibility
            imageUrls: finalImageUrls,
            hasVariants: hasVariants !== undefined ? hasVariants : true,
            price: price !== undefined ? Number(price) : undefined,
            stockQty: stockQty !== undefined ? Number(stockQty) : 0,
            sku: sku || undefined,
            isActive: true,
        });

        const populatedProduct = await Product.findById(product._id).populate('categoryId', 'name description');

        // Fire-and-forget notification
        notifyTenantAdmins({
            tenantId: req.user.tenantId,
            type: 'new_product',
            title: 'New Product Added',
            message: `${name} has been added to ${category.name}`,
            data: { productId: product._id.toString() },
        });

        logActivity({ req, action: 'create', module: 'product', description: `Product created: ${name}`, targetId: product._id, targetName: name });

        res.status(201).json({
            success: true,
            data: populatedProduct,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private/Admin
const updateProduct = async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        // Check tenant ownership
        if (product.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this product' });
        }

        // If categoryId is being updated, verify it exists and belongs to tenant
        if (req.body.categoryId && req.body.categoryId !== product.categoryId.toString()) {
            const category = await Category.findOne({
                _id: req.body.categoryId,
                tenantId: req.user.tenantId,
            });

            if (!category) {
                return res.status(404).json({ success: false, message: 'Category not found' });
            }
        }

        // Parse JSON fields if they come as strings (common with multipart/form-data)
        let { imageUrl, imageUrls, variantAttributes } = req.body;
        if (typeof imageUrls === 'string') {
            try {
                imageUrls = JSON.parse(imageUrls);
            } catch (e) {
                imageUrls = undefined;
            }
        }

        if (typeof variantAttributes === 'string') {
            try {
                variantAttributes = JSON.parse(variantAttributes);
            } catch (e) {
                variantAttributes = undefined;
            }
        }

        const oldValues = { name: product.name, discount: product.discount, taxPercentage: product.taxPercentage, isActive: product.isActive };
        const oldDiscount = product.discount;

        product.name = req.body.name || product.name;
        product.categoryId = req.body.categoryId || product.categoryId;
        product.productCode = req.body.productCode !== undefined ? req.body.productCode : product.productCode;
        product.description = req.body.description !== undefined ? req.body.description : product.description;
        product.brand = req.body.brand !== undefined ? req.body.brand : product.brand;
        product.costPrice = req.body.costPrice !== undefined ? Number(req.body.costPrice) : product.costPrice;
        product.taxPercentage = req.body.taxPercentage !== undefined ? Math.min(100, Math.max(0, Number(req.body.taxPercentage) || 0)) : product.taxPercentage;
        if (req.body.discount !== undefined) product.discount = Math.min(100, Math.max(0, Number(req.body.discount) || 0));
        product.unit = req.body.unit || product.unit;
        if (req.body.hasVariants !== undefined) product.hasVariants = req.body.hasVariants;
        if (req.body.price !== undefined) product.price = Number(req.body.price);
        if (req.body.stockQty !== undefined) product.stockQty = Number(req.body.stockQty);
        if (req.body.sku !== undefined) product.sku = req.body.sku;

        if (variantAttributes !== undefined && Array.isArray(variantAttributes)) {
            product.variantAttributes = variantAttributes;
        }

        // Handle uploaded files first (from multer)
        // Check if Cloudinary is being used
        const useCloudinary = process.env.CLOUDINARY_CLOUD_NAME && 
                              process.env.CLOUDINARY_API_KEY && 
                              process.env.CLOUDINARY_API_SECRET;
        
        let uploadedImageUrls = [];
        if (req.files && req.files.length > 0) {
            // Map files to URLs - Cloudinary returns full URL in path/secure_url, local storage uses filename
            uploadedImageUrls = req.files.map(file => {
                if (useCloudinary && (file.path || file.secure_url)) {
                    // Cloudinary: use the full URL
                    return file.path || file.secure_url;
                } else {
                    // Local storage: convert filename to URL path
                    return `/uploads/${file.filename}`;
                }
            });
        } else if (req.file) {
            if (useCloudinary && (req.file.path || req.file.secure_url)) {
                // Cloudinary: use the full URL
                uploadedImageUrls = [req.file.path || req.file.secure_url];
            } else {
                // Local storage: convert filename to URL path
                uploadedImageUrls = [`/uploads/${req.file.filename}`];
            }
        }

        // Handle image updates: uploaded files > imageUrls array > single imageUrl
        if (uploadedImageUrls.length > 0) {
            // If files were uploaded, use them
            product.imageUrls = uploadedImageUrls;
            product.imageUrl = uploadedImageUrls[0];
        } else if (imageUrls !== undefined && Array.isArray(imageUrls)) {
            // If imageUrls array is provided, use it
            product.imageUrls = imageUrls;
            product.imageUrl = imageUrls.length > 0 ? imageUrls[0] : undefined;
        } else if (imageUrl !== undefined) {
            // If single imageUrl is provided, convert to array
            product.imageUrl = imageUrl;
            product.imageUrls = imageUrl ? [imageUrl] : [];
        }
        // If none provided, keep existing images
        
        product.isActive = req.body.isActive !== undefined ? req.body.isActive : product.isActive;

        const updatedProduct = await product.save();
        const populatedProduct = await Product.findById(updatedProduct._id).populate('categoryId', 'name description');

        if (req.body.discount !== undefined && req.body.discount !== oldDiscount) {
            notifyTenantAdmins({
                tenantId: req.user.tenantId,
                type: 'discount_updated',
                title: 'Product Discount Updated',
                message: `Discount on ${product.name} has been ${req.body.discount > 0 ? `set to ${req.body.discount}%` : 'removed'}`,
                data: { productId: product._id.toString(), discount: req.body.discount },
            });
        }

        logActivity({ req, action: 'update', module: 'product', description: `Product updated: ${product.name}`, targetId: product._id, targetName: product.name, metadata: { oldValue: oldValues, newValue: { name: product.name, discount: product.discount, taxPercentage: product.taxPercentage, isActive: product.isActive } } });

        res.json({
            success: true,
            data: populatedProduct,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private/Admin
const deleteProduct = async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        // Check tenant ownership
        if (product.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this product' });
        }

        const productName = product.name;
        await product.deleteOne();

        logActivity({ req, action: 'delete', module: 'product', description: `Product deleted: ${productName}`, targetId: req.params.id, targetName: productName });

        res.json({
            success: true,
            message: 'Product removed successfully',
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getProducts,
    getMyPurchasedProducts,
    getMyPurchasedVariants,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
};
