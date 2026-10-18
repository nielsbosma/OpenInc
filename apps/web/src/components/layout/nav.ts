import type { Permission } from '@openinc/shared';
import {
  Activity,
  BarChart3,
  BookUser,
  Building2,
  FileSignature,
  FileText,
  FolderLock,
  Handshake,
  KanbanSquare,
  LayoutDashboard,
  type LucideIcon,
  Presentation,
  Settings,
  User,
  Users,
} from 'lucide-react';

/** Labels are AP-style Title Case (see CLAUDE.md); nav-titles.test.ts checks them. */
export interface NavItem {
  title: string;
  path: string;
  icon: LucideIcon;
  permission?: Permission;
  description?: string;
  /** Sub-pages, shown as an indented, collapsible group under the item. */
  children?: NavItem[];
}

/** The company modules. Those not in BUILT_MODULES are placeholders until their own spec is built. */
export const MODULES: NavItem[] = [
  {
    title: 'Share Register',
    path: '/registry',
    icon: BookUser,
    permission: 'registry.read',
    description: 'Who owns which shares at any date, every transaction behind it, and the exports.',
  },
  {
    title: 'Documents',
    path: '/documents',
    icon: FileText,
    permission: 'files.read',
    description: 'Company documents in folders, stored in your bucket, with a suggested structure to start from.',
    children: [
      {
        title: 'Dataroom',
        path: '/documents/dataroom',
        icon: FolderLock,
        description: 'Share documents with investors and see who viewed what.',
      },
      {
        title: 'Signing',
        path: '/documents/signing',
        icon: FileSignature,
        permission: 'signing.read',
        description: 'Send documents for signature and track who has signed.',
      },
    ],
  },
  { title: 'Cap Table', path: '/cap-table', icon: BarChart3, description: 'Share classes, options and fully diluted ownership.' },
  {
    title: 'Fundraising',
    path: '/fundraising',
    icon: Handshake,
    description: 'Investor CRM and tracked document links.',
    children: [
      {
        title: 'Investors',
        path: '/fundraising/investors',
        icon: Users,
        description: 'Everyone you raise from, with contacts and history.',
      },
      { title: 'Pipeline', path: '/fundraising/pipeline', icon: KanbanSquare, description: 'Where each investor conversation stands.' },
      {
        title: 'Decks',
        path: '/fundraising/decks',
        icon: Presentation,
        description: 'Pitch decks shared through tracked links, and who viewed them.',
      },
    ],
  },
];

export const BUILT_MODULES = new Set(['/registry', '/documents', '/documents/signing']);

export const MAIN_NAV: NavItem[] = [{ title: 'Dashboard', path: '/', icon: LayoutDashboard }, ...MODULES];

/** Everyone has Settings: their own Account first, then the sections their role may see. */
export const SETTINGS_NAV: NavItem = { title: 'Settings', path: '/settings', icon: Settings };

/** Settings sections, in the order of its left nav. Account is personal; the rest are the company's. */
export const SETTINGS_SECTIONS: (NavItem & { key: string })[] = [
  {
    key: 'account',
    title: 'Account',
    path: '/settings/account',
    icon: User,
    description: 'Your profile, appearance, password, two-factor and MCP clients.',
  },
  {
    key: 'company',
    title: 'Company',
    path: '/settings/company',
    icon: Building2,
    permission: 'settings.manage',
    description: 'Name, country, legal form, IDs, address, currency, time zone and logo.',
  },
  {
    key: 'users',
    title: 'Users',
    path: '/settings/users',
    icon: Users,
    permission: 'users.read',
    description: 'Everyone with an account, pending invitations and roles.',
  },
  {
    key: 'email',
    title: 'Email',
    path: '/settings/email',
    icon: Settings,
    permission: 'settings.manage',
    description: 'The SMTP server for invitations, password resets and notifications.',
  },
  {
    key: 'ai',
    title: 'AI',
    path: '/settings/ai',
    icon: Settings,
    permission: 'settings.manage',
    description: 'The provider behind the assistant.',
  },
  {
    key: 'errors',
    title: 'Error Tracking',
    path: '/settings/errors',
    icon: Settings,
    permission: 'settings.manage',
    description: 'Send server and browser errors to Bugsink or Sentry.',
  },
  {
    key: 'storage',
    title: 'Storage',
    path: '/settings/storage',
    icon: Settings,
    permission: 'settings.manage',
    description: 'The S3 bucket for files and database backups. Set with environment variables.',
  },
  {
    key: 'security',
    title: 'Security',
    path: '/settings/security',
    icon: Settings,
    permission: 'settings.manage',
    description: 'Two-factor rules and how long sessions last.',
  },
  {
    key: 'audit-log',
    title: 'Audit Log',
    path: '/settings/audit-log',
    icon: Activity,
    permission: 'audit.read',
    description: 'Every change: who, what, when, from where, with before and after values.',
  },
  {
    key: 'system',
    title: 'System',
    path: '/settings/system',
    icon: Settings,
    permission: 'system.read',
    description: 'Version, updates, database migrations, backups and background jobs.',
  },
];

/** Every module page, sub-pages included, for routes and the command palette. */
export const MODULE_PAGES: NavItem[] = MODULES.flatMap((m) => [m, ...(m.children ?? [])]);
