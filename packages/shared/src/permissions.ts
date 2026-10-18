export const PERMISSIONS = {
  'company.read': 'See company details and the dashboard',
  'users.read': 'See who has an account',
  'users.manage': 'Invite people, change roles and deactivate accounts',
  'settings.manage': 'Change Admin settings: company, email, AI, error tracking, security',
  'audit.read': 'Browse the audit log',
  'files.read': 'View and download files',
  'files.write': 'Upload files',
  'ai.chat': 'Use the AI assistant',
  'system.read': 'See version, migrations, backups and background jobs',
  'registry.read': 'See the share register, its holders and transactions at any date',
  'registry.draft': 'Prepare share register transactions and imports',
  'registry.commit': 'Enter and approve share register transactions',
  'registry.manage': 'Change share register settings',
  'captable.read': 'See the cap table: fully diluted ownership, equity plans, convertibles and valuations',
  'captable.model': 'Model rounds and exits in scenarios',
  'captable.manage': 'Manage equity plans, grants, convertibles, valuations, groups and cap table settings',
  'dataroom.read': 'See datarooms, their links, visitors and statistics',
  'dataroom.manage': 'Create and change datarooms, add documents, and create and revoke share links',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

export const ROLES = ['admin', 'board', 'member', 'auditor', 'readonly'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_INFO: Record<Role, { label: string; description: string; permissions: readonly Permission[] }> = {
  admin: {
    label: 'Admin',
    description: 'Everything, including users and Admin settings',
    permissions: ALL_PERMISSIONS,
  },
  board: {
    label: 'Board / CEO',
    description: 'Day-to-day work, and enters and approves share register transactions',
    permissions: [
      'company.read',
      'users.read',
      'files.read',
      'files.write',
      'ai.chat',
      'registry.read',
      'registry.draft',
      'registry.commit',
      'captable.read',
      'captable.model',
      'captable.manage',
      'dataroom.read',
      'dataroom.manage',
    ],
  },
  member: {
    label: 'Member',
    description: 'Day-to-day work, and prepares share register transactions',
    permissions: [
      'company.read',
      'users.read',
      'files.read',
      'files.write',
      'ai.chat',
      'registry.read',
      'registry.draft',
      'captable.read',
      'captable.model',
      'dataroom.read',
      'dataroom.manage',
    ],
  },
  auditor: {
    label: 'Auditor',
    description: 'Reads everything, including the share register at any date and the audit log',
    permissions: ['company.read', 'users.read', 'files.read', 'audit.read', 'registry.read', 'captable.read', 'dataroom.read'],
  },
  readonly: {
    label: 'Read-only',
    description: 'Can look but not change anything',
    permissions: ['company.read', 'users.read', 'files.read', 'ai.chat', 'registry.read', 'captable.read', 'dataroom.read'],
  },
};

export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return new Set(ROLE_INFO[role].permissions);
}
