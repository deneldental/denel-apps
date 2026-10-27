import { relations } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

// --- RBAC TABLES ---

export const roles = pgTable('roles', {
  id: text('id').primaryKey(), // 'admin', 'doctor', 'receptionist' for system roles; uuid slug for custom
  name: text('name').notNull().unique(),
  description: text('description'),
  isSystem: boolean('isSystem').default(false).notNull(), // system roles cannot be deleted
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    module: text('module').notNull(), // e.g., 'appointments'
    action: text('action').notNull(), // 'create', 'read', 'update', 'delete'
    description: text('description'),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
  },
  (t) => ({
    uniqueModuleAction: unique().on(t.module, t.action),
  })
)

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: text('roleId')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permissionId')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    // 'portal' | 'pwa' | 'hr' — which interface surface this grant applies to.
    // All rows created before this column was added default to 'portal'.
    scope: text('scope').notNull().default('portal'),
  },
  (t) => ({
    pk: [t.roleId, t.permissionId, t.scope],
  })
)

// --- RBAC v2: PERMISSION BUNDLES ---
// Additive tables — role_permissions above is kept for migration compatibility.
// Once all roles are migrated to bundles, role_permissions will be dropped.

export const permissionBundles = pgTable('permission_bundles', {
  id: text('id').primaryKey(), // stable slug for system bundles; uuid for custom
  name: text('name').notNull().unique(),
  description: text('description'),
  scope: text('scope').notNull().default('portal'), // 'portal' | 'pwa' | 'hr' | 'all'
  isSystem: boolean('isSystem').default(false).notNull(), // system bundles cannot be deleted
  // Phase 4B — bundle composition. When set, the parent bundle's permissions
  // are inherited at resolve time. Cycle detection lives in BundleResolver.
  parentBundleId: text('parentBundleId'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().notNull(),
})

export const bundlePermissions = pgTable(
  'bundle_permissions',
  {
    bundleId: text('bundleId')
      .notNull()
      .references(() => permissionBundles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permissionId')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: [t.bundleId, t.permissionId],
  })
)

export const roleBundles = pgTable(
  'role_bundles',
  {
    roleId: text('roleId')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    bundleId: text('bundleId')
      .notNull()
      .references(() => permissionBundles.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: [t.roleId, t.bundleId],
  })
)

// PR-11 — per-user bundle grants, additive on top of role_bundles.
// `grantSource` distinguishes manual grants (Access tab) from auto-grants
// driven by positionTag changes, so a positionTag flip-off only revokes
// auto rows and leaves HR's manual grants alone.
export const userBundles = pgTable(
  'user_bundles',
  {
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    bundleId: text('bundleId')
      .notNull()
      .references(() => permissionBundles.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('grantedAt').defaultNow().notNull(),
    grantedById: text('grantedById').references(() => user.id, { onDelete: 'set null' }),
    grantSource: text('grantSource').default('manual').notNull(), // 'manual' | 'auto_position_tag'
  },
  (t) => ({
    pk: [t.userId, t.bundleId],
  })
)

// Per-role scope grants — which application interfaces this role has access to.
// interfaceScope distinguishes UI-surface scopes ('portal' | 'pwa' | 'hr') from data
// scopes (clinic_id, etc.) which will be a separate concept.
export const roleScopes = pgTable(
  'role_scopes',
  {
    roleId: text('roleId')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    interfaceScope: text('interface_scope').notNull(), // 'portal' | 'pwa' | 'hr'
  },
  (t) => [primaryKey({ columns: [t.roleId, t.interfaceScope] })]
)

// Per-user scope overrides — grant or revoke a specific interface scope for one user
// without changing their role. E.g. temporarily suspend portal access.
export const userScopes = pgTable(
  'user_scopes',
  {
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    interfaceScope: text('interface_scope').notNull(), // 'portal' | 'pwa' | 'hr'
    granted: boolean('granted').default(true).notNull(),
    reason: text('reason'), // optional note explaining the override
    grantedById: text('grantedById').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('createdAt').defaultNow().notNull(),
    updatedAt: timestamp('updatedAt').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.interfaceScope] })]
)

// --- AUTH TABLES (Better-Auth) ---

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  role: text('role'), // Better Auth admin plugin expects this field
  banned: boolean('banned').default(false).notNull(), // Better Auth admin plugin expects this field
  banReason: text('banReason'), // Better Auth admin plugin optional field
  banExpires: timestamp('banExpires'), // Better Auth admin plugin optional field
  roleId: text('roleId').references(() => roles.id), // Link to RBAC role (our custom field)
  // Better Auth `username` plugin — login by staffId (e.g. FDM-S0001) on the
  // staff PWA. Normalized to lowercase; `displayUsername` keeps original case.
  username: text('username').unique(),
  displayUsername: text('displayUsername'),
  // Better Auth `twoFactor` plugin — when true, sign-in requires SMS-OTP
  // verification unless the device has a valid trust cookie. Set at staff
  // provisioning time.
  twoFactorEnabled: boolean('twoFactorEnabled').default(false).notNull(),
  // F20 / D8 — set when an admin writes a password for this person; cleared when they
  // change it themselves. The portal and HR app send a flagged session to the
  // change-password screen and the backend refuses everything else until then
  // (rbac/middleware/enforcePasswordChange). Default false: nobody is locked out by the
  // migration that added it.
  mustChangePassword: boolean('mustChangePassword').default(false).notNull(),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
})

// Better Auth `twoFactor` plugin storage — secret + backupCodes are required
// by the schema even when only SMS-OTP is used (TOTP/backup codes are unused
// in our deployment but the rows must exist for users with twoFactorEnabled).
export const twoFactor = pgTable('two_factor', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  backupCodes: text('backupCodes').notNull(),
  verified: boolean('verified').default(true).notNull(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonatedBy'), // Better Auth admin plugin field for impersonation
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt'),
  updatedAt: timestamp('updatedAt'),
})

// Better Auth rate-limit storage (database-backed).
// Replaces the in-memory default so counters survive restarts and shard
// correctly across horizontally-scaled backend instances. Schema matches
// Better Auth's expected model: id, key, count, lastRequest (epoch ms).
export const rateLimit = pgTable(
  'rateLimit',
  {
    id: text('id').primaryKey(),
    key: text('key'),
    count: integer('count'),
    lastRequest: bigint('lastRequest', { mode: 'number' }),
  },
  (t) => ({
    keyIdx: index('rate_limit_key_idx').on(t.key),
  })
)

// --- RELATIONS ---

// userRelations is defined in schema/index.ts (alongside userClinicalRelations)
// to avoid circular imports. All user relations live in one relations() call there.

export const roleRelations = relations(roles, ({ many }) => ({
  users: many(user),
  permissions: many(rolePermissions),
}))

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}))
