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
  { title: 'Cap table', path: '/cap-table', icon: BarChart3, description: 'Share classes, options and fully diluted ownership.' },
  { title: 'Signing', path: '/signing', icon: FileSignature, description: 'Send documents for signature and track who has signed.' },
  { title: 'Dataroom', path: '/dataroom', icon: FolderLock, description: 'Share documents with investors and see who viewed what.' },
  { title: 'Fundraising', path: '/fundraising', icon: Handshake, description: 'Investor CRM and tracked document links.' },
];

export const MAIN_NAV: NavItem[] = [{ title: 'Dashboard', path: '/', icon: LayoutDashboard }, ...MODULES];

export const ADMIN_NAV: NavItem[] = [
  { title: 'Users', path: '/admin/users', icon: Users, permission: 'users.read' },
  { title: 'Audit log', path: '/admin/audit', icon: Activity, permission: 'audit.read' },
  { title: 'Settings', path: '/admin/settings', icon: Settings, permission: 'settings.manage' },
];
