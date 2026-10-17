import type { Permission } from '@openinc/shared';
import {
  Activity,
  BarChart3,
  Building2,
  FileSignature,
  FolderLock,
  Handshake,
  LayoutDashboard,
  type LucideIcon,
  Settings,
  Users,
} from 'lucide-react';

/** Labels are AP-style Title Case (see CLAUDE.md); nav-titles.test.ts checks them. */
export interface NavItem {
  title: string;
  path: string;
  icon: LucideIcon;
  permission?: Permission;
  description?: string;
}

/** The company modules. Each is a placeholder until its own spec is built. */
export const MODULES: NavItem[] = [
  {
    title: 'Shareholders',
    path: '/shareholders',
    icon: Building2,
    description: 'The shareholder registry: who owns which shares, with history.',
  },
  { title: 'Cap Table', path: '/cap-table', icon: BarChart3, description: 'Share classes, options and fully diluted ownership.' },
  { title: 'Signing', path: '/signing', icon: FileSignature, description: 'Send documents for signature and track who has signed.' },
  { title: 'Dataroom', path: '/dataroom', icon: FolderLock, description: 'Share documents with investors and see who viewed what.' },
  { title: 'Fundraising', path: '/fundraising', icon: Handshake, description: 'Investor CRM and tracked document links.' },
];

export const MAIN_NAV: NavItem[] = [{ title: 'Dashboard', path: '/', icon: LayoutDashboard }, ...MODULES];

/** Settings holds Users and the Audit Log too, so members who may only see Users still find it. */
export const SETTINGS_NAV: NavItem = { title: 'Settings', path: '/admin/settings', icon: Settings };

export const SETTINGS_PERMISSIONS: Permission[] = ['settings.manage', 'users.read', 'audit.read'];

/** Admin Settings sections, in the order of its left nav. */
export const SETTINGS_SECTIONS: (NavItem & { key: string })[] = [
  {
    key: 'company',
    title: 'Company',
    path: '/admin/settings/company',
    icon: Building2,
    permission: 'settings.manage',
    description: 'Name, registration number, address, currency, time zone and logo.',
  },
  {
    key: 'users',
    title: 'Users',
    path: '/admin/settings/users',
    icon: Users,
    permission: 'users.read',
    description: 'Everyone with an account, pending invitations and roles.',
  },
  {
    key: 'email',
    title: 'Email',
    path: '/admin/settings/email',
    icon: Settings,
    permission: 'settings.manage',
    description: 'The SMTP server for invitations, password resets and notifications.',
  },
  {
    key: 'ai',
    title: 'AI',
    path: '/admin/settings/ai',
    icon: Settings,
    permission: 'settings.manage',
    description: 'The provider behind the assistant.',
  },
  {
    key: 'errors',
    title: 'Error Tracking',
    path: '/admin/settings/errors',
    icon: Settings,
    permission: 'settings.manage',
    description: 'Send server and browser errors to Bugsink or Sentry.',
  },
  {
    key: 'storage',
    title: 'Storage',
    path: '/admin/settings/storage',
    icon: Settings,
    permission: 'settings.manage',
    description: 'The S3 bucket for files and database backups. Set with environment variables.',
  },
  {
    key: 'security',
    title: 'Security',
    path: '/admin/settings/security',
    icon: Settings,
    permission: 'settings.manage',
    description: 'Two-factor rules and how long sessions last.',
  },
  {
    key: 'audit-log',
    title: 'Audit Log',
    path: '/admin/settings/audit-log',
    icon: Activity,
    permission: 'audit.read',
    description: 'Every change: who, what, when, from where, with before and after values.',
  },
  {
    key: 'system',
    title: 'System',
    path: '/admin/settings/system',
    icon: Settings,
    permission: 'system.read',
    description: 'Version, updates, database migrations, backups and background jobs.',
  },
];
