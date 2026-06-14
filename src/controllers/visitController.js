const Visit = require('../models/visitModel');
const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const { generateLoginCode, getSystemRoleId } = require('./authController');
const { NOTIFICATION_TYPES } = require('../constants/notificationTypes');
const { createNotification, notifyTenantAdmins } = require('../services/notificationService');
const { logActivity } = require('../utils/activityLogger');
const { isOwnerRole, isSuperAdminRole } = require('../config/roleValues');
const { getTenantRoleId } = require('../utils/dynamicRoles');

// Whether this user should see every visit in the tenant (owner/super-admin),
// vs only the visits they personally logged (field/marketing staff).
const canSeeAllVisits = (user) => isOwnerRole(user.role) || isSuperAdminRole(user.role) || !!user.isSuperAdmin;

// @desc    Create a visit log
// @route   POST /api/visits
// @access  Private (MARKETING only)
const createVisit = async (req, res) => {
    try {
        // Capability is enforced by the `visits.create` route permission. The
        // creator is recorded as the visit's field user below.
        const { customerName, customerPhone, customerEmail, shopName, address, gstNumber, notes } = req.body;

        if (!customerName) {
            return res.status(400).json({
                success: false,
                message: 'Customer name is required',
                data: null,
                errors: [],
            });
        }

        const visit = await Visit.create({
            tenantId: req.user.tenantId,
            marketingUserId: req.user._id,
            customerName,
            customerPhone,
            customerEmail,
            shopName,
            address,
            gstNumber,
            notes,
            status: 'pending',
        });

        res.status(201).json({
            success: true,
            message: 'Visit created successfully',
            data: visit,
        });

        // Fire-and-forget: notify tenant admins/owners
        const marketingName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Field user';
        notifyTenantAdmins({
            tenantId: req.user.tenantId,
            type: NOTIFICATION_TYPES.VISIT_CREATED,
            title: 'New Customer Visit',
            message: `New customer visit by ${marketingName}: ${customerName}`,
            data: { visitId: visit._id },
        });

        logActivity({ req, action: 'create', module: 'visits', description: `Visit created for: ${customerName}`, targetId: visit._id, targetName: customerName });

        return;
    } catch (error) {
        console.error('Create visit error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to create visit',
            data: null,
            errors: [],
        });
    }
};

// @desc    Get visits
// @route   GET /api/visits
// @access  Private (Admin: all, Marketing: own)
const getVisits = async (req, res) => {
    try {
        const { status, marketingUserId, startDate, endDate } = req.query;
        const filter = { tenantId: req.user.tenantId };

        // Field staff see only their own visits; owners/super-admins see all.
        // (Capability to read visits at all is enforced by the route permission.)
        const seeAll = canSeeAllVisits(req.user);
        if (!seeAll) {
            filter.marketingUserId = req.user._id;
        }

        // Apply filters
        if (status) filter.status = status;
        if (marketingUserId && seeAll) filter.marketingUserId = marketingUserId;
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        const visits = await Visit.find(filter)
            .populate('marketingUserId', 'firstName lastName')
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            message: 'Visits fetched successfully',
            data: visits,
        });
    } catch (error) {
        console.error('Get visits error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch visits',
            data: null,
            errors: [],
        });
    }
};

// @desc    Get single visit by ID
// @route   GET /api/visits/:id
// @access  Private
const getVisitById = async (req, res) => {
    try {
        const visit = await Visit.findOne({ _id: req.params.id, tenantId: req.user.tenantId })
            .populate('marketingUserId', 'firstName lastName')
            .populate('customerId')
            .populate('userId', 'firstName lastName loginCode');

        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found',
                data: null,
                errors: [],
            });
        }

        // Field staff can only open their own visits; owners/super-admins any.
        if (!canSeeAllVisits(req.user) && visit.marketingUserId._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Access denied',
                data: null,
                errors: [],
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Visit fetched successfully',
            data: visit,
        });
    } catch (error) {
        console.error('Get visit by ID error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch visit',
            data: null,
            errors: [],
        });
    }
};

// @desc    Approve a visit — creates Customer + User
// @route   PUT /api/visits/:id/approve
// @access  Private (ADMIN only)
const approveVisit = async (req, res) => {
    try {
        const visit = await Visit.findOne({ _id: req.params.id, tenantId: req.user.tenantId });

        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found',
                data: null,
                errors: [],
            });
        }

        if (visit.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Visit is already ${visit.status}`,
                data: null,
                errors: [],
            });
        }

        // Create Customer document from visit data
        const customer = await Customer.create({
            tenantId: visit.tenantId,
            name: visit.customerName,
            mobile: visit.customerPhone || '',
            email: visit.customerEmail || '',
            shopName: visit.shopName || '',
            gstNumber: visit.gstNumber || '',
            address: visit.address || {},
            marketingUserId: visit.marketingUserId,
            isActive: true,
        });

        // Generate login code and create User document
        const loginCode = await generateLoginCode();

        const customerRoleId = await getTenantRoleId(visit.tenantId, 'customer');
        const user = await User.create({
            tenantId: visit.tenantId,
            name: visit.customerName,
            firstName: visit.customerName.split(' ')[0],
            lastName: visit.customerName.split(' ').slice(1).join(' ') || '',
            mobileNumber: visit.customerPhone || '',
            email: visit.customerEmail || undefined,
            loginCode,
            role: 'CUSTOMER',
            roleId: customerRoleId,
            isActive: true,
            isDeviceLocked: false,
            linkedCustomerId: customer._id,
        });

        // Update visit with approval details
        visit.status = 'approved';
        visit.customerId = customer._id;
        visit.userId = user._id;
        visit.loginCode = loginCode;
        visit.approvedAt = new Date();
        await visit.save();

        res.status(200).json({
            success: true,
            message: 'Visit approved. Customer and user created successfully.',
            data: visit,
        });

        // Fire-and-forget: notify marketing user
        createNotification({
            tenantId: visit.tenantId,
            recipientId: visit.marketingUserId,
            type: NOTIFICATION_TYPES.VISIT_APPROVED,
            title: 'Visit Approved',
            message: `Your visit to ${visit.customerName} has been approved. Login code: ${loginCode}`,
            data: { visitId: visit._id, customerId: customer._id, loginCode },
        });

        // Notify admin
        createNotification({
            tenantId: visit.tenantId,
            recipientId: req.user._id,
            type: NOTIFICATION_TYPES.VISIT_APPROVED,
            title: 'Customer Created',
            message: `Customer ${visit.customerName} approved and created`,
            data: { visitId: visit._id, customerId: customer._id },
        });

        logActivity({ req, action: 'approve', module: 'visits', description: `Visit approved for: ${visit.customerName}`, targetId: visit._id, targetName: visit.customerName });

        return;
    } catch (error) {
        console.error('Approve visit error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to approve visit',
            data: null,
            errors: [],
        });
    }
};

// @desc    Reject a visit
// @route   PUT /api/visits/:id/reject
// @access  Private (ADMIN only)
const rejectVisit = async (req, res) => {
    try {
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({
                success: false,
                message: 'Rejection reason is required',
                data: null,
                errors: [],
            });
        }

        const visit = await Visit.findOne({ _id: req.params.id, tenantId: req.user.tenantId });

        if (!visit) {
            return res.status(404).json({
                success: false,
                message: 'Visit not found',
                data: null,
                errors: [],
            });
        }

        if (visit.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Visit is already ${visit.status}`,
                data: null,
                errors: [],
            });
        }

        visit.status = 'rejected';
        visit.rejectionReason = reason;
        visit.rejectedAt = new Date();
        await visit.save();

        res.status(200).json({
            success: true,
            message: 'Visit rejected',
            data: visit,
        });

        // Fire-and-forget: notify marketing user
        createNotification({
            tenantId: visit.tenantId,
            recipientId: visit.marketingUserId,
            type: NOTIFICATION_TYPES.VISIT_REJECTED,
            title: 'Visit Rejected',
            message: `Your visit to ${visit.customerName} was rejected. Reason: ${reason}`,
            data: { visitId: visit._id, reason },
        });

        logActivity({ req, action: 'reject', module: 'visits', description: `Visit rejected for: ${visit.customerName}. Reason: ${reason}`, targetId: visit._id, targetName: visit.customerName });

        return;
    } catch (error) {
        console.error('Reject visit error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to reject visit',
            data: null,
            errors: [],
        });
    }
};

// @desc    Get visit stats (marketing performance)
// @route   GET /api/visits/stats
// @access  Private (ADMIN only)
const getVisitStats = async (req, res) => {
    try {
        const stats = await Visit.aggregate([
            { $match: { tenantId: req.user.tenantId } },
            {
                $group: {
                    _id: '$marketingUserId',
                    total: { $sum: 1 },
                    pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                    approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
                    rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
                },
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'marketingUser',
                },
            },
            { $unwind: '$marketingUser' },
            {
                $project: {
                    _id: 0,
                    marketingUserId: '$_id',
                    firstName: '$marketingUser.firstName',
                    lastName: '$marketingUser.lastName',
                    total: 1,
                    pending: 1,
                    approved: 1,
                    rejected: 1,
                },
            },
        ]);

        return res.status(200).json({
            success: true,
            message: 'Visit stats fetched successfully',
            data: stats,
        });
    } catch (error) {
        console.error('Get visit stats error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch visit stats',
            data: null,
            errors: [],
        });
    }
};

module.exports = {
    createVisit,
    getVisits,
    getVisitById,
    approveVisit,
    rejectVisit,
    getVisitStats,
};
