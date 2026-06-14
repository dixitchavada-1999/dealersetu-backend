const Banner = require('../models/bannerModel');
const Tenant = require('../models/tenantModel');
const { logActivity } = require('../utils/activityLogger');
const { getUserTenantContext } = require('../utils/tenantResolver');
const { isCustomerRole } = require('../config/roleValues');

// @desc    Get all banners (Admin sees all, customer sees active + within date range)
// @route   GET /api/banners
// @access  Private
const getBanners = async (req, res, next) => {
    try {
        let query;

        if (!isCustomerRole(req.user.role)) {
            // Owner / staff: management view — every banner in their tenant
            query = { tenantId: req.user.tenantId };
        } else {
            // Multi-tenant: customer sees banners from any tenant they belong to
            const { tenantIds } = await getUserTenantContext(req.user);
            const now = new Date();
            query = {
                tenantId: { $in: tenantIds },
                isActive: true,
                $or: [
                    { startDate: null, endDate: null },
                    { startDate: { $lte: now }, endDate: null },
                    { startDate: null, endDate: { $gte: now } },
                    { startDate: { $lte: now }, endDate: { $gte: now } },
                ],
            };
        }

        const banners = await Banner.find(query).sort({ priority: -1, createdAt: -1 });

        // Include rotation intervals for customer
        if (isCustomerRole(req.user.role)) {
            const tenant = await Tenant.findById(req.user.tenantId).select('bannerRotateInterval themeRotateInterval exploreGridCols exploreGridGap exploreImageHeight exploreShowTitle');
            res.json({
                success: true,
                count: banners.length,
                data: {
                    banners,
                    bannerRotateInterval: tenant?.bannerRotateInterval ?? 3,
                    themeRotateInterval: tenant?.themeRotateInterval ?? 5,
                    exploreGridCols: tenant?.exploreGridCols ?? 3,
                    exploreGridGap: tenant?.exploreGridGap ?? 1,
                    exploreImageHeight: tenant?.exploreImageHeight ?? 0,
                    exploreShowTitle: tenant?.exploreShowTitle !== false,
                },
            });
        } else {
            res.json({
                success: true,
                count: banners.length,
                data: banners,
            });
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Get single banner
// @route   GET /api/banners/:id
// @access  Private
const getBannerById = async (req, res, next) => {
    try {
        const banner = await Banner.findById(req.params.id);

        if (!banner) {
            res.status(404);
            throw new Error('Banner not found');
        }

        if (banner.tenantId.toString() !== req.user.tenantId.toString()) {
            res.status(403);
            throw new Error('Not authorized to view this banner');
        }

        res.json({
            success: true,
            data: banner,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Create banner
// @route   POST /api/banners
// @access  Private/Admin
const createBanner = async (req, res, next) => {
    try {
        const { title, description, imageUrl, mediaType, linkType, linkId, linkUrl, priority, startDate, endDate } = req.body;

        if (!title) {
            res.status(400);
            throw new Error('Please provide banner title');
        }

        if (!imageUrl) {
            res.status(400);
            throw new Error('Please provide banner image URL');
        }

        const banner = await Banner.create({
            tenantId: req.user.tenantId,
            title,
            description,
            imageUrl,
            mediaType: mediaType === 'video' ? 'video' : 'image',
            linkType,
            linkId,
            linkUrl,
            priority: priority || 0,
            startDate: startDate || null,
            endDate: endDate || null,
        });

        logActivity({ req, action: 'create', module: 'banner', description: `Banner created: ${title}`, targetId: banner._id, targetName: title });

        res.status(201).json({
            success: true,
            data: banner,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update banner
// @route   PUT /api/banners/:id
// @access  Private/Admin
const updateBanner = async (req, res, next) => {
    try {
        const banner = await Banner.findById(req.params.id);

        if (!banner) {
            res.status(404);
            throw new Error('Banner not found');
        }

        if (banner.tenantId.toString() !== req.user.tenantId.toString()) {
            res.status(403);
            throw new Error('Not authorized to update this banner');
        }

        banner.title = req.body.title || banner.title;
        banner.description = req.body.description !== undefined ? req.body.description : banner.description;
        banner.imageUrl = req.body.imageUrl !== undefined ? req.body.imageUrl : banner.imageUrl;
        banner.mediaType = req.body.mediaType !== undefined ? (req.body.mediaType === 'video' ? 'video' : 'image') : banner.mediaType;
        banner.linkType = req.body.linkType !== undefined ? req.body.linkType : banner.linkType;
        banner.linkId = req.body.linkId !== undefined ? req.body.linkId : banner.linkId;
        banner.linkUrl = req.body.linkUrl !== undefined ? req.body.linkUrl : banner.linkUrl;
        banner.isActive = req.body.isActive !== undefined ? req.body.isActive : banner.isActive;
        banner.priority = req.body.priority !== undefined ? req.body.priority : banner.priority;
        banner.startDate = req.body.startDate !== undefined ? req.body.startDate : banner.startDate;
        banner.endDate = req.body.endDate !== undefined ? req.body.endDate : banner.endDate;

        const updatedBanner = await banner.save();

        logActivity({ req, action: 'update', module: 'banner', description: `Banner updated: ${updatedBanner.title}`, targetId: updatedBanner._id, targetName: updatedBanner.title });

        res.json({
            success: true,
            data: updatedBanner,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete banner
// @route   DELETE /api/banners/:id
// @access  Private/Admin
const deleteBanner = async (req, res, next) => {
    try {
        const banner = await Banner.findById(req.params.id);

        if (!banner) {
            res.status(404);
            throw new Error('Banner not found');
        }

        if (banner.tenantId.toString() !== req.user.tenantId.toString()) {
            res.status(403);
            throw new Error('Not authorized to delete this banner');
        }

        const bannerTitle = banner.title;
        await banner.deleteOne();

        logActivity({ req, action: 'delete', module: 'banner', description: `Banner deleted: ${bannerTitle}`, targetId: req.params.id, targetName: bannerTitle });

        res.json({
            success: true,
            message: 'Banner removed successfully',
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getBanners,
    getBannerById,
    createBanner,
    updateBanner,
    deleteBanner,
};
