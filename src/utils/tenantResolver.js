/**
 * Tenant Resolver Utility
 *
 * For USER role: resolves all tenant IDs the user has access to (via same mobileNumber)
 * and builds a map with tenant info + customer-specific discounts.
 * For other roles: returns single tenantId.
 */

const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');
const Customer = require('../models/customerModel');
const { CUSTOMER_ROLE_VALUES, isCustomerRole } = require('../config/roleValues');

/**
 * Get all tenant context for a user.
 *
 * @param {Object} user - The authenticated user (from req.user)
 * @returns {{ tenantIds: string[], tenantMap: Object }}
 *   tenantMap[tenantId] = { name, logo, businessType, commonDiscount, customerId, customerDiscount }
 */
const getUserTenantContext = async (user) => {
    // Non-customer roles (owner/staff/super-admin): single tenant only
    if (!isCustomerRole(user.role)) {
        const tenant = await Tenant.findById(user.tenantId).select('name logo businessType commonDiscount');
        const tenantId = user.tenantId.toString();
        return {
            tenantIds: [user.tenantId],
            tenantMap: {
                [tenantId]: {
                    name: tenant?.name || '',
                    logo: tenant?.logo || '',
                    businessType: tenant?.businessType || '',
                    commonDiscount: tenant?.commonDiscount ?? 0,
                    customerId: null,
                    customerDiscount: 0,
                },
            },
        };
    }

    // USER role: find all accounts with same mobileNumber
    if (!user.mobileNumber) {
        // No mobile → single tenant fallback
        const tenant = await Tenant.findById(user.tenantId).select('name logo businessType commonDiscount');
        const tenantId = user.tenantId.toString();
        return {
            tenantIds: [user.tenantId],
            tenantMap: {
                [tenantId]: {
                    name: tenant?.name || '',
                    logo: tenant?.logo || '',
                    businessType: tenant?.businessType || '',
                    commonDiscount: tenant?.commonDiscount ?? 0,
                    customerId: user.linkedCustomerId?.toString() || null,
                    customerDiscount: 0,
                },
            },
        };
    }

    // Find all customer accounts with same mobileNumber.
    // Exclude owners the customer has hidden (productsHiddenByCustomer) or
    // deactivated (deactivatedByCustomer) — their products must not appear.
    const userAccounts = await User.find({
        mobileNumber: user.mobileNumber,
        role: { $in: CUSTOMER_ROLE_VALUES },
        isActive: true,
        productsHiddenByCustomer: { $ne: true },
        deactivatedByCustomer: { $ne: true },
    }).select('tenantId linkedCustomerId');

    const tenantIds = [...new Set(userAccounts.map(u => u.tenantId.toString()))];
    const tenantObjectIds = tenantIds.map(id => id);

    // Fetch all tenants
    const tenants = await Tenant.find({ _id: { $in: tenantObjectIds }, isActive: true })
        .select('name logo businessType commonDiscount');

    const tenantLookup = {};
    tenants.forEach(t => {
        tenantLookup[t._id.toString()] = t;
    });

    // Fetch customer discounts per tenant
    const linkedCustomerIds = userAccounts
        .filter(u => u.linkedCustomerId)
        .map(u => u.linkedCustomerId);

    const customers = linkedCustomerIds.length > 0
        ? await Customer.find({ _id: { $in: linkedCustomerIds } }).select('discount tenantId')
        : [];

    const customerByTenant = {};
    userAccounts.forEach(u => {
        const tid = u.tenantId.toString();
        if (u.linkedCustomerId) {
            const cust = customers.find(c => c._id.toString() === u.linkedCustomerId.toString());
            customerByTenant[tid] = {
                customerId: u.linkedCustomerId.toString(),
                customerDiscount: cust?.discount ?? 0,
            };
        } else {
            customerByTenant[tid] = { customerId: null, customerDiscount: 0 };
        }
    });

    // Build tenantMap
    const tenantMap = {};
    tenantIds.forEach(tid => {
        const t = tenantLookup[tid];
        if (!t) return; // skip inactive/missing tenants
        tenantMap[tid] = {
            name: t.name || '',
            logo: t.logo || '',
            businessType: t.businessType || '',
            commonDiscount: t.commonDiscount ?? 0,
            customerId: customerByTenant[tid]?.customerId || null,
            customerDiscount: customerByTenant[tid]?.customerDiscount || 0,
        };
    });

    // Only include tenantIds that exist in tenantMap (active tenants)
    const activeTenantIds = tenantIds.filter(tid => tenantMap[tid]);

    return {
        tenantIds: activeTenantIds,
        tenantMap,
    };
};

module.exports = { getUserTenantContext };
