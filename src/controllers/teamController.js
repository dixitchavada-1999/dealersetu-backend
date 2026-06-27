const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');
const Order = require('../models/orderModel');
const { generateLoginCode } = require('./authController');
const { notifyTenantAdmins } = require('../services/notificationService');
const { logActivity } = require('../utils/activityLogger');
const { getTenantRoleId } = require('../utils/dynamicRoles');

// Customers are created with role 'CUSTOMER' under the new RBAC system, but
// legacy records may still carry role 'USER'. Match both everywhere we scope
// customer ("team member") queries, otherwise newly-created customers (CUSTOMER)
// won't appear in the list.
const CUSTOMER_ROLE_VALUES = ['USER', 'CUSTOMER'];

// @desc    Get all team members for tenant
// @route   GET /api/team
// @access  Private/Admin
const getTeamMembers = async (req, res) => {
    try {
        const members = await User.find({
            tenantId: req.user.tenantId,
            role: { $in: CUSTOMER_ROLE_VALUES },
        }).select('-password -refreshToken').sort({ createdAt: -1 });

        // Fetch customer discounts for linked customers
        const Customer = require('../models/customerModel');
        const linkedIds = members.filter(m => m.linkedCustomerId).map(m => m.linkedCustomerId);
        const customers = linkedIds.length > 0 ? await Customer.find({ _id: { $in: linkedIds } }).select('_id discount') : [];
        const discountMap = {};
        customers.forEach(c => { discountMap[c._id.toString()] = c.discount ?? 0; });

        const data = members.map(m => ({
            id: m._id.toString(),
            name: m.name || '',
            firstName: m.firstName || '',
            lastName: m.lastName || '',
            email: m.email || '',
            mobileNumber: m.mobileNumber || '',
            shopName: m.shopName || '',
            gstNumber: m.gstNumber || '',
            loginCode: m.loginCode || '',
            isDeviceLocked: m.isDeviceLocked || false,
            deviceId: m.deviceId || '',
            deactivatedByCustomer: m.deactivatedByCustomer || false,
            discount: m.linkedCustomerId ? (discountMap[m.linkedCustomerId.toString()] ?? 0) : 0,
            address: m.address || {},
            linkedCustomerId: m.linkedCustomerId ? m.linkedCustomerId.toString() : null,
            role: m.role,
            isActive: m.isActive,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
        }));

        return res.status(200).json({
            success: true,
            message: 'Team members fetched successfully',
            data,
        });
    } catch (error) {
        console.error('Get team members error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch team members',
            data: null,
            errors: [],
        });
    }
};

// @desc    Update team member
// @route   PUT /api/team/:id
// @access  Private/Admin
const updateTeamMember = async (req, res) => {
    try {
        const { name, firstName, lastName, email, mobileNumber, shopName, gstNumber, address, discount, regenerateCode } = req.body;

        const member = await User.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
            role: { $in: CUSTOMER_ROLE_VALUES },
        });

        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'Team member not found',
                data: null,
                errors: [],
            });
        }

        if (name) {
            member.name = name;
            member.firstName = name.split(' ')[0] || '';
            member.lastName = name.split(' ').slice(1).join(' ') || '';
        }
        if (firstName) member.firstName = firstName;
        if (lastName) member.lastName = lastName;
        if (email !== undefined) member.email = email || undefined;
        if (mobileNumber !== undefined) member.mobileNumber = mobileNumber;
        if (shopName !== undefined) member.shopName = shopName;
        if (gstNumber !== undefined) member.gstNumber = gstNumber;
        if (address !== undefined) member.address = address;

        if (regenerateCode) {
            member.loginCode = await generateLoginCode();
        }

        await member.save();

        // Update discount on linked Customer document
        let customerDiscount = 0;
        console.log('[Team] discount:', discount, 'linkedCustomerId:', member.linkedCustomerId);
        if (discount !== undefined && member.linkedCustomerId) {
            const Customer = require('../models/customerModel');
            const customer = await Customer.findById(member.linkedCustomerId);
            if (customer) {
                const oldDiscount = customer.discount;
                customer.discount = Math.max(0, Math.min(100, Number(discount)));
                await customer.save();
                customerDiscount = customer.discount;

                // Notify customer + admin if discount changed
                if (customer.discount !== oldDiscount) {
                    const { createNotification } = require('../services/notificationService');
                    console.log('[Team] Sending discount notification to customer:', member._id.toString(), member.firstName, member.lastName);
                    // Notify customer only
                    createNotification({
                        tenantId: req.user.tenantId,
                        recipientId: member._id,
                        type: 'discount_updated',
                        title: 'Special Discount!',
                        message: customer.discount > 0
                            ? `You've been given a ${customer.discount}% special discount on all products!`
                            : 'Your special discount has been removed',
                        data: { customerId: customer._id.toString(), customerName: customer.name || member.name, discount: customer.discount },
                    });
                }
            }
        } else if (member.linkedCustomerId) {
            const Customer = require('../models/customerModel');
            const customer = await Customer.findById(member.linkedCustomerId);
            customerDiscount = customer?.discount ?? 0;
        }

        return res.status(200).json({
            success: true,
            message: 'Team member updated successfully',
            data: {
                id: member._id.toString(),
                name: member.name || '',
                firstName: member.firstName,
                lastName: member.lastName,
                email: member.email || '',
                mobileNumber: member.mobileNumber || '',
                shopName: member.shopName || '',
                gstNumber: member.gstNumber || '',
                loginCode: member.loginCode || '',
                isDeviceLocked: member.isDeviceLocked || false,
                deviceId: member.deviceId || '',
                discount: customerDiscount,
                address: member.address || {},
                role: member.role,
                isActive: member.isActive,
                createdAt: member.createdAt,
                updatedAt: member.updatedAt,
            },
        });
    } catch (error) {
        console.error('Update team member error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update team member',
            data: null,
            errors: [],
        });
    }
};

// @desc    Delete team member
// @route   DELETE /api/team/:id
// @access  Private/Admin
const deleteTeamMember = async (req, res) => {
    try {
        const member = await User.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
            role: { $in: CUSTOMER_ROLE_VALUES },
        });

        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'Team member not found',
                data: null,
                errors: [],
            });
        }

        await User.deleteOne({ _id: member._id });

        return res.status(200).json({
            success: true,
            message: 'Team member deleted successfully',
            data: {},
        });
    } catch (error) {
        console.error('Delete team member error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete team member',
            data: null,
            errors: [],
        });
    }
};

// @desc    Lock customer device (only flips the flag — login code stays the same)
// @route   PUT /api/team/:id/lock-device
// @access  Private/Admin
const lockDevice = async (req, res) => {
    try {
        const member = await User.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
            role: { $in: CUSTOMER_ROLE_VALUES },
        });

        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'Team member not found',
                data: null,
                errors: [],
            });
        }

        member.isDeviceLocked = true;
        await member.save();

        return res.status(200).json({
            success: true,
            message: 'Device locked successfully',
            data: {
                id: member._id.toString(),
                firstName: member.firstName,
                lastName: member.lastName,
                isDeviceLocked: true,
                deviceId: member.deviceId || '',
                loginCode: member.loginCode || '',
            },
        });
    } catch (error) {
        console.error('Lock device error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to lock device',
            data: null,
            errors: [],
        });
    }
};

// @desc    Reset device lock for team member
// @route   PUT /api/team/:id/reset-device
// @access  Private/Admin
const resetDeviceLock = async (req, res) => {
    try {
        const member = await User.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
            role: { $in: CUSTOMER_ROLE_VALUES },
        });

        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'Team member not found',
                data: null,
                errors: [],
            });
        }

        member.isDeviceLocked = false;
        member.deviceId = undefined;
        // Regenerate login code so the customer can activate on the new device.
        // (Even if they previously set a password, a fresh code lets them re-activate.)
        const newLoginCode = await generateLoginCode();
        member.loginCode = newLoginCode;
        member.isPasswordSet = false;
        await member.save();

        return res.status(200).json({
            success: true,
            message: 'Device lock reset successfully',
            data: {
                id: member._id.toString(),
                firstName: member.firstName,
                lastName: member.lastName,
                isDeviceLocked: false,
                deviceId: '',
                loginCode: newLoginCode,
            },
        });
    } catch (error) {
        console.error('Reset device lock error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to reset device lock',
            data: null,
            errors: [],
        });
    }
};

// @desc    Get tenant info
// @route   GET /api/team/tenant
// @access  Private/Admin
const getTenantInfo = async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.user.tenantId);

        if (!tenant) {
            return res.status(404).json({
                success: false,
                message: 'Tenant not found',
                data: null,
                errors: [],
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Tenant info fetched successfully',
            data: {
                id: tenant._id.toString(),
                name: tenant.name,
                businessType: tenant.businessType || '',
                phone: tenant.phone || '',
                email: tenant.email || '',
                address: tenant.address || '',
                logo: tenant.logo || '',
                isActive: tenant.isActive,
                dispatchPermissions: tenant.dispatchPermissions || {
                    dashboard: false,
                    categories: false,
                    products: false,
                    orders: true,
                },
                productionPermissions: tenant.productionPermissions || {
                    dashboard: false,
                    categories: false,
                    products: false,
                    orders: true,
                },
                marketingPermissions: tenant.marketingPermissions || {
                    dashboard: false,
                    categories: false,
                    products: false,
                    orders: true,
                },
                lowStockThreshold: tenant.lowStockThreshold ?? 10,
                defaultRestockQuantity: tenant.defaultRestockQuantity ?? 50,
                bannerRotateInterval: tenant.bannerRotateInterval ?? 3,
                themeRotateInterval: tenant.themeRotateInterval ?? 5,
                exploreGridCols: tenant.exploreGridCols ?? 3,
                exploreGridGap: tenant.exploreGridGap ?? 1,
                exploreImageHeight: tenant.exploreImageHeight ?? 0,
                exploreShowTitle: tenant.exploreShowTitle !== false,
                commonDiscount: tenant.commonDiscount ?? 0,
                notificationsEnabled: tenant.notificationsEnabled ?? true,
                notificationPreferences: tenant.notificationPreferences || {
                    order_placed: true,
                    order_approved: true,
                    order_dispatched: true,
                    order_delivered: true,
                    order_cancelled: true,
                    payment_received: true,
                    payment_pending: true,
                    new_product: true,
                    new_customer: true,
                    low_stock: true,
                },
                gstNumber: tenant.gstNumber || '',
                udyamNumber: tenant.udyamNumber || '',
                aadharNumber: tenant.aadharNumber || '',
                panNumber: tenant.panNumber || '',
                bankDetails: {
                    accountNumber: tenant.bankDetails?.accountNumber || '',
                    ifscCode: tenant.bankDetails?.ifscCode || '',
                },
                createdAt: tenant.createdAt,
                updatedAt: tenant.updatedAt,
            },
        });
    } catch (error) {
        console.error('Get tenant info error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch tenant info',
            data: null,
            errors: [],
        });
    }
};

// @desc    Update tenant info
// @route   PUT /api/team/tenant
// @access  Private/Admin
const updateTenantInfo = async (req, res) => {
    try {
        const { name, businessType, phone, email, address, logo, lowStockThreshold, defaultRestockQuantity, bannerRotateInterval, themeRotateInterval, exploreGridCols, exploreGridGap, exploreImageHeight, exploreShowTitle, commonDiscount, notificationsEnabled, notificationPreferences, gstNumber, udyamNumber, aadharNumber, panNumber, bankDetails } = req.body;

        const tenant = await Tenant.findById(req.user.tenantId);

        if (!tenant) {
            return res.status(404).json({
                success: false,
                message: 'Tenant not found',
                data: null,
                errors: [],
            });
        }

        const oldValues = { name: tenant.name, commonDiscount: tenant.commonDiscount, lowStockThreshold: tenant.lowStockThreshold };

        if (name) tenant.name = name;
        if (businessType !== undefined) tenant.businessType = businessType;
        if (phone !== undefined) tenant.phone = phone;
        if (email !== undefined) tenant.email = email;
        if (address !== undefined) tenant.address = address;
        if (logo !== undefined) tenant.logo = logo;
        if (lowStockThreshold !== undefined) tenant.lowStockThreshold = Math.max(1, Number(lowStockThreshold));
        if (defaultRestockQuantity !== undefined) tenant.defaultRestockQuantity = Math.max(1, Number(defaultRestockQuantity));
        if (bannerRotateInterval !== undefined) tenant.bannerRotateInterval = Math.max(1, Number(bannerRotateInterval));
        if (themeRotateInterval !== undefined) tenant.themeRotateInterval = Math.max(1, Number(themeRotateInterval));
        if (exploreGridCols !== undefined) tenant.exploreGridCols = Math.max(2, Math.min(5, Number(exploreGridCols)));
        if (exploreGridGap !== undefined) tenant.exploreGridGap = Math.max(0, Math.min(10, Number(exploreGridGap)));
        if (exploreImageHeight !== undefined) tenant.exploreImageHeight = Math.max(0, Number(exploreImageHeight));
        if (exploreShowTitle !== undefined) tenant.exploreShowTitle = exploreShowTitle;
        if (commonDiscount !== undefined) tenant.commonDiscount = Math.max(0, Math.min(100, Number(commonDiscount)));
        if (notificationsEnabled !== undefined) tenant.notificationsEnabled = notificationsEnabled;
        if (notificationPreferences !== undefined) {
            if (!tenant.notificationPreferences) tenant.notificationPreferences = {};
            const validKeys = ['order_placed', 'order_approved', 'order_dispatched', 'order_delivered', 'order_cancelled', 'payment_received', 'payment_pending', 'new_product', 'new_customer', 'low_stock'];
            for (const key of validKeys) {
                if (notificationPreferences[key] !== undefined) {
                    tenant.notificationPreferences[key] = notificationPreferences[key];
                }
            }
        }
        if (gstNumber !== undefined) tenant.gstNumber = gstNumber;
        if (udyamNumber !== undefined) tenant.udyamNumber = udyamNumber;
        if (aadharNumber !== undefined) tenant.aadharNumber = aadharNumber;
        if (panNumber !== undefined) tenant.panNumber = panNumber;
        if (bankDetails !== undefined) {
            if (!tenant.bankDetails) tenant.bankDetails = {};
            if (bankDetails.accountNumber !== undefined) tenant.bankDetails.accountNumber = bankDetails.accountNumber;
            if (bankDetails.ifscCode !== undefined) tenant.bankDetails.ifscCode = bankDetails.ifscCode;
        }

        await tenant.save();

        logActivity({ req, action: 'update', module: 'settings', description: `Tenant info updated: ${tenant.name}`, targetId: tenant._id, targetName: tenant.name, metadata: { oldValue: oldValues, newValue: { name: tenant.name, commonDiscount: tenant.commonDiscount, lowStockThreshold: tenant.lowStockThreshold } } });

        // Notify all customers when common discount changes
        if (commonDiscount !== undefined && Number(commonDiscount) !== oldValues.commonDiscount) {
            const customers = await User.find({ tenantId: req.user.tenantId, role: { $in: CUSTOMER_ROLE_VALUES }, isActive: true }).select('_id');
            const { createNotification } = require('../services/notificationService');
            for (const cust of customers) {
                createNotification({
                    tenantId: req.user.tenantId,
                    recipientId: cust._id,
                    type: 'discount_updated',
                    title: 'Discount Updated!',
                    message: commonDiscount > 0
                        ? `You now get ${commonDiscount}% discount on all products!`
                        : 'Common discount has been removed',
                    data: { commonDiscount: Number(commonDiscount) },
                });
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Tenant info updated successfully',
            data: {
                id: tenant._id.toString(),
                name: tenant.name,
                businessType: tenant.businessType || '',
                phone: tenant.phone || '',
                email: tenant.email || '',
                address: tenant.address || '',
                logo: tenant.logo || '',
                isActive: tenant.isActive,
                dispatchPermissions: tenant.dispatchPermissions || {
                    dashboard: false,
                    categories: false,
                    products: false,
                    orders: true,
                },
                productionPermissions: tenant.productionPermissions || {
                    dashboard: false,
                    categories: false,
                    products: false,
                    orders: true,
                },
                marketingPermissions: tenant.marketingPermissions || {
                    dashboard: false,
                    categories: false,
                    products: false,
                    orders: true,
                },
                lowStockThreshold: tenant.lowStockThreshold ?? 10,
                defaultRestockQuantity: tenant.defaultRestockQuantity ?? 50,
                bannerRotateInterval: tenant.bannerRotateInterval ?? 3,
                themeRotateInterval: tenant.themeRotateInterval ?? 5,
                exploreGridCols: tenant.exploreGridCols ?? 3,
                exploreGridGap: tenant.exploreGridGap ?? 1,
                exploreImageHeight: tenant.exploreImageHeight ?? 0,
                exploreShowTitle: tenant.exploreShowTitle !== false,
                commonDiscount: tenant.commonDiscount ?? 0,
                notificationsEnabled: tenant.notificationsEnabled ?? true,
                notificationPreferences: tenant.notificationPreferences || {
                    order_placed: true,
                    order_approved: true,
                    order_dispatched: true,
                    order_delivered: true,
                    order_cancelled: true,
                    payment_received: true,
                    payment_pending: true,
                    new_product: true,
                    new_customer: true,
                    low_stock: true,
                },
                gstNumber: tenant.gstNumber || '',
                udyamNumber: tenant.udyamNumber || '',
                aadharNumber: tenant.aadharNumber || '',
                panNumber: tenant.panNumber || '',
                bankDetails: {
                    accountNumber: tenant.bankDetails?.accountNumber || '',
                    ifscCode: tenant.bankDetails?.ifscCode || '',
                },
                createdAt: tenant.createdAt,
                updatedAt: tenant.updatedAt,
            },
        });
    } catch (error) {
        console.error('Update tenant info error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update tenant info',
            data: null,
            errors: [],
        });
    }
};

// @desc    Get all dispatch users for tenant
// @route   GET /api/team/dispatch
// @access  Private/Admin
const getDispatchUsers = async (req, res) => {
    try {
        const members = await User.find({
            tenantId: req.user.tenantId,
            role: 'DISPATCH',
        }).select('-password -refreshToken').sort({ createdAt: -1 });

        const data = members.map(m => ({
            id: m._id.toString(),
            firstName: m.firstName || '',
            lastName: m.lastName || '',
            email: m.email || '',
            mobileNumber: m.mobileNumber || '',
            role: m.role,
            isActive: m.isActive,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
        }));

        return res.status(200).json({
            success: true,
            message: 'Dispatch users fetched successfully',
            data,
        });
    } catch (error) {
        console.error('Get dispatch users error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch dispatch users',
            data: null,
            errors: [],
        });
    }
};

// @desc    Update dispatch user
// @route   PUT /api/team/dispatch/:id
// @access  Private/Admin
const updateDispatchUser = async (req, res) => {
    try {
        const { firstName, lastName, email, mobileNumber, password } = req.body;

        const member = await User.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
            role: 'DISPATCH',
        });

        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'Dispatch user not found',
                data: null,
                errors: [],
            });
        }

        if (firstName) member.firstName = firstName;
        if (lastName !== undefined) member.lastName = lastName;
        if (email) member.email = email;
        if (mobileNumber !== undefined) member.mobileNumber = mobileNumber;
        if (password) member.password = password;
        member.name = `${member.firstName} ${member.lastName || ''}`.trim();

        await member.save();

        return res.status(200).json({
            success: true,
            message: 'Dispatch user updated successfully',
            data: {
                id: member._id.toString(),
                firstName: member.firstName,
                lastName: member.lastName,
                email: member.email || '',
                mobileNumber: member.mobileNumber || '',
                role: member.role,
                isActive: member.isActive,
                createdAt: member.createdAt,
                updatedAt: member.updatedAt,
            },
        });
    } catch (error) {
        console.error('Update dispatch user error:', error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `${field} already exists`,
                data: null,
                errors: [],
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update dispatch user',
            data: null,
            errors: [],
        });
    }
};

// @desc    Delete dispatch user
// @route   DELETE /api/team/dispatch/:id
// @access  Private/Admin
const deleteDispatchUser = async (req, res) => {
    try {
        const member = await User.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
            role: 'DISPATCH',
        });

        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'Dispatch user not found',
                data: null,
                errors: [],
            });
        }

        await User.deleteOne({ _id: member._id });

        return res.status(200).json({
            success: true,
            message: 'Dispatch user deleted successfully',
            data: {},
        });
    } catch (error) {
        console.error('Delete dispatch user error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete dispatch user',
            data: null,
            errors: [],
        });
    }
};

// @desc    Update dispatch permissions
// @route   PUT /api/team/dispatch-permissions
// @access  Private/Admin
const updateDispatchPermissions = async (req, res) => {
    try {
        const { dashboard, categories, products, orders } = req.body;

        const tenant = await Tenant.findById(req.user.tenantId);

        if (!tenant) {
            return res.status(404).json({
                success: false,
                message: 'Tenant not found',
                data: null,
                errors: [],
            });
        }

        const oldPerms = { ...tenant.dispatchPermissions.toObject() };

        if (dashboard !== undefined) tenant.dispatchPermissions.dashboard = dashboard;
        if (categories !== undefined) tenant.dispatchPermissions.categories = categories;
        if (products !== undefined) tenant.dispatchPermissions.products = products;
        if (orders !== undefined) tenant.dispatchPermissions.orders = orders;

        await tenant.save();

        logActivity({ req, action: 'update', module: 'permissions', description: 'Dispatch permissions updated', targetId: tenant._id, targetName: tenant.name, metadata: { oldValue: { permissions: oldPerms }, newValue: { permissions: tenant.dispatchPermissions } } });

        return res.status(200).json({
            success: true,
            message: 'Dispatch permissions updated successfully',
            data: {
                dispatchPermissions: tenant.dispatchPermissions,
            },
        });
    } catch (error) {
        console.error('Update dispatch permissions error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update dispatch permissions',
            data: null,
            errors: [],
        });
    }
};

// @desc    Get all production users for tenant
// @route   GET /api/team/production
// @access  Private/Admin
const getProductionUsers = async (req, res) => {
    try {
        const members = await User.find({
            tenantId: req.user.tenantId,
            role: 'PRODUCTION',
        }).select('-password -refreshToken').sort({ createdAt: -1 });

        const data = members.map(m => ({
            id: m._id.toString(),
            firstName: m.firstName || '',
            lastName: m.lastName || '',
            email: m.email || '',
            mobileNumber: m.mobileNumber || '',
            role: m.role,
            isActive: m.isActive,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
        }));

        return res.status(200).json({
            success: true,
            message: 'Production users fetched successfully',
            data,
        });
    } catch (error) {
        console.error('Get production users error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch production users',
            data: null,
            errors: [],
        });
    }
};

// @desc    Create production user
// @route   POST /api/team/production
// @access  Private/Admin
const createProductionUser = async (req, res) => {
    try {
        const { firstName, lastName, email, password, mobileNumber } = req.body;
        const adminUser = req.user;

        if (!firstName || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide firstName, email, and password',
                data: null,
                errors: [],
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long',
                data: null,
                errors: [],
            });
        }

        const prodTenant = await Tenant.findById(adminUser.tenantId).select('enabledRoles').lean();
        if (!prodTenant?.enabledRoles?.includes('production')) {
            return res.status(403).json({ success: false, message: 'Activate the Production role for your business before adding production staff.', data: null, errors: [] });
        }
        const productionRoleId = await getTenantRoleId(adminUser.tenantId, 'production');

        const user = await User.create({
            tenantId: adminUser.tenantId,
            firstName,
            lastName: lastName || '',
            name: `${firstName} ${lastName || ''}`.trim(),
            email,
            password,
            mobileNumber: mobileNumber || '',
            role: 'PRODUCTION',
            roleId: productionRoleId,
            isActive: true,
        });

        logActivity({ req, action: 'create', module: 'team', description: `Production user created: ${user.email}`, targetId: user._id, targetName: user.email });

        return res.status(201).json({
            success: true,
            message: 'Production user created successfully',
            data: {
                id: user._id.toString(),
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email || '',
                mobileNumber: user.mobileNumber || '',
                role: user.role,
                isActive: user.isActive,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            },
        });
    } catch (error) {
        console.error('Create production user error:', error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `${field} already exists`,
                data: null,
                errors: [],
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to create production user',
            data: null,
            errors: [],
        });
    }
};

// @desc    Update production user
// @route   PUT /api/team/production/:id
// @access  Private/Admin
const updateProductionUser = async (req, res) => {
    try {
        const { firstName, lastName, email, mobileNumber, password } = req.body;

        const member = await User.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
            role: 'PRODUCTION',
        });

        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'Production user not found',
                data: null,
                errors: [],
            });
        }

        if (firstName) member.firstName = firstName;
        if (lastName !== undefined) member.lastName = lastName;
        if (email) member.email = email;
        if (mobileNumber !== undefined) member.mobileNumber = mobileNumber;
        if (password) member.password = password;
        member.name = `${member.firstName} ${member.lastName || ''}`.trim();

        await member.save();

        return res.status(200).json({
            success: true,
            message: 'Production user updated successfully',
            data: {
                id: member._id.toString(),
                firstName: member.firstName,
                lastName: member.lastName,
                email: member.email || '',
                mobileNumber: member.mobileNumber || '',
                role: member.role,
                isActive: member.isActive,
                createdAt: member.createdAt,
                updatedAt: member.updatedAt,
            },
        });
    } catch (error) {
        console.error('Update production user error:', error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `${field} already exists`,
                data: null,
                errors: [],
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update production user',
            data: null,
            errors: [],
        });
    }
};

// @desc    Delete production user
// @route   DELETE /api/team/production/:id
// @access  Private/Admin
const deleteProductionUser = async (req, res) => {
    try {
        const member = await User.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
            role: 'PRODUCTION',
        });

        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'Production user not found',
                data: null,
                errors: [],
            });
        }

        await User.deleteOne({ _id: member._id });

        return res.status(200).json({
            success: true,
            message: 'Production user deleted successfully',
            data: {},
        });
    } catch (error) {
        console.error('Delete production user error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete production user',
            data: null,
            errors: [],
        });
    }
};

// @desc    Update production permissions
// @route   PUT /api/team/production-permissions
// @access  Private/Admin
const updateProductionPermissions = async (req, res) => {
    try {
        const { dashboard, categories, products, orders } = req.body;

        const tenant = await Tenant.findById(req.user.tenantId);

        if (!tenant) {
            return res.status(404).json({
                success: false,
                message: 'Tenant not found',
                data: null,
                errors: [],
            });
        }

        const oldPerms = { ...tenant.productionPermissions.toObject() };

        if (dashboard !== undefined) tenant.productionPermissions.dashboard = dashboard;
        if (categories !== undefined) tenant.productionPermissions.categories = categories;
        if (products !== undefined) tenant.productionPermissions.products = products;
        if (orders !== undefined) tenant.productionPermissions.orders = orders;

        await tenant.save();

        logActivity({ req, action: 'update', module: 'permissions', description: 'Production permissions updated', targetId: tenant._id, targetName: tenant.name, metadata: { oldValue: { permissions: oldPerms }, newValue: { permissions: tenant.productionPermissions } } });

        return res.status(200).json({
            success: true,
            message: 'Production permissions updated successfully',
            data: {
                productionPermissions: tenant.productionPermissions,
            },
        });
    } catch (error) {
        console.error('Update production permissions error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update production permissions',
            data: null,
            errors: [],
        });
    }
};

// @desc    Get all marketing users for tenant
// @route   GET /api/team/marketing
// @access  Private/Admin
const getMarketingUsers = async (req, res) => {
    try {
        const members = await User.find({
            tenantId: req.user.tenantId,
            role: 'MARKETING',
        }).select('-password -refreshToken').sort({ createdAt: -1 });

        const data = members.map(m => ({
            id: m._id.toString(),
            firstName: m.firstName || '',
            lastName: m.lastName || '',
            email: m.email || '',
            mobileNumber: m.mobileNumber || '',
            role: m.role,
            isActive: m.isActive,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
        }));

        return res.status(200).json({
            success: true,
            message: 'Marketing users fetched successfully',
            data,
        });
    } catch (error) {
        console.error('Get marketing users error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch marketing users',
            data: null,
            errors: [],
        });
    }
};

// @desc    Create marketing user
// @route   POST /api/team/marketing
// @access  Private/Admin
const createMarketingUser = async (req, res) => {
    try {
        const { firstName, lastName, email, password, mobileNumber } = req.body;
        const adminUser = req.user;

        if (!firstName || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide firstName, email, and password',
                data: null,
                errors: [],
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long',
                data: null,
                errors: [],
            });
        }

        const mktTenant = await Tenant.findById(adminUser.tenantId).select('enabledRoles').lean();
        if (!mktTenant?.enabledRoles?.includes('marketing')) {
            return res.status(403).json({ success: false, message: 'Activate the Marketing role for your business before adding marketing staff.', data: null, errors: [] });
        }
        const marketingRoleId = await getTenantRoleId(adminUser.tenantId, 'marketing');

        const user = await User.create({
            tenantId: adminUser.tenantId,
            firstName,
            lastName: lastName || '',
            name: `${firstName} ${lastName || ''}`.trim(),
            email,
            password,
            mobileNumber: mobileNumber || '',
            role: 'MARKETING',
            roleId: marketingRoleId,
            isActive: true,
        });

        logActivity({ req, action: 'create', module: 'team', description: `Marketing user created: ${user.email}`, targetId: user._id, targetName: user.email });

        return res.status(201).json({
            success: true,
            message: 'Marketing user created successfully',
            data: {
                id: user._id.toString(),
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email || '',
                mobileNumber: user.mobileNumber || '',
                role: user.role,
                isActive: user.isActive,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            },
        });
    } catch (error) {
        console.error('Create marketing user error:', error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `${field} already exists`,
                data: null,
                errors: [],
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to create marketing user',
            data: null,
            errors: [],
        });
    }
};

// @desc    Update marketing user
// @route   PUT /api/team/marketing/:id
// @access  Private/Admin
const updateMarketingUser = async (req, res) => {
    try {
        const { firstName, lastName, email, mobileNumber, password } = req.body;

        const member = await User.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
            role: 'MARKETING',
        });

        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'Marketing user not found',
                data: null,
                errors: [],
            });
        }

        if (firstName) member.firstName = firstName;
        if (lastName !== undefined) member.lastName = lastName;
        if (email) member.email = email;
        if (mobileNumber !== undefined) member.mobileNumber = mobileNumber;
        if (password) member.password = password;
        member.name = `${member.firstName} ${member.lastName || ''}`.trim();

        await member.save();

        return res.status(200).json({
            success: true,
            message: 'Marketing user updated successfully',
            data: {
                id: member._id.toString(),
                firstName: member.firstName,
                lastName: member.lastName,
                email: member.email || '',
                mobileNumber: member.mobileNumber || '',
                role: member.role,
                isActive: member.isActive,
                createdAt: member.createdAt,
                updatedAt: member.updatedAt,
            },
        });
    } catch (error) {
        console.error('Update marketing user error:', error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `${field} already exists`,
                data: null,
                errors: [],
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update marketing user',
            data: null,
            errors: [],
        });
    }
};

// @desc    Delete marketing user
// @route   DELETE /api/team/marketing/:id
// @access  Private/Admin
const deleteMarketingUser = async (req, res) => {
    try {
        const member = await User.findOne({
            _id: req.params.id,
            tenantId: req.user.tenantId,
            role: 'MARKETING',
        });

        if (!member) {
            return res.status(404).json({
                success: false,
                message: 'Marketing user not found',
                data: null,
                errors: [],
            });
        }

        await User.deleteOne({ _id: member._id });

        return res.status(200).json({
            success: true,
            message: 'Marketing user deleted successfully',
            data: {},
        });
    } catch (error) {
        console.error('Delete marketing user error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete marketing user',
            data: null,
            errors: [],
        });
    }
};

// @desc    Update marketing permissions
// @route   PUT /api/team/marketing-permissions
// @access  Private/Admin
const updateMarketingPermissions = async (req, res) => {
    try {
        const { dashboard, categories, products, orders } = req.body;

        const tenant = await Tenant.findById(req.user.tenantId);

        if (!tenant) {
            return res.status(404).json({
                success: false,
                message: 'Tenant not found',
                data: null,
                errors: [],
            });
        }

        const oldPerms = { ...tenant.marketingPermissions.toObject() };

        if (dashboard !== undefined) tenant.marketingPermissions.dashboard = dashboard;
        if (categories !== undefined) tenant.marketingPermissions.categories = categories;
        if (products !== undefined) tenant.marketingPermissions.products = products;
        if (orders !== undefined) tenant.marketingPermissions.orders = orders;

        await tenant.save();

        logActivity({ req, action: 'update', module: 'permissions', description: 'Marketing permissions updated', targetId: tenant._id, targetName: tenant.name, metadata: { oldValue: { permissions: oldPerms }, newValue: { permissions: tenant.marketingPermissions } } });

        return res.status(200).json({
            success: true,
            message: 'Marketing permissions updated successfully',
            data: {
                marketingPermissions: tenant.marketingPermissions,
            },
        });
    } catch (error) {
        console.error('Update marketing permissions error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to update marketing permissions',
            data: null,
            errors: [],
        });
    }
};

// @desc    Get customer balance summary (aggregated from orders)
// @route   GET /api/team/balances
// @access  Private/Admin
const getCustomerBalances = async (req, res) => {
    try {
        // Overall totals
        const totalResult = await Order.aggregate([
            { $match: { tenantId: req.user.tenantId, orderStatus: { $ne: 'Cancelled' } } },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: '$totalAmount' },
                    paidAmount: { $sum: '$paidAmount' },
                    orderCount: { $sum: 1 },
                },
            },
        ]);

        const stats = totalResult[0] || { totalAmount: 0, paidAmount: 0, orderCount: 0 };
        const pendingAmount = stats.totalAmount - stats.paidAmount;

        // Per-customer breakdown (keyed by customerId)
        const perCustomer = await Order.aggregate([
            { $match: { tenantId: req.user.tenantId, orderStatus: { $ne: 'Cancelled' } } },
            {
                $group: {
                    _id: '$customerId',
                    totalAmount: { $sum: '$totalAmount' },
                    paidAmount: { $sum: '$paidAmount' },
                    orderCount: { $sum: 1 },
                },
            },
        ]);

        const byCustomer = {};
        perCustomer.forEach(c => {
            byCustomer[c._id.toString()] = {
                totalAmount: c.totalAmount,
                paidAmount: c.paidAmount,
                pendingAmount: c.totalAmount - c.paidAmount,
                orderCount: c.orderCount,
            };
        });

        return res.status(200).json({
            success: true,
            message: 'Customer balances fetched successfully',
            data: {
                totalAmount: stats.totalAmount,
                paidAmount: stats.paidAmount,
                pendingAmount,
                orderCount: stats.orderCount,
                byCustomer,
            },
        });
    } catch (error) {
        console.error('Get customer balances error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch customer balances',
            data: null,
            errors: [],
        });
    }
};

// @desc    Get tenant settings (lightweight, any role)
// @route   GET /api/team/settings
// @access  Private
const getSettings = async (req, res) => {
    try {
        const tenant = await Tenant.findById(req.user.tenantId).select('lowStockThreshold notificationsEnabled');

        if (!tenant) {
            return res.status(404).json({
                success: false,
                message: 'Tenant not found',
                data: null,
                errors: [],
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Settings fetched successfully',
            data: {
                lowStockThreshold: tenant.lowStockThreshold ?? 10,
                notificationsEnabled: tenant.notificationsEnabled ?? true,
            },
        });
    } catch (error) {
        console.error('Get settings error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch settings',
            data: null,
            errors: [],
        });
    }
};

module.exports = {
    getTeamMembers,
    updateTeamMember,
    deleteTeamMember,
    resetDeviceLock,
    lockDevice,
    getTenantInfo,
    updateTenantInfo,
    getDispatchUsers,
    updateDispatchUser,
    deleteDispatchUser,
    updateDispatchPermissions,
    getProductionUsers,
    createProductionUser,
    updateProductionUser,
    deleteProductionUser,
    updateProductionPermissions,
    getMarketingUsers,
    createMarketingUser,
    updateMarketingUser,
    deleteMarketingUser,
    updateMarketingPermissions,
    getCustomerBalances,
    getSettings,
};
