const ProductVariant = require('../models/productVariantModel');
const Product = require('../models/productModel');
const Customer = require('../models/customerModel');
const Tenant = require('../models/tenantModel');
const { NOTIFICATION_TYPES } = require('../constants/notificationTypes');
const { notifyTenantAdmins, notifyTenantProduction } = require('../services/notificationService');
const { logActivity } = require('../utils/activityLogger');
const { getUserTenantContext } = require('../utils/tenantResolver');

// @desc    Get all product variants (Tenant scoped)
// @route   GET /api/variants
// @access  Private (Admin/User)
const getVariants = async (req, res, next) => {
    try {
        const { productId } = req.query;

        // Multi-tenant: USER role sees variants from all accessible tenants
        const { tenantIds, tenantMap } = await getUserTenantContext(req.user);

        const filter = {
            tenantId: { $in: tenantIds },
            isActive: true,
        };

        if (productId) {
            const product = await Product.findById(productId).select('hasVariants');
            if (product && product.hasVariants === false) {
                return res.json({ success: true, count: 0, data: [] });
            }
            filter.productId = productId;
        }

        const variants = await ProductVariant.find(filter)
            .populate('productId', 'name productCode brand discount');

        const variantsWithDiscount = variants.map(v => {
            const obj = v.toObject();
            const tid = v.tenantId.toString();
            const tenantInfo = tenantMap[tid] || {};
            const commonDiscount = tenantInfo.commonDiscount ?? 0;
            const customerDiscount = tenantInfo.customerDiscount ?? 0;

            const productDiscount = obj.productId?.discount || 0;
            const effectiveDiscount = productDiscount > 0 ? productDiscount : commonDiscount;
            const totalDiscount = Math.min(100, effectiveDiscount + customerDiscount);
            obj.effectiveDiscount = effectiveDiscount;
            obj.customerDiscount = customerDiscount;
            obj.discountedPrice = totalDiscount > 0
                ? Math.round(obj.finalPrice * (1 - totalDiscount / 100) * 100) / 100
                : obj.finalPrice;

            // Tenant info
            obj.tenantName = tenantInfo.name || '';

            return obj;
        });

        res.json({
            success: true,
            count: variantsWithDiscount.length,
            data: variantsWithDiscount,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get single variant by ID
// @route   GET /api/variants/:id
// @access  Private (Admin/User)
const getVariantById = async (req, res, next) => {
    try {
        const variant = await ProductVariant.findById(req.params.id)
            .populate('productId', 'name productCode brand');

        if (!variant) {
            res.status(404);
            throw new Error('Product variant not found');
        }

        // Check tenant ownership — customer may access variants from any of their tenants
        const { tenantIds } = await getUserTenantContext(req.user);
        const allowedTenantStrs = tenantIds.map(id => id.toString());
        if (!allowedTenantStrs.includes(variant.tenantId.toString())) {
            res.status(403);
            throw new Error('Not authorized to access this variant');
        }

        res.json({
            success: true,
            data: variant,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Create product variant
// @route   POST /api/variants
// @access  Private/Admin
const createVariant = async (req, res, next) => {
    try {
        const {
            productId,
            sku,
            price,
            costPrice,
            taxPercentage,
            unit,
            weight,
            dimensions,
            stockQty,
            attributes,
            images,
        } = req.body;

        // Validate required fields
        if (!productId || !sku || price === undefined || stockQty === undefined) {
            res.status(400);
            throw new Error('Please provide all required fields');
        }

        // Verify product exists and belongs to tenant
        const product = await Product.findOne({
            _id: productId,
            tenantId: req.user.tenantId,
        });

        if (!product) {
            res.status(404);
            throw new Error('Product not found');
        }

        // Check if SKU already exists
        const existingVariant = await ProductVariant.findOne({ sku });
        if (existingVariant) {
            res.status(400);
            throw new Error('SKU already exists');
        }

        // If variant has no tax set, use product-level tax as default
        const effectiveTax = taxPercentage ? taxPercentage : (product.taxPercentage || 0);

        const variant = await ProductVariant.create({
            tenantId: req.user.tenantId,
            productId,
            sku,
            price,
            costPrice,
            taxPercentage: effectiveTax,
            unit: unit || 'Piece',
            weight,
            dimensions,
            stockQty,
            attributes: attributes || {},
            images: images || [],
            isActive: true,
        });

        const populatedVariant = await ProductVariant.findById(variant._id)
            .populate('productId', 'name productCode brand');

        logActivity({ req, action: 'create', module: 'variant', description: `Variant created: ${sku}`, targetId: variant._id, targetName: sku });

        res.status(201).json({
            success: true,
            data: populatedVariant,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update product variant
// @route   PUT /api/variants/:id
// @access  Private/Admin
const updateVariant = async (req, res, next) => {
    try {
        const variant = await ProductVariant.findById(req.params.id);

        if (!variant) {
            res.status(404);
            throw new Error('Product variant not found');
        }

        // Check tenant ownership
        if (variant.tenantId.toString() !== req.user.tenantId.toString()) {
            res.status(403);
            throw new Error('Not authorized to update this variant');
        }

        const oldValues = { price: variant.price, stockQty: variant.stockQty, sku: variant.sku };

        // Check if SKU is being updated and if it already exists
        if (req.body.sku && req.body.sku !== variant.sku) {
            const existingVariant = await ProductVariant.findOne({ sku: req.body.sku });
            if (existingVariant) {
                res.status(400);
                throw new Error('SKU already exists');
            }
        }

        // Update fields
        variant.sku = req.body.sku || variant.sku;
        variant.price = req.body.price !== undefined ? req.body.price : variant.price;
        variant.costPrice = req.body.costPrice !== undefined ? req.body.costPrice : variant.costPrice;
        variant.taxPercentage = req.body.taxPercentage !== undefined ? req.body.taxPercentage : variant.taxPercentage;
        variant.unit = req.body.unit || variant.unit;
        variant.weight = req.body.weight !== undefined ? req.body.weight : variant.weight;
        variant.dimensions = req.body.dimensions !== undefined ? req.body.dimensions : variant.dimensions;
        variant.stockQty = req.body.stockQty !== undefined ? req.body.stockQty : variant.stockQty;
        variant.attributes = req.body.attributes !== undefined ? req.body.attributes : variant.attributes;
        variant.images = req.body.images !== undefined ? req.body.images : variant.images;
        variant.isActive = req.body.isActive !== undefined ? req.body.isActive : variant.isActive;

        const updatedVariant = await variant.save();
        const populatedVariant = await ProductVariant.findById(updatedVariant._id)
            .populate('productId', 'name productCode brand');

        logActivity({ req, action: 'update', module: 'variant', description: `Variant updated: ${updatedVariant.sku}`, targetId: updatedVariant._id, targetName: updatedVariant.sku, metadata: { oldValue: oldValues, newValue: { price: updatedVariant.price, stockQty: updatedVariant.stockQty, sku: updatedVariant.sku } } });

        res.json({
            success: true,
            data: populatedVariant,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete product variant
// @route   DELETE /api/variants/:id
// @access  Private/Admin
const deleteVariant = async (req, res, next) => {
    try {
        const variant = await ProductVariant.findById(req.params.id);

        if (!variant) {
            res.status(404);
            throw new Error('Product variant not found');
        }

        // Check tenant ownership
        if (variant.tenantId.toString() !== req.user.tenantId.toString()) {
            res.status(403);
            throw new Error('Not authorized to delete this variant');
        }

        const variantSku = variant.sku;
        await variant.deleteOne();

        logActivity({ req, action: 'delete', module: 'variant', description: `Variant deleted: ${variantSku}`, targetId: req.params.id, targetName: variantSku });

        res.json({
            success: true,
            message: 'Product variant removed successfully',
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update variant stock
// @route   PATCH /api/variants/:id/stock
// @access  Private/Admin
const updateStock = async (req, res, next) => {
    try {
        const { stockQty } = req.body;

        if (stockQty === undefined) {
            res.status(400);
            throw new Error('Please provide stock quantity');
        }

        const variant = await ProductVariant.findById(req.params.id);

        if (!variant) {
            res.status(404);
            throw new Error('Product variant not found');
        }

        // Check tenant ownership
        if (variant.tenantId.toString() !== req.user.tenantId.toString()) {
            res.status(403);
            throw new Error('Not authorized to update this variant');
        }

        const oldStock = variant.stockQty;
        variant.stockQty = stockQty;
        await variant.save();

        res.json({
            success: true,
            data: variant,
        });

        logActivity({ req, action: 'restock', module: 'variant', description: `Stock updated: ${variant.sku} to ${stockQty}`, targetId: variant._id, targetName: variant.sku, metadata: { stockQty, oldValue: { stockQty: oldStock }, newValue: { stockQty: stockQty } } });

        // Fire-and-forget: notify production team of stock update
        notifyTenantProduction({
            tenantId: req.user.tenantId,
            type: NOTIFICATION_TYPES.STOCK_UPDATED,
            title: 'Stock Updated',
            message: `Stock Updated: ${variant.sku} restocked to ${stockQty} units`,
            data: { productVariantId: variant._id },
        });

        // Fire-and-forget: check low stock
        const tenantDoc = await Tenant.findById(req.user.tenantId).select('lowStockThreshold');
        const lowStockThreshold = tenantDoc?.lowStockThreshold ?? 10;
        if (stockQty <= lowStockThreshold) {
            notifyTenantAdmins({
                tenantId: req.user.tenantId,
                type: NOTIFICATION_TYPES.LOW_STOCK,
                title: 'Low Stock Alert',
                message: `Variant ${variant.sku} has only ${stockQty} units left`,
                data: { productVariantId: variant._id, productId: variant.productId },
            });
        }
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getVariants,
    getVariantById,
    createVariant,
    updateVariant,
    deleteVariant,
    updateStock,
};

