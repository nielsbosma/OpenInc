import type { Permission } from '@openinc/shared';

/**
 * How the web app works, for the assistant's "how do I..." answers. Keep it in step with the UI:
 * a page, button or flow that changes updates its entry in the same commit.
 * `ui-guide.test.ts` checks that every route and sidebar item has an entry.
 */
export interface GuideEntry {
  title: string;
  path?: string;
  where: string;
  permission?: Permission;
  summary: string;
  tasks: { task: string; steps: string; permission?: Permission }[];
  services?: string[];
}

export const uiGuide: GuideEntry[] = [
  {
    title: 'App layout',
    where: 'Every page after signing in',
    summary: 'Navigation on the left, content in the middle, the AI assistant on the right.',
    tasks: [
      { task: 'Jump to a page or run an action', steps: 'Press **Ctrl+K** (or **⌘K** on a Mac), type, then press **Enter**.' },
      { task: 'Open the assistant', steps: 'Click **Assistant** in the top bar. It is hidden until an Admin sets up AI.' },
      { task: 'See notifications', steps: 'Click the **bell** in the top bar. **Mark all read** clears the count.' },
      {
        task: 'Switch between light and dark mode',
        steps: 'Open the **user menu** (your avatar, top right) and pick **Light**, **Dark** or **System**.',
      },
      { task: 'Sign out', steps: 'Open the **user menu** and click **Sign out**.' },
    ],
  },
  {
    title: 'Dashboard',
    path: '/',
    where: 'Sidebar → **Dashboard**',
    permission: 'company.read',
    summary: 'Company overview, the setup checklist for Admins, and recent activity.',
    tasks: [
      { task: 'Hide the setup checklist', steps: 'Click **Dismiss** on the **Finish setting up** card.', permission: 'settings.manage' },
    ],
    services: ['dashboard.summary', 'setup.checklist'],
  },
  {
    title: 'Shareholders',
    path: '/shareholders',
    where: 'Sidebar → **Shareholders**',
    summary: 'Coming soon: the shareholder registry.',
    tasks: [],
  },
  { title: 'Cap table', path: '/cap-table', where: 'Sidebar → **Cap table**', summary: 'Coming soon: the cap table.', tasks: [] },
  { title: 'Signing', path: '/signing', where: 'Sidebar → **Signing**', summary: 'Coming soon: document signing.', tasks: [] },
  { title: 'Dataroom', path: '/dataroom', where: 'Sidebar → **Dataroom**', summary: 'Coming soon: the dataroom.', tasks: [] },
  {
    title: 'Fundraising',
    path: '/fundraising',
    where: 'Sidebar → **Fundraising**',
    summary: 'Coming soon: investor CRM and tracked links.',
    tasks: [],
  },
  {
    title: 'Account',
    path: '/account',
    where: 'User menu → **Account**',
    summary: 'Your name, email, password, profile image, two-factor authentication and connected MCP clients.',
    tasks: [
      { task: 'Change my name or profile image', steps: 'On **Profile**, edit **Name** and click **Save**, or click **Upload image**.' },
      {
        task: 'Change my email',
        steps: 'On **Profile**, under **Email**, enter the new address and your current password, then **Change email**.',
      },
      {
        task: 'Change my password',
        steps: 'Open **Security**, fill in **Current password** and **New password**, click **Change password**.',
      },
      {
        task: 'Turn on two-factor authentication',
        steps:
          'Open **Security**, click **Set up two-factor**, scan the QR code with an authenticator app, enter the 6-digit code and click **Turn on**. Save the recovery codes.',
      },
      { task: 'Get new recovery codes', steps: 'Open **Security**, click **New recovery codes** and enter your password.' },
      {
        task: 'Connect Claude Desktop or another MCP client',
        steps: 'Open **MCP**, copy the server URL, and follow the steps shown there.',
      },
      { task: 'Disconnect an MCP client', steps: 'Open **MCP** and click **Disconnect** next to it.' },
    ],
    services: ['account.updateProfile', 'account.listMcpClients', 'account.revokeMcpClient', 'account.mcpConnection'],
  },
  {
    title: 'Users',
    path: '/admin/users',
    where: 'Sidebar → **Admin** → **Users**',
    permission: 'users.read',
    summary: 'Everyone with an account, pending invitations, roles (Admin, Member, Read-only).',
    tasks: [
      {
        task: 'Invite someone',
        steps: 'Click **Invite**, enter the email, pick a **Role** and click **Send invitation**.',
        permission: 'users.manage',
      },
      {
        task: 'Resend or cancel an invitation',
        steps: 'Under **Pending invitations**, click **Resend** or **Revoke**.',
        permission: 'users.manage',
      },
      { task: "Change someone's role", steps: 'Click the row’s **⋯** menu → **Change role**.', permission: 'users.manage' },
      { task: 'Deactivate someone', steps: 'Click the row’s **⋯** menu → **Deactivate**.', permission: 'users.manage' },
      { task: 'Reset someone’s two-factor', steps: 'Click the row’s **⋯** menu → **Reset two-factor**.', permission: 'users.manage' },
    ],
    services: ['users.list', 'users.update', 'invites.list', 'invites.create', 'invites.resend', 'invites.revoke', 'users.resetTwoFactor'],
  },
  {
    title: 'Admin settings',
    path: '/admin/settings',
    where: 'Sidebar → **Admin** → **Settings**',
    permission: 'settings.manage',
    summary: 'Company details, email (SMTP), AI provider, error tracking, storage, security and system settings. Changes apply at once.',
    tasks: [
      { task: 'Change company details or logo', steps: 'Open **Company**, edit and click **Save**.' },
      {
        task: 'Set up email',
        steps: 'Open **Email**, enter the SMTP host, port, security, user, password and sender, click **Send test email**, then **Save**.',
      },
      {
        task: 'Turn on the AI assistant',
        steps: 'Open **AI**, pick a **Provider**, enter the **Model** and **API key**, click **Test connection**, then **Save**.',
      },
      { task: 'Set up error tracking', steps: 'Open **Error tracking**, paste a Sentry or Bugsink **DSN** and click **Save**.' },
      {
        task: 'Require two-factor for everyone',
        steps: 'Open **Security**, turn on **Require two-factor authentication** and click **Save**.',
      },
      { task: 'Check the storage bucket', steps: 'Open **Storage** and click **Test storage**.' },
      { task: 'See the version and whether an update exists', steps: 'Open **System**.' },
    ],
    services: ['settings.get', 'settings.update', 'settings.testEmail', 'settings.testAi', 'settings.storage', 'system.info'],
  },
  {
    title: 'Audit log',
    path: '/admin/audit',
    where: 'Sidebar → **Admin** → **Audit log**',
    permission: 'audit.read',
    summary: 'Every change: who, what, when, from where, with before and after values.',
    tasks: [
      { task: 'Find a change', steps: 'Type in **Search**, or filter by **Action** and **Surface**. Click a row to see before and after.' },
    ],
    services: ['audit.list'],
  },
];
