const Customer = require('../models/customerModel');
const { NOTIFICATION_TYPES } = require('../constants/notificationTypes');
const { notifyTenantAdmins, createNotification, findUserByCustomerId } = require('../services/notificationService');
const { logActivity } = require('../utils/activityLogger');

// @desc    Get all customers (Tenant scoped)
// @route   GET /api/customers
// @access  Private (Admin/User)
const getCustomers = async (req, res, next) => {
    try {
        const customers = await Customer.find({
            tenantId: req.user.tenantId,
            isActive: true,
        });

        res.json({
            success: true,
            count: customers.length,
            data: customers,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get single customer by ID
// @route   GET /api/customers/:id
// @access  Private (Admin/User)
const getCustomerById = async (req, res, next) => {
    try {
        const customer = await Customer.findById(req.params.id);

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        // Check tenant ownership
        if (customer.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to access this customer' });
        }

        res.json({
            success: true,
            data: customer,
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Create customer
// @route   POST /api/customers
// @access  Private/Admin
const createCustomer = async (req, res, next) => {
    try {
        const { name, mobile, email, shopName, gstNumber, address } = req.body;

        // Validate required fields
        if (!name || !mobile) {
            return res.status(400).json({ success: false, message: 'Please provide name and mobile number' });
        }

        const customer = await Customer.create({
            tenantId: req.user.tenantId,
            name,
            mobile,
            email,
            shopName,
            gstNumber,
            address,
            outstandingAmount: 0,
            isActive: true,
        });

        res.status(201).json({
            success: true,
            data: customer,
        });

        logActivity({ req, action: 'create', module: 'customer', description: `Customer created: ${name}`, targetId: customer._id, targetName: name });

        // Fire-and-forget: notify admins about new customer
        notifyTenantAdmins({
            tenantId: req.user.tenantId,
            type: NOTIFICATION_TYPES.NEW_CUSTOMER,
            title: 'New Customer Added',
            message: `${name} has been added as a new customer`,
            data: { customerId: customer._id },
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update customer
// @route   PUT /api/customers/:id
// @access  Private/Admin
const updateCustomer = async (req, res, next) => {
    try {
        const customer = await Customer.findById(req.params.id);

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        // Check tenant ownership
        if (customer.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this customer' });
        }

        const oldValues = { name: customer.name, discount: customer.discount, mobile: customer.mobile };
        const oldDiscount = customer.discount;

        customer.name = req.body.name || customer.name;
        customer.mobile = req.body.mobile || customer.mobile;
        customer.email = req.body.email !== undefined ? req.body.email : customer.email;
        customer.shopName = req.body.shopName !== undefined ? req.body.shopName : customer.shopName;
        customer.gstNumber = req.body.gstNumber !== undefined ? req.body.gstNumber : customer.gstNumber;
        customer.address = req.body.address !== undefined ? req.body.address : customer.address;
        customer.outstandingAmount = req.body.outstandingAmount !== undefined ? req.body.outstandingAmount : customer.outstandingAmount;
        customer.isActive = req.body.isActive !== undefined ? req.body.isActive : customer.isActive;
        customer.discount = req.body.discount !== undefined ? req.body.discount : customer.discount;

        const updatedCustomer = await customer.save();

        res.json({
            success: true,
            data: updatedCustomer,
        });

        logActivity({ req, action: 'update', module: 'customer', description: `Customer updated: ${updatedCustomer.name}`, targetId: updatedCustomer._id, targetName: updatedCustomer.name, metadata: { oldValue: oldValues, newValue: { name: updatedCustomer.name, discount: updatedCustomer.discount, mobile: updatedCustomer.mobile } } });

        // Fire-and-forget: notify customer if discount changed
        if (req.body.discount !== undefined && req.body.discount !== oldDiscount) {
            const customerUser = await findUserByCustomerId(req.user.tenantId, customer._id);
            if (customerUser) {
                // Notify customer only
                createNotification({
                    tenantId: req.user.tenantId,
                    recipientId: customerUser._id,
                    type: 'discount_updated',
                    title: 'Special Discount!',
                    message: req.body.discount > 0
                        ? `You've been given a ${req.body.discount}% special discount on all products!`
                        : 'Your special discount has been removed',
                    data: { customerId: customer._id.toString(), customerName: customer.name, discount: req.body.discount },
                });
            }
        }
    } catch (error) {
        next(error);
    }
};

// @desc    Delete customer
// @route   DELETE /api/customers/:id
// @access  Private/Admin
const deleteCustomer = async (req, res, next) => {
    try {
        const customer = await Customer.findById(req.params.id);

        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        // Check tenant ownership
        if (customer.tenantId.toString() !== req.user.tenantId.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this customer' });
        }

        const customerName = customer.name;
        await customer.deleteOne();

        logActivity({ req, action: 'delete', module: 'customer', description: `Customer deleted: ${customerName}`, targetId: req.params.id, targetName: customerName });

        res.json({
            success: true,
            message: 'Customer removed successfully',
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getCustomers,
    getCustomerById,
    createCustomer,
    updateCustomer,
    deleteCustomer,
};

