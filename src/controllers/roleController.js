const Role = require('../models/roleModel');
const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');
const {
    PERMISSION_CATALOG,
    ALL_PERMISSIONS,
    TENANT_ALLOWED_PERMISSIONS,
    getRoleScopeModules,
    validatePermissions,
} = require('../config/permissions');
const { logActivity } = require('../utils/activityLogger');
const { isDynamicSlug, isEditableCopySlug, ensureTenantRoleCopy } = require('../utils/dynamicRoles');

const SYSTEM_SLUGS = new Set(['super-admin', 'owner', 'customer']);

const slugify = (name) =>
    String(name || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);

/**
 * Anti-privilege-escalation: caller can only grant permissions they
 * themselves hold. Super-admin bypasses (has every permission).
 */
const callerCanGrantAll = (caller, perms) => {
    if (caller.isSuperAdmin) return { ok: true };
    const callerPerms = new Set(caller.permissions || []);
    const missing = perms.filter((p) => !callerPerms.has(p));
    return { ok: missing.length === 0, missing };
};

/**
 * Bump tenant.permissionVersion so any JWT issued before this moment is
 * rejected by authMiddleware — users are forced to re-login and get a
 * fresh permission set.
 */
const bumpTenantPermissionVersion = async (tenantId) => {
    if (!tenantId) return;
    await Tenant.updateOne({ _id: tenantId }, { $inc: { permissionVersion: 1 } });
};

// @desc    Master permission catalog for the role-editor UI
// @route   GET /api/roles/catalog
// @access  Private (roles.read)
const getCatalog = async (req, res) => {
    const tenantOnly = !req.user.isSuperAdmin;

    // Scope the catalog to a specific role's relevant modules (e.g. Customer
    // shouldn't show admin-only modules). null = all modules.
    const scopeModules = req.query.role ? getRoleScopeModules(req.query.role) : null;

    const entries = Object.entries(PERMISSION_CATALOG)
        .filter(([moduleKey, def]) => (!tenantOnly || def.scope === 'tenant') && (!scopeModules || scopeModules.includes(moduleKey)));

    const catalog = Object.fromEntries(entries);

    res.json({
        success: true,
        data: {
            catalog,
            allPermissions: tenantOnly ? TENANT_ALLOWED_PERMISSIONS : ALL_PERMISSIONS,
        },
    });
};

// @desc    List roles visible to the caller
// @route   GET /api/roles
// @access  Private (roles.read)
const getRoles = async (req, res) => {
    const filter = req.user.isSuperAdmin
        ? {}
        : {
            $or: [
                { tenantId: req.user.tenantId },             // tenant's own custom roles (legacy)
                { scope: 'platform', isSystemRole: true },   // Owner / Customer system roles
                { tenantId: null, isDefault: true },         // global dynamic (activatable) roles
            ],
        };

    const roles = await Role.find(filter)
        .populate('createdBy', 'firstName lastName email')
        .sort({ isSystemRole: -1, name: 1 })
        .lean();

    // Annotate each role with user count for UI display
    const roleIds = roles.map((r) => r._id);
    const counts = await User.aggregate([
        { $match: { roleId: { $in: roleIds } } },
        { $group: { _id: '$roleId', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));

    // Resolve which dynamic roles are active for this tenant (owner view).
    let enabled = [];
    if (!req.user.isSuperAdmin && req.user.tenantId) {
        const tenant = await Tenant.findById(req.user.tenantId).select('enabledRoles').lean();
        enabled = tenant?.enabledRoles || [];
    }

    let result;
    if (req.user.isSuperAdmin) {
        // Super-admin manages the catalog TEMPLATES — hide per-tenant editable copies.
        result = roles.filter((r) => !(r.tenantId && !r.isSystemRole && isEditableCopySlug(r.slug)));
    } else {
        // Owner view: hide system roles (Owner, Super Admin — not theirs to manage),
        // and collapse template + this-tenant copy of the same editable slug into
        // one card (prefer the editable tenant copy).
        const tid = req.user.tenantId?.toString();
        const copySlugs = new Set(
            roles.filter((r) => r.tenantId?.toString() === tid && isEditableCopySlug(r.slug)).map((r) => r.slug)
        );
        result = roles.filter((r) =>
            !r.isSystemRole &&
            !(isEditableCopySlug(r.slug) && !r.tenantId && copySlugs.has(r.slug))
        );
    }

    result.forEach((r) => {
        r.userCount = countMap[r._id.toString()] || 0;
        // Toggleable (activatable) role — shows the on/off switch.
        r.isDynamic = !r.isSystemRole && isDynamicSlug(r.slug);
        // Owner-editable per-tenant copy (toggleable dynamic OR always-on like Customer).
        r.isEditableCopy = !r.isSystemRole && !!r.tenantId && isEditableCopySlug(r.slug);
        // For the owner view, report whether it's switched on (always-on roles are always active).
        r.active = r.isDynamic ? enabled.includes(r.slug) : true;
    });

    res.json({ success: true, data: { roles: result } });
};

// @desc    Single role detail
// @route   GET /api/roles/:id
// @access  Private (roles.read)
const getRoleById = async (req, res) => {
    const role = await Role.findById(req.params.id)
        .populate('createdBy', 'firstName lastName email');

    if (!role) {
        return res.status(404).json({ success: false, message: 'Role not found' });
    }

    if (!req.user.isSuperAdmin) {
        const isTenantRole = role.tenantId && role.tenantId.toString() === req.user.tenantId?.toString();
        const isPlatformTemplate = role.scope === 'platform' && role.isSystemRole;
        if (!isTenantRole && !isPlatformTemplate) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
    }

    const userCount = await User.countDocuments({ roleId: role._id });

    res.json({
        success: true,
        data: { role: { ...role.toObject(), userCount } },
    });
};

// @desc    Create a custom role
// @route   POST /api/roles
// @access  Private (roles.create)
const createRole = async (req, res) => {
    try {
        const { name, description, permissions = [], scope: requestedScope } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Role name is required' });
        }

        if (!Array.isArray(permissions) || permissions.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one permission is required' });
        }

        const { valid, invalid } = validatePermissions(permissions);
        if (!valid) {
            return res.status(400).json({
                success: false,
                message: `Unknown permission keys: ${invalid.join(', ')}`,
            });
        }

        // Roles are created by SUPER ADMIN as GLOBAL, activatable catalog roles:
        // available to every tenant (tenantId null), OFF until an owner activates.
        // (requestedScope==='platform' still allowed for true platform-only roles.)
        const isPlatform = req.user.isSuperAdmin && requestedScope === 'platform';
        const scope = isPlatform ? 'platform' : 'tenant';
        const tenantId = null;

        // Tenant roles cannot grant platform-only perms
        if (!req.user.isSuperAdmin) {
            const platformOnly = permissions.filter((p) => !TENANT_ALLOWED_PERMISSIONS.includes(p));
            if (platformOnly.length > 0) {
                return res.status(403).json({
                    success: false,
                    message: `Cannot grant platform-only permissions: ${platformOnly.join(', ')}`,
                });
            }
        }

        // Privilege escalation guard
        const escalation = callerCanGrantAll(req.user, permissions);
        if (!escalation.ok) {
            return res.status(403).json({
                success: false,
                message: `You can only grant permissions you have. Missing: ${escalation.missing.join(', ')}`,
            });
        }

        const baseSlug = slugify(name);
        if (!baseSlug) {
            return res.status(400).json({ success: false, message: 'Role name contains no valid characters' });
        }
        if (SYSTEM_SLUGS.has(baseSlug)) {
            return res.status(400).json({ success: false, message: 'Cannot use a reserved system role name' });
        }

        // Resolve a unique slug within the tenant by appending a number on collision
        let slug = baseSlug;
        let suffix = 2;
        while (await Role.findOne({ tenantId, slug })) {
            slug = `${baseSlug}-${suffix++}`;
        }

        const role = await Role.create({
            name: name.trim(),
            slug,
            description: description?.trim() || '',
            isSystemRole: false,
            // Tenant-scope catalog roles are dynamic/activatable; platform roles are not.
            isDefault: scope === 'tenant',
            scope,
            tenantId,
            permissions,
            createdBy: req.user._id,
            isActive: true,
        });

        // No version bump on create: brand-new roles have no assigned users,
        // so no existing JWT can be stale because of this change.

        logActivity({
            req,
            action: 'create',
            module: 'roles',
            description: `Role created: ${role.name}`,
            targetId: role._id,
            targetName: role.name,
        });

        res.status(201).json({ success: true, message: 'Role created successfully', data: { role } });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ success: false, message: 'A role with this slug already exists' });
        }
        console.error('createRole error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to create role' });
    }
};

// @desc    Update a role
// @route   PUT /api/roles/:id
// @access  Private (roles.update)
const updateRole = async (req, res) => {
    try {
        const role = await Role.findById(req.params.id);
        if (!role) {
            return res.status(404).json({ success: false, message: 'Role not found' });
        }

        if (role.isSystemRole) {
            return res.status(403).json({ success: false, message: 'System roles cannot be modified' });
        }

        if (!req.user.isSuperAdmin) {
            if (!role.tenantId || role.tenantId.toString() !== req.user.tenantId?.toString()) {
                return res.status(403).json({ success: false, message: 'You can only edit roles in your own tenant' });
            }
        }

        const { name, description, permissions, isActive } = req.body;

        // Track whether permissions actually change — needed to decide
        // whether to invalidate other users' JWTs at the end.
        let permissionsChanged = false;
        const prevPerms = new Set(role.permissions || []);

        if (permissions !== undefined) {
            if (!Array.isArray(permissions) || permissions.length === 0) {
                return res.status(400).json({ success: false, message: 'At least one permission is required' });
            }

            const { valid, invalid } = validatePermissions(permissions);
            if (!valid) {
                return res.status(400).json({
                    success: false,
                    message: `Unknown permission keys: ${invalid.join(', ')}`,
                });
            }

            if (!req.user.isSuperAdmin) {
                const platformOnly = permissions.filter((p) => !TENANT_ALLOWED_PERMISSIONS.includes(p));
                if (platformOnly.length > 0) {
                    return res.status(403).json({
                        success: false,
                        message: `Cannot grant platform-only permissions: ${platformOnly.join(', ')}`,
                    });
                }
            }

            const escalation = callerCanGrantAll(req.user, permissions);
            if (!escalation.ok) {
                return res.status(403).json({
                    success: false,
                    message: `You can only grant permissions you have. Missing: ${escalation.missing.join(', ')}`,
                });
            }

            const nextPerms = new Set(permissions);
            const same = prevPerms.size === nextPerms.size && [...prevPerms].every((p) => nextPerms.has(p));
            permissionsChanged = !same;
            role.permissions = permissions;
        }

        if (name !== undefined) {
            const trimmed = name.trim();
            if (trimmed) role.name = trimmed;
            // Do not change slug on rename — that would orphan roleId references.
        }
        if (description !== undefined) role.description = description.trim();
        if (isActive !== undefined) role.isActive = !!isActive;

        await role.save();

        // Bump tenant permissionVersion ONLY if the permission set actually
        // changed AND at least one user currently holds this role. This
        // prevents the caller (Owner) from being logged out when editing a
        // role no one else uses yet.
        if (permissionsChanged) {
            const assignedCount = await User.countDocuments({ roleId: role._id });
            if (assignedCount > 0) {
                await bumpTenantPermissionVersion(role.tenantId);
            }
        }

        logActivity({
            req,
            action: 'update',
            module: 'roles',
            description: `Role updated: ${role.name}`,
            targetId: role._id,
            targetName: role.name,
        });

        res.json({ success: true, message: 'Role updated successfully', data: { role } });
    } catch (err) {
        console.error('updateRole error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to update role' });
    }
};

// @desc    Delete a role
// @route   DELETE /api/roles/:id
// @access  Private (roles.delete)
const deleteRole = async (req, res) => {
    try {
        const role = await Role.findById(req.params.id);
        if (!role) {
            return res.status(404).json({ success: false, message: 'Role not found' });
        }

        if (role.isSystemRole) {
            return res.status(403).json({ success: false, message: 'System roles cannot be deleted' });
        }

        // Delete is super-admin only (route-guarded). Removing a catalog role also
        // strips its slug from any tenant that had activated it.
        if (!req.user.isSuperAdmin) {
            if (!role.tenantId || role.tenantId.toString() !== req.user.tenantId?.toString()) {
                return res.status(403).json({ success: false, message: 'You can only delete roles in your own tenant' });
            }
        }

        const assignedCount = await User.countDocuments({ roleId: role._id });
        if (assignedCount > 0) {
            return res.status(409).json({
                success: false,
                message: `Cannot delete: ${assignedCount} user(s) still assigned to this role. Reassign them first.`,
            });
        }

        await Role.deleteOne({ _id: role._id });

        // Strip this role's slug from any tenant that had it activated.
        if (role.slug) {
            await Tenant.updateMany({ enabledRoles: role.slug }, { $pull: { enabledRoles: role.slug } });
        }

        // No version bump on delete: we already block deletion when users
        // are assigned, so no JWT in circulation can reference this role.

        logActivity({
            req,
            action: 'delete',
            module: 'roles',
            description: `Role deleted: ${role.name}`,
            targetId: role._id,
            targetName: role.name,
        });

        res.json({ success: true, message: 'Role deleted successfully' });
    } catch (err) {
        console.error('deleteRole error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to delete role' });
    }
};

// @desc    Owner activates / deactivates a dynamic role for their tenant
// @route   PATCH /api/roles/:id/activation   body: { active: boolean }
// @access  Private (owner — roles.read)
const setRoleActivation = async (req, res) => {
    try {
        const { active } = req.body;
        const role = await Role.findById(req.params.id).lean();
        if (!role) {
            return res.status(404).json({ success: false, message: 'Role not found' });
        }
        // Only dynamic catalog roles (by slug) can be toggled per-tenant. The
        // :id may be the global template OR this tenant's own copy — both fine.
        if (!isDynamicSlug(role.slug)) {
            return res.status(400).json({ success: false, message: 'Only dynamic roles can be activated or deactivated' });
        }

        const tenantId = req.user.tenantId;
        if (!tenantId) {
            return res.status(400).json({ success: false, message: 'No tenant context' });
        }

        const tenant = await Tenant.findById(tenantId);
        if (!tenant) {
            return res.status(404).json({ success: false, message: 'Tenant not found' });
        }

        const set = new Set(tenant.enabledRoles || []);
        if (active) {
            set.add(role.slug);
            // Materialise this tenant's editable copy (seeded from the template)
            // so the owner can customise its permissions and assign staff.
            await ensureTenantRoleCopy(tenantId, role.slug, req.user._id);
        } else {
            set.delete(role.slug);
        }
        tenant.enabledRoles = [...set];
        await tenant.save();

        logActivity({ req, action: 'update', module: 'roles', description: `Role ${active ? 'activated' : 'deactivated'}: ${role.name}`, targetId: role._id, targetName: role.name });

        res.json({ success: true, data: { slug: role.slug, active: !!active, enabledRoles: tenant.enabledRoles } });
    } catch (err) {
        console.error('setRoleActivation error:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to update role activation' });
    }
};

module.exports = {
    getCatalog,
    getRoles,
    getRoleById,
    createRole,
    updateRole,
    deleteRole,
    setRoleActivation,
};
