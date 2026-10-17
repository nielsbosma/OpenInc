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
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

export const ROLES = ['admin', 'member', 'readonly'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_INFO: Record<Role, { label: string; description: string; permissions: readonly Permission[] }> = {
  admin: {
    label: 'Admin',
    description: 'Everything, including users and Admin settings',
    permissions: ALL_PERMISSIONS,
  },
  member: {
    label: 'Member',
    description: 'Day-to-day work',
    permissions: ['company.read', 'users.read', 'files.read', 'files.write', 'ai.chat'],
  },
  readonly: {
    label: 'Read-only',
    description: 'Can look but not change anything',
    permissions: ['company.read', 'users.read', 'files.read', 'ai.chat'],
  },
};

export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return new Set(ROLE_INFO[role].permissions);
}
