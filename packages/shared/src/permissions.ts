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
  'signing.read': 'See documents sent for signature and their evidence trail',
  'signing.send': 'Prepare and send documents for signature, remind signers and void envelopes',
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
      'signing.read',
      'signing.send',
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
      'signing.read',
      'signing.send',
    ],
  },
  auditor: {
    label: 'Auditor',
    description: 'Reads everything, including the share register at any date and the audit log',
    permissions: ['company.read', 'users.read', 'files.read', 'audit.read', 'registry.read', 'signing.read'],
  },
  readonly: {
    label: 'Read-only',
    description: 'Can look but not change anything',
    permissions: ['company.read', 'users.read', 'files.read', 'ai.chat', 'registry.read', 'signing.read'],
  },
};

export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return new Set(ROLE_INFO[role].permissions);
}
