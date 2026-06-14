# RBAC Migration — Dynamic Roles & Permissions

> Architecture and implementation log for migrating DealerSetu from hardcoded role
> enum to a fully dynamic Role + Permission system.
>
> **Started:** 2026-05-13
> **Status:** Phase 1 complete (backend foundation). Phase 2–4 pending.

---

## 1. Goal

Replace the hardcoded role enum with a flexible RBAC system that lets each tenant
Owner define their own team roles with custom permission sets.

### Before (hardcoded)
```
ADMIN, USER, DISPATCH, PRODUCTION, MARKETING, SUPER_ADMIN
```
- Adding a new role required code change in 3 codebases
- DISPATCH/PRODUCTION/MARKETING permissions configured per tenant on Tenant model
  (`tenant.dispatchPermissions`, etc.) — limited and rigid

### After (dynamic)
```
System roles (immutable, only Super Admin can create):
  - SUPER_ADMIN  → platform admin, bypass everything
  - OWNER        → tenant owner (renamed from ADMIN)
  - CUSTOMER     → dealer/buyer (renamed from USER)

Custom roles (per tenant, created by Owner):
  - e.g. "Dispatch Manager", "Warehouse", "Accountant"
  - Each with its own permissions[] array
  - Soft / hard limit defined by isSystemRole flag
```

---

## 2. Design Decisions

| Decision | Choice | Why |
|---|---|---|
| **Permission storage** | Code constant (`config/permissions.js`) | Single source of truth, no DB schema migrations for new perms |
| **Permission format** | `module.action` strings (e.g. `products.create`) | Human-readable, easy to filter/group, ~60 perms total |
| **Per-request cache** | **JWT embedding** (not Redis) | Zero DB calls per request, no infra to set up |
| **Cache invalidation** | `tenant.permissionVersion` bump → old JWTs rejected | No polling, no distributed cache needed |
| **System roles** | Platform-scope, shared by all tenants | One `owner` Role doc used by every tenant's Owner user |
| **Custom roles** | Tenant-scope, `tenantId` set | Isolated per tenant, slug unique within tenant |
| **Per-user overrides** | `permissionOverrides: { grant[], revoke[] }` on User | Fine-tune individual users without creating new roles |
| **Resolution chain** | super-admin bypass → role.permissions → grant → revoke | Mirrors Ping-POS/CellPOS reference (Laravel) |
| **Features layer** | **SKIPPED for now** | No subscription billing yet; can add later |
| **Migration approach** | Fresh start — wipe DISPATCH/PRODUCTION/MARKETING | User explicitly chose this |
| **Backward compat** | Keep `role` enum, add `roleId` | Existing controllers keep working until refactored |

---

## 3. Reference Docs (Ping-POS / CellPOS)

User shared 3 HTML docs from a related Laravel POS project. We adapted the
architecture for our Node + MongoDB stack.

| Doc | Location | Key Takeaways |
|---|---|---|
| **Permission Flow** | `G:\My Drive\Project Docs\Ping-POS\Role & Permissions\permission_flow_document.html` | Resolution chain, Redis cache key pattern, middleware order |
| **Frontend Authorization** | `G:\My Drive\Project Docs\Ping-POS\Role & Permissions\Front-End-Authorization-Reference.html` | 5 UI surfaces (directives, components, sidebar, composer, JS map) |
| **Features & Subscriptions** | `G:\My Drive\Project Docs\Ping-POS\Role & Permissions\features_and_subscriptions_document.html` | Plan tables, location subscriptions, billing ledger (SKIPPED in our system) |

### Adaptations from Ping-POS
| Ping-POS | DealerSetu |
|---|---|
| Laravel + PHP + MySQL + Redis | Node + Express + MongoDB |
| `merchant_id` + `location_id` (2-level) | `tenantId` (1-level) |
| Redis cache `perms:u{id}:m{mid}:l{lid}` | JWT-embedded permissions |
| Blade `@can` directive | React `<Can permission="...">` component |
| Alpine `$can` magic helper | React `usePermission()` hook |
| `window.CellPOS.permissions` | `AuthContext.permissions` |
| Plans + Stripe billing | Skipped (no subscription model yet) |

---

## 4. Data Model

### `Role` (NEW collection)
```js
{
  _id, name, slug, description,
  isSystemRole: Boolean,         // true → uneditable (SUPER_ADMIN/OWNER/CUSTOMER)
  scope: 'platform' | 'tenant',
  tenantId: ObjectId | null,     // null for platform-scope roles
  permissions: [String],          // ['products.read', 'orders.approve', ...]
  createdBy: ObjectId(User),      // who created this role
  isActive: true,
  createdAt, updatedAt,
}
// Index: { tenantId: 1, slug: 1 } unique
// Index: { tenantId: 1, isActive: 1 }
```

### `User` (modified)
```js
{
  // Legacy field — kept for backward compat during transition
  role: enum [SUPER_ADMIN, OWNER, CUSTOMER, CUSTOM, ADMIN, USER, DISPATCH, PRODUCTION, MARKETING],

  // ── NEW dynamic RBAC fields ──
  roleId: ObjectId ref 'Role',
  permissionOverrides: {
    grant: [String],   // perms added on top of role
    revoke: [String],  // perms removed (explicit deny wins)
  },
}
```

### `Tenant` (modified)
```js
{
  // ... existing fields ...

  // NEW: JWT invalidation key — bumped when any role's perms change
  permissionVersion: Number (default 0),
}
```

---

## 5. Permission Catalog (60 total)

Defined in `api-shop/src/config/permissions.js`. Format: `module.action`.

### Tenant-scope (51 perms) — usable by Owner & custom roles
| Module | Actions |
|---|---|
| **products** | read, create, update, delete |
| **variants** | read, create, update, delete, updateStock |
| **categories** | read, create, update, delete |
| **customers** | read, create, update, delete |
| **orders** | read, create, update, delete, approve, dispatch, deliver, cancel |
| **banners** | read, create, update, delete |
| **visits** | read, create, update, approve, reject |
| **feedback** | read, create, reply, delete |
| **dashboard** | read |
| **team** | read, create, update, delete |
| **roles** | read, create, update, delete |
| **settings** | read, update |
| **notifications** | read, update |

### Platform-scope (9 perms) — Super Admin only
| Module | Actions |
|---|---|
| **tenants** | read, create, update, toggle |
| **activitylogs** | read |
| **systemroles** | read, create, update, delete |

### Default permission sets
- **SUPER_ADMIN** → all 60 (via bypass — no DB lookup)
- **OWNER** → all 51 tenant-scope perms
- **CUSTOMER** → 9 minimal: products.read, variants.read, categories.read, orders.read, orders.create, feedback.read, feedback.create, notifications.read, notifications.update

---

## 6. Permission Resolution Chain

Order of evaluation in `utils/permissionResolver.js`:

```
1. role.slug === 'super-admin'?  →  return ALL_PERMISSIONS  (bypass)
2. Start with role.permissions[]
3. Add overrides.grant[]   (union)
4. Remove overrides.revoke[]  (explicit deny wins over grant)
5. Return final Set as array
```

This runs ONCE at login time. Result is embedded in JWT.

---

## 7. JWT Payload Shape

```js
{
  id,                  // user _id
  tenantId,            // null for super-admin
  role,                // legacy string (SUPER_ADMIN/OWNER/CUSTOMER/CUSTOM) — backward compat
  roleSlug,            // role.slug — 'super-admin' | 'owner' | 'customer' | '<custom-slug>'
  isSuperAdmin,        // bool — fast bypass flag
  permissions,         // string[] — effective perms
  permissionVersion,   // number — tenant.permissionVersion at issuance
}
```

**On every request:**
1. `authMiddleware` decodes JWT (1 DB query for User + populate Tenant)
2. If `tenant.permissionVersion > jwt.permissionVersion` → 401 (force re-login)
3. Attach `req.user.permissions` and `req.user.isSuperAdmin`
4. `permissionMiddleware.requirePermission('x.y')` → array check, **zero DB calls**

---

## 8. The Plan (Original Architecture Doc)

This is the architecture we agreed upon before starting implementation.

### System Roles (3, immutable)

| Role | Created By | Tenant | Description |
|---|---|---|---|
| **SUPER_ADMIN** | DB seed (one-time) | None | Platform owner, manages everything |
| **OWNER** | Self (on registration) | Own tenant | Tenant owner — creates customers + custom roles |
| **CUSTOMER** | Owner | Owner's tenant | Read-only buyer, places orders |

System roles `isSystemRole: true` — UI hides edit/delete buttons, API rejects mutations.

### Custom Roles (Dynamic)
- **Owner** creates roles within their tenant (e.g. "Dispatch Manager", "Accountant")
- **Super Admin** can create platform-level roles (templates)
- **Customer** cannot create any role
- Privilege escalation prevention: a user can only grant permissions they themselves have

### Hierarchical Permission Levels
- **SUPER_ADMIN**: can grant ALL platform-level permissions
- **OWNER**: can grant only permissions OWNER itself has (no platform-only perms)
- **CUSTOMER**: read-only; cannot grant
- **Per-user override**: any user with `roles.update` permission can grant/revoke perms on individuals

### File Impact Estimate (full migration)
| Area | Files | Effort |
|---|---|---|
| Backend NEW + modified | ~25 | 4 days |
| Web frontend NEW + modified | ~20 | 2.5 days |
| Mobile NEW + modified | ~18 | 2 days |
| Testing + bug fixes + migration | — | 2.5 days |
| **Total** | **~65 files** | **~11 days** |

---

## 9. Phase 1 — Backend Foundation (COMPLETE ✅)

**Completed:** 2026-05-13

### Files Created (6 NEW)

| File | Purpose |
|---|---|
| `api-shop/src/config/permissions.js` | Master `PERMISSION_CATALOG` — 16 modules, 60 permissions, scope flags |
| `api-shop/src/models/roleModel.js` | Role schema with `(tenantId, slug)` unique compound index |
| `api-shop/src/utils/permissionResolver.js` | `computeEffectivePermissions()` chain logic |
| `api-shop/src/middlewares/permissionMiddleware.js` | `requirePermission()`, `requireAnyPermission()`, `requireAllPermissions()`, `requireSuperAdmin()` |
| `api-shop/src/scripts/seedSystemRoles.js` | Idempotent seed for super-admin/owner/customer system roles |
| `api-shop/src/scripts/migrateRoles.js` | ADMIN→OWNER, USER→CUSTOMER mapping; deletes DISPATCH/PRODUCTION/MARKETING; supports `--dry-run` |

### Files Modified (4)

| File | Change |
|---|---|
| `api-shop/src/models/userModel.js` | Added `roleId` (ref Role), `permissionOverrides {grant, revoke}`. Extended role enum with OWNER/CUSTOMER/CUSTOM for transition |
| `api-shop/src/models/tenantModel.js` | Added `permissionVersion: Number` (default 0) |
| `api-shop/src/utils/generateToken.js` | JWT now embeds `roleSlug, isSuperAdmin, permissions[], permissionVersion`. Backward-compatible function signature |
| `api-shop/src/middlewares/authMiddleware.js` | Single-query auth with tenant populate. Validates permissionVersion. Attaches `req.user.permissions`. Legacy middlewares updated to accept OWNER/CUSTOMER |

### Runtime Validation (passed)
```
ALL_PERMISSIONS count: 60          ✓
TENANT_ALLOWED count:  51          ✓
PLATFORM_ONLY count:    9          ✓
OWNER perms:           51          ✓
CUSTOMER perms:         9          ✓
super-admin bypass:    60          ✓ (gets all)
override resolution:   correct     ✓ (revoke beats grant)
unknown perm rejection: throws     ✓ (fail-loud)
```

### Backward Compatibility
- **Old JWTs still work** — missing `permissionVersion` field → check skipped
- **Existing controllers unaffected** — `req.user.role` still populated
- **Legacy `admin`/`userOrAdmin` middlewares** extended to accept OWNER/CUSTOMER alongside ADMIN/USER

---

## 10. Phase 2 — Role CRUD + Auth Refactor (COMPLETE ✅)

**Completed:** 2026-05-15

### Files Created (3 NEW)

| File | Purpose |
|---|---|
| `api-shop/src/utils/issueAuthTokens.js` | Single source of truth — loads user + role, computes effective perms, fetches `tenant.permissionVersion`, returns JWT pair. Used by every login flow + refresh. |
| `api-shop/src/controllers/roleController.js` | Role CRUD: `getCatalog`, `getRoles`, `getRoleById`, `createRole`, `updateRole`, `deleteRole`. Includes privilege-escalation guard + smart version bumping. |
| `api-shop/src/routes/roleRoutes.js` | Wires endpoints with `protect` + `requirePermission` guards. |

### Files Modified (2)

| File | Change |
|---|---|
| `api-shop/src/controllers/authController.js` | Imports `issueAuthTokens` + `issueAccessToken`. All 7 login flows (register, login, autoLogin, refresh, loginWithCode, switchTenant, verifyOtp, activateAccount) now issue JWTs with permissions embedded. Registration creates Owner with `roleId=owner system role`. Customer creation sets `roleId=customer`. Queries updated from `role: 'USER'` to `role: { $in: CUSTOMER_ROLE_VALUES }` (transition-safe). |
| `api-shop/src/app.js` | Registered `app.use('/api/roles', require('./routes/roleRoutes'))`. |

### Endpoints
```
GET    /api/roles/catalog      → master permission catalog (tenant-scoped for Owner, full for SuperAdmin)
GET    /api/roles              → list visible roles + userCount each
GET    /api/roles/:id          → single role detail
POST   /api/roles              → create custom role (privilege-escalation guarded)
PUT    /api/roles/:id          → update role (system roles blocked; smart version bump)
DELETE /api/roles/:id          → delete role (blocked if users still assigned)
```

### Integration Test Results (all pass)
1. ✅ catalog returns 13 modules + 51 tenant perms for Owner
2. ✅ list shows 3 system roles (super-admin, owner, customer) + user counts
3. ✅ create custom role with auto-generated slug
4. ✅ Caller stays logged in after create (no spurious version bump)
5. ✅ Update without assigned users → no bump
6. ✅ Privilege escalation blocked — Owner cannot grant `tenants.read`
7. ✅ System role tamper blocked — cannot edit `owner` system role
8. ✅ Delete works for custom roles

### Smart `permissionVersion` Bumping
Only bump when there's actually stale data to invalidate:
- **Create**: no bump (no users assigned yet → no stale JWTs)
- **Update with permission change**: bump ONLY if `User.countDocuments({ roleId }) > 0`
- **Delete**: no bump (already blocked when users assigned)

This prevents the caller from being kicked out by their own change.

### JWT Payload (verified live)
```json
{
  "id": "...",
  "tenantId": "6991ca3f632e13abaa7cd62c",
  "role": "OWNER",
  "roleSlug": "owner",
  "isSuperAdmin": false,
  "permissions": [51 entries: "products.read", "products.create", ...],
  "permissionVersion": 0,
  "iat": ..., "exp": ...
}
```

---

## 11. Phase 2.5 — Refactor existing routes (COMPLETE ✅)

**Completed:** 2026-05-27

All existing route files migrated from legacy `admin` / `checkPermission` /
`adminOrDispatch` middleware to the JWT-embedded `requirePermission()` /
`requireSuperAdmin()` guards. Permission gates now read from `req.user.permissions`
(zero DB calls).

### Files Refactored (12 route modules)

| File | Old guards | New guards |
|---|---|---|
| `productRoutes.js` | `admin`, `checkPermission('products')` | `requirePermission('products.read|create|update|delete')` |
| `categoryRoutes.js` | `admin`, `checkPermission('categories')` | `requirePermission('categories.*')` |
| `customerRoutes.js` | `admin`, `checkPermission('customers')` | `requirePermission('customers.*')` |
| `orderRoutes.js` | `admin`, `adminOrDispatch`, `dispatchOrderUpdate`, `checkPermission('orders')` | `requirePermission('orders.*')` + custom `allowOrderUpdate` (perm-aware field restriction) |
| `productVariantRoutes.js` | `admin`, `checkPermission('products')` | `requirePermission('variants.*')` + `variants.updateStock` |
| `bannerRoutes.js` | `admin` (write), `protect` (read) | `requirePermission('banners.*')` |
| `feedbackRoutes.js` | `admin` (subset), `protect` (subset) | `requirePermission('feedback.read|create|reply|delete')` |
| `visitRoutes.js` | `admin` (approve/reject/stats), `protect` (rest) | `requirePermission('visits.read|create|approve|reject')` |
| `dashboardRoutes.js` | `checkPermission('dashboard')` | `requirePermission('dashboard.read')` |
| `notificationRoutes.js` | `protect` only | `requirePermission('notifications.read|update')` |
| `teamRoutes.js` | `admin` everywhere | `requirePermission('team.*')`, `settings.read/update` for tenant info, `customers.read` for balances |
| `superAdminRoutes.js` | `superAdmin` | `requireSuperAdmin()` + per-route `requirePermission('tenants.*'\|'activitylogs.read')` |

### Highlights

- **orderRoutes — `allowOrderUpdate`**: a small inline middleware preserves the
  legacy "dispatch users can only edit `orderStatus` + `deliveryNotes`" rule, but
  now keyed off `orders.update` vs. `orders.dispatch` / `orders.deliver`
  permissions instead of hard-coded role strings.
- **Notifications now gated**: previously any authenticated user could hit
  `/api/notifications`. Customer's `notifications.read` + `notifications.update`
  permissions cover them; revoking those perms blocks access.
- **Team management (legacy dispatch/production/marketing endpoints)** kept under
  `team.*` permissions until they're fully replaced by dynamic-role management.
- **Super Admin endpoints** now require both `isSuperAdmin` flag AND specific
  platform-scope permissions — easier to delegate "read tenants but no toggle"
  in the future.

### Verification

Direct token issuance via `issueAccessToken(userId)` + curl smoke test of 12
endpoints across Owner (51 perms) + Customer (9 perms) JWTs. All assertions
match expected: Owner gets 200 everywhere, Customer gets 200 on
products/feedback/notifications and 403 on customers/dashboard/team/roles/
super-admin.

```text
Owner    GET /api/products         → 200  ✓
Owner    GET /api/customers        → 200  ✓
Owner    GET /api/dashboard        → 200  ✓
Owner    GET /api/team             → 200  ✓
Owner    GET /api/roles            → 200  ✓
Customer GET /api/products         → 200  ✓ (has products.read)
Customer GET /api/customers        → 403  ✓
Customer GET /api/dashboard        → 403  ✓
Customer GET /api/team             → 403  ✓
Customer GET /api/roles            → 403  ✓
Customer GET /api/feedback/my      → 200  ✓ (has feedback.read)
Customer GET /api/super-admin/...  → 403  ✓ (not super-admin)
```

### Files NOT Refactored (intentional)

- `authRoutes.js` — all public or `protect`-only endpoints (login, register, OTP, refresh, profile update). No permission gating needed.
- `uploadRoutes.js` — `protect`-only; upload is invoked by authenticated callers, gating happens on the downstream entity (product/banner) where the upload result is used.
- `roleRoutes.js` — already on `requirePermission()` from Phase 2.

### Legacy Middlewares — Status

The legacy role-string helpers in `authMiddleware.js` (`admin`, `userOrAdmin`,
`adminOrDispatch`, `dispatchOrderUpdate`, `superAdmin`, `production`,
`marketing`, `checkPermission`) are **no longer referenced by any route file**
but are kept exported for one more deploy cycle as a safety net. They can be
deleted in the next cleanup pass.

---

## 12. Phase 3 — Web Frontend (COMPLETE ✅)

**Completed:** 2026-05-15

### Files Created (4 NEW)

| File | Lines | Purpose |
|---|---|---|
| `frontend/src/lib/permissions.ts` | 90 | `decodeJwt`, `hasPermission`, `hasAnyPermission`, `hasAllPermissions` pure helpers + `useCan`/`useCanAny`/`useCanAll` hooks |
| `frontend/src/components/Can.tsx` | 50 | Declarative permission gate: `<Can permission="x.y">`, `<Can anyOf={[...]}>`, `<Can allOf={[...]}>`, with `fallback` |
| `frontend/src/pages/Roles.tsx` | 200 | Role list page with cards: name, slug, perms count, users count, system badge. Create / Edit / Delete actions gated by permissions. |
| `frontend/src/pages/RoleEdit.tsx` | 300 | Create/edit/view form with module-grouped permission grid. Indeterminate checkboxes per module. Greys out perms caller doesn't hold. |

### Files Modified (5)

| File | Change |
|---|---|
| `frontend/src/lib/types.ts` | Expanded `Role` type (scope, permissions, userCount, createdBy, etc.). Added `PermissionCatalog`, `PermissionModule` types. Updated `User` with `roleRef`, `roleSlug`, `permissions[]`, `permissionVersion`. |
| `frontend/src/lib/api.ts` | Added `rolesApi`: `getCatalog`, `getAll`, `getById`, `create`, `update`, `delete` with `mapRole` mapper. |
| `frontend/src/contexts/AuthContext.tsx` | Decodes JWT on login/restore via `decodeJwt()`. Exposes `permissions`, `hasPermission(key)`, `hasAnyPermission([])`, `hasAllPermissions([])`. Stored user enriched with JWT-derived RBAC fields. |
| `frontend/src/components/Sidebar.tsx` | Each menu item now declares `permission?: string`. Filter is `pool.filter(item => !item.permission \|\| hasPermission(item.permission))`. New "Roles" entry with `roles.read`. |
| `frontend/src/components/ProtectedRoute.tsx` | Added `permission` prop — preferred over legacy `adminOnly`/`superAdminOnly`. Allows SuperAdmin to access permission-gated routes. |
| `frontend/src/App.tsx` | Lazy-imported `Roles` + `RoleEdit`. Added routes `/roles`, `/roles/new`, `/roles/:id`, `/roles/:id/edit` under `<ProtectedRoute permission="roles.read" />`. |

### UX features
- **Permission picker grid** grouped by module (e.g. Products, Orders), with per-module "select all" via indeterminate checkbox.
- **Caller can't grant what they don't have** — UI greys out unauthorized perms with a hint banner; backend rejects anyway as the security boundary.
- **System role lock** — `owner`, `customer`, `super-admin` show `Lock` badge; form switches to read-only when viewing them.
- **Delete guarding** — Delete button hidden when role has `userCount > 0` or is a system role.
- **Re-enrichment on page reload** — Stored user in localStorage gets `permissions` re-injected from current JWT, so older sessions migrate seamlessly.

### TypeScript Compilation
`npx tsc --noEmit` passes cleanly.

### How to test in the browser
1. Login as Owner: `admin@gmail.com` / `666666` (master password)
2. Sidebar shows new **Roles** entry
3. Click → see 3 system roles (super-admin, owner, customer) as locked cards
4. Click **New Role** → create form with permission checkbox grid
5. Try granting `tenants.read` → field greyed out (Owner doesn't have it)
6. Create role "Dispatch Manager" with 5 perms → success → redirected to view

---

## 13. Phase 4 — Mobile App (COMPLETE ✅)

**Completed:** 2026-05-28

Expo Router app at `MyFirstApp/` now consumes JWT-embedded permissions
the same way the web frontend does.

### Files Created (3 NEW)

| File | Purpose |
|---|---|
| `MyFirstApp/lib/permissions.ts` | Pure-JS `base64UrlDecode` (Hermes-safe — no reliance on `atob`), `decodeJwt`, `hasPermission`, `hasAnyPermission`, `hasAllPermissions` |
| `MyFirstApp/components/Can.tsx` | Declarative permission gate: `<Can permission="x.y">`, `anyOf`, `allOf`, `fallback`. Super-admin always renders children. |
| `MyFirstApp/app/(drawer)/roles/index.tsx` | Roles list screen — cards with name, slug, perms count, users count, system badge. Pull-to-refresh. Permission-gated New / Edit / Delete buttons. |
| `MyFirstApp/app/(drawer)/roles/[id].tsx` | Role view/edit/create screen — module-grouped permission grid with per-module "All / Clear" toggle. Greys out perms caller doesn't hold. System roles open read-only. `?edit=1` query flips view → edit. |

### Files Modified (4)

| File | Change |
|---|---|
| `MyFirstApp/lib/types.ts` | Expanded `Role` type (scope, isSystemRole, permissions, userCount, …). Added `PermissionAction`, `PermissionModule`, `PermissionCatalog`. `User` gained `roleSlug`, `permissions[]`, `permissionVersion`. |
| `MyFirstApp/lib/api.ts` | Added `rolesApi`: `getCatalog`, `getAll`, `getById`, `create`, `update`, `delete` with `mapRole` mapper. |
| `MyFirstApp/features/auth/AuthContext.tsx` | `enrichUserWithToken()` decodes JWT and merges `permissions` + `roleSlug` + `permissionVersion` + `isSuperAdmin` onto the stored user on every login / restore / activate / switchTenant. Exposes `permissions`, `hasPermission(key)`, `hasAnyPermission([])`, `hasAllPermissions([])`. |
| `MyFirstApp/app/(drawer)/_layout.tsx` | `managementItems` array now has `permission?: string`, `customerOnly?`, `superAdminOnly?`. Filter is `permission` → `hasPermission(perm)`; legacy `dispatchKey`/`marketingKey`/`adminOnly` logic removed. New "Roles & Permissions" entry (`roles.read`). Drawer.Screen entries registered for `roles/index` + `roles/[id]`. |

### Bonus backend tweak

`api-shop/src/config/permissions.js` — `CUSTOMER_PERMISSIONS` now includes
`dashboard.read` (Customer dashboard endpoint already returns per-role data, so
the gate was just blocking the mobile customer view). Re-running
`node src/scripts/seedSystemRoles.js` updated the customer system role to 10 perms.

### TypeScript Compilation

`npx tsc --noEmit` on `MyFirstApp/` — zero errors in any of the touched files
(pre-existing unrelated errors in legacy files are out of scope).

### How to test in the Expo app

1. Login as Owner — drawer shows new **Roles & Permissions** entry
2. Login as Customer — drawer hides Roles (no `roles.read`), hides Customers /
   Team / Settings, keeps Dashboard / Categories / Products / Orders / Cart /
   Notifications / Feedback
3. Open Roles → 3 locked system roles visible (super-admin / owner / customer)
4. Tap `+` → New Role form with per-module permission grid
5. Try toggling `tenants.read` — greyed out (Owner doesn't have it)
6. Create "Dispatch Manager" with 5 perms → success → redirected to view
7. Edit → tap pencil icon → switches to editing mode → save

---

## 13.5. Cleanup Pass (COMPLETE ✅)

**Completed:** 2026-05-28

After all four phases shipped, an optional cleanup pass removed code that was
exported but no longer referenced anywhere.

### Backend

- **`api-shop/src/middlewares/authMiddleware.js`** — module now exports only
  `protect`. Deleted: `admin`, `userOrAdmin`, `adminOrDispatch`,
  `dispatchOrderUpdate`, `superAdmin`, `production`, `marketing`,
  `checkPermission`. Verified by greppping every `routes/*.js` first — zero
  references to any of these.

### Frontend (web)

- **`frontend/src/App.tsx`** — old `<Route element={<ProtectedRoute adminOnly />}>`
  block (8 routes lumped together) split into permission-keyed groups:
  `categories.read` → /categories, `customers.read` → /customers + /customers/:id,
  `team.read` → /dispatch + /production + /marketing, `banners.read` →
  /promotions, `settings.read` → /settings.
- **`frontend/src/components/ProtectedRoute.tsx`** — `adminOnly` prop removed
  along with the dispatch/production/marketing tenant-permission branching
  (~30 lines of dead code). Only `permission` and `superAdminOnly` remain.

### Verification

- Backend: 18 endpoint smoke test (8 Owner + 10 Customer) — all expected codes
  match. Customer now correctly hits `/api/dashboard` (after `dashboard.read`
  was added to CUSTOMER_PERMISSIONS in Phase 4).
- Frontend: `npx tsc --noEmit` clean.

### Deferred to a future pass (still safe to do, just out of scope here)

- Remove legacy `dispatchPermissions` / `productionPermissions` /
  `marketingPermissions` JSON blobs from `tenantModel.js` once the legacy team
  management screens (`/dispatch`, `/production`, `/marketing` UIs) are
  rewritten to use dynamic roles.
- Remove `isDispatch` / `isProduction` / `isMarketing` booleans + `DISPATCH` /
  `PRODUCTION` / `MARKETING` / `CUSTOM` role enum values from `userModel.js`
  once a deploy cycle confirms no JWT in the wild still relies on them.

---

## 14. Migration Steps (Production-safe)

When ready to run in production:

```bash
# 1. Backup the database
mongodump --uri="$MONGO_URI" --out=./backup-$(date +%Y%m%d)

# 2. Deploy backend with Phase 1 changes (already done — backward compat)
git push origin main   # Railway auto-deploys

# 3. Seed system roles
node src/scripts/seedSystemRoles.js

# 4. Preview migration
node src/scripts/migrateRoles.js --dry-run

# 5. Verify the dry-run output looks correct
#    - All SUPER_ADMIN users get super-admin roleId
#    - All ADMIN users renamed to OWNER + owner roleId
#    - All USER users renamed to CUSTOMER + customer roleId
#    - DISPATCH / PRODUCTION / MARKETING users marked for deletion

# 6. Apply migration
node src/scripts/migrateRoles.js

# 7. Existing users will need to re-login to get new JWT with permissions array
#    (Old tokens still work via legacy middlewares — no immediate breakage)
```

---

## 15. Pending Tasks

| Phase | Tasks | Status |
|---|---|---|
| **Phase 1** | #71-#80 (10 tasks: foundation) | ✅ COMPLETE |
| **Phase 2** | Role CRUD + auth refactor (#84-#88) | ✅ COMPLETE |
| **Phase 2.5** | Refactor existing routes (#97-#105) | ✅ COMPLETE |
| **Phase 3** | Web frontend (#89-#96) | ✅ COMPLETE |
| **Phase 4** | Mobile app (#107-#115) | ✅ COMPLETE |
| **Other** | #66-#70 git separation (api-shop → 3 fresh repos) | ⏳ Pending |

---

## 16. Open Questions / Future Considerations

1. **Custom role templates for super-admin** — Should super-admin be able to define
   "starter templates" that owners can copy when creating their own custom roles?
2. **Permission analytics** — Track which permissions are unused to recommend
   role consolidation.
3. **Audit log** — Already have `ActivityLog` model; ensure all role/permission
   changes are logged with before/after diffs.
4. **Features & Subscriptions** — Currently skipped, but the Ping-POS doc has a
   complete plan for tier-based feature gating. Revisit when/if subscription
   billing is added.
5. **Bulk permission assign** — UI for selecting multiple users + assigning the
   same role in one action.
6. **Role cloning** — "Duplicate this role" button to create a new custom role
   based on an existing one.

---

## 17. References

- **Plan file**: `C:\Users\Dixit\.claude\plans\cuddly-watching-toucan.md`
  (multi-tenant product listing — separate work, mostly complete)
- **Project memory**: `C:\Users\Dixit\.claude\projects\C--Users-Dixit-OneDrive-Desktop-myApp\memory\project_rbac_migration.md`
- **Ping-POS reference docs**: see §3 above
