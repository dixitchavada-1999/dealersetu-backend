const Category = require('../models/categoryModel');
const Tenant = require('../models/tenantModel');
const { logActivity } = require('../utils/activityLogger');
const { getUserTenantContext } = require('../utils/tenantResolver');

// @desc    Get all categories (Tenant scoped / Multi-tenant for USER)
// @route   GET /api/categories
// @access  Private (Admin/User)
const getCategories = async (req, res, next) => {
    try {
        // Multi-tenant: USER role sees categories from all accessible tenants
        const { tenantIds, tenantMap } = await getUserTenantContext(req.user);

        const categories = await Category.find({
            tenantId: { $in: tenantIds },
            isActive: true,
        });

        const categoriesWithTenant = categories.map(c => {
            const obj = c.toObject();
            const tid = c.tenantId.toString();
            obj.tenantName = tenantMap[tid]?.name || '';
            return obj;
        });

        res.json({
            success: true,
            count: categoriesWithTenant.length,
            data: categoriesWithTenant,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Create category
// @route   POST /api/categories
// @access  Private/Admin
const createCategory = async (req, res, next) => {
    try {
        const { name, description, imageUrl, variantAttributes } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Please provide category name' });
        }

        let parsedAttributes = variantAttributes;
        if (typeof parsedAttributes === 'string') {
            try { parsedAttributes = JSON.parse(parsedAttributes); } catch { parsedAttributes = []; }
        }

        const category = await Category.create({
            tenantId: req.user.tenantId,
            name,
            description,
            imageUrl,
            isActive: true,
            variantAttributes: parsedAttributes || [],
        });

        logActivity({ req, action: 'create', module: 'category', description: `Category created: ${name}`, targetId: category._id, targetName: name });

        res.status(201).json({
            success: true,
            data: category,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private/Admin
const updateCategory = async (req, res, next) => {
    try {
        const category = await Category.findById(req.params.id);

        if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }

        // Check tenant ownership
        if (category.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this category' });
        }

        category.name = req.body.name || category.name;
        category.description = req.body.description !== undefined ? req.body.description : category.description;
        category.imageUrl = req.body.imageUrl !== undefined ? req.body.imageUrl : category.imageUrl;
        category.isActive = req.body.isActive !== undefined ? req.body.isActive : category.isActive;

        if (req.body.variantAttributes !== undefined) {
            let parsedAttributes = req.body.variantAttributes;
            if (typeof parsedAttributes === 'string') {
                try { parsedAttributes = JSON.parse(parsedAttributes); } catch { parsedAttributes = []; }
            }
            category.variantAttributes = parsedAttributes || [];
        }

        const updatedCategory = await category.save();

        logActivity({ req, action: 'update', module: 'category', description: `Category updated: ${updatedCategory.name}`, targetId: updatedCategory._id, targetName: updatedCategory.name });

        res.json({
            success: true,
            data: updatedCategory,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
const deleteCategory = async (req, res, next) => {
    try {
        const category = await Category.findById(req.params.id);

        if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }

        // Check tenant ownership
        if (category.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this category' });
        }

        const categoryName = category.name;
        await category.deleteOne();

        logActivity({ req, action: 'delete', module: 'category', description: `Category deleted: ${categoryName}`, targetId: req.params.id, targetName: categoryName });

        res.json({
            success: true,
            message: 'Category removed successfully',
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get a single category by id (tenant-scoped)
// @route   GET /api/categories/:id
// @access  Private (Admin/User)
const getCategoryById = async (req, res, next) => {
    try {
        const { tenantIds } = await getUserTenantContext(req.user);
        const category = await Category.findOne({ _id: req.params.id, tenantId: { $in: tenantIds } });
        if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.json({ success: true, data: category });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
};
