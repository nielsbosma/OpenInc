import type { Permission } from '@openinc/shared';

/**
 * How the web app works, for the assistant's "how do I..." answers. Keep it in step with the UI:
 * a page, button or flow that changes updates its entry in the same commit. Labels are quoted exactly
 * as the UI shows them (AP Title Case). `ui-guide.test.ts` checks that every route and nav item has an entry.
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

const settings = (
  title: string,
  key: string,
  permission: Permission,
  summary: string,
  tasks: GuideEntry['tasks'],
  services?: string[],
): GuideEntry => ({
  title,
  path: `/settings/${key}`,
  where: `Sidebar → **Settings** → **${title}**`,
  permission,
  summary,
  tasks,
  services,
});

export const uiGuide: GuideEntry[] = [
  {
    title: 'App Layout',
    where: 'Every page after signing in',
    summary:
      'Navigation on the left, content in the middle, the assistant in a column on the right. There is no top bar: the sparkle icon floats at the top right of the page.',
    tasks: [
      {
        task: 'Jump to a page or run an action',
        steps: 'Click **Search** at the top of the sidebar, or press **Ctrl+K** (**⌘K** on a Mac). Type, then press **Enter**.',
      },
      {
        task: 'Open the assistant',
        steps:
          'Click the **sparkle icon** (Assistant) at the top right of the page, or choose **Open Assistant** in Ctrl+K. Until an Admin sets up an AI provider it explains how to turn it on.',
      },
      {
        task: 'See notifications',
        steps:
          'Click **Notifications** near the bottom of the sidebar; the badge shows how many are unread. **Mark All Read** clears the count.',
      },
      {
        task: 'Hide or show the sidebar',
        steps:
          'Click the **panel icon** next to the company name (**Close Sidebar**), or press **Ctrl+B** (**⌘B** on a Mac). The panel icon at the top left of the page (**Open Sidebar**) brings it back. **Toggle Sidebar** in Ctrl+K does the same.',
      },
      {
        task: 'Switch between light and dark mode',
        steps:
          'Open **Settings** → **Account** and flip **Dark Mode** under **Appearance**, or choose **Dark Mode**/**Light Mode** in Ctrl+K.',
      },
      {
        task: 'Finish setting up',
        steps:
          'Admins see **Finish Setting Up** near the bottom of the sidebar. Click it to see the remaining steps. The **X** hides it; **Show Setup Checklist** in Ctrl+K brings it back.',
      },
      {
        task: 'Sign out',
        steps: 'Open **Settings** and click **Sign Out** at the bottom of the section list, or choose **Sign Out** in Ctrl+K.',
      },
    ],
    services: ['setup.checklist'],
  },
  {
    title: 'Dashboard',
    path: '/',
    where: 'Sidebar → **Dashboard**',
    summary: 'The welcome page with the company modules.',
    tasks: [],
  },
  {
    title: 'Shareholders',
    path: '/shareholders',
    where: 'Sidebar → **Shareholders**',
    summary: 'Coming soon: the shareholder registry.',
    tasks: [],
  },
  { title: 'Cap Table', path: '/cap-table', where: 'Sidebar → **Cap Table**', summary: 'Coming soon: the cap table.', tasks: [] },
  { title: 'Signing', path: '/signing', where: 'Sidebar → **Signing**', summary: 'Coming soon: document signing.', tasks: [] },
  { title: 'Dataroom', path: '/dataroom', where: 'Sidebar → **Dataroom**', summary: 'Coming soon: the dataroom.', tasks: [] },
  {
    title: 'Fundraising',
    path: '/fundraising',
    where: 'Sidebar → **Fundraising** (click it to show its pages)',
    summary: 'Coming soon: investor CRM and tracked links. It has three pages: Investors, Pipeline and Decks.',
    tasks: [],
  },
  {
    title: 'Investors',
    path: '/fundraising/investors',
    where: 'Sidebar → **Fundraising** → **Investors**',
    summary: 'Coming soon: everyone you raise from, with contacts and history.',
    tasks: [],
  },
  {
    title: 'Pipeline',
    path: '/fundraising/pipeline',
    where: 'Sidebar → **Fundraising** → **Pipeline**',
    summary: 'Coming soon: where each investor conversation stands.',
    tasks: [],
  },
  {
    title: 'Decks',
    path: '/fundraising/decks',
    where: 'Sidebar → **Fundraising** → **Decks**',
    summary: 'Coming soon: pitch decks shared through tracked links, and who viewed them.',
    tasks: [],
  },
  {
    title: 'Account',
    path: '/settings/account',
    where: 'Sidebar → **Settings** → **Account** (the first section, open to everyone)',
    summary:
      'Your name, email, profile image, Dark Mode, password, two-factor authentication and connected MCP clients, as cards on one page.',
    tasks: [
      { task: 'Change my name or profile image', steps: 'In **Profile**, edit **Name** and click **Save**, or click **Upload Image**.' },
      {
        task: 'Change my email',
        steps: 'In **Profile**, under **Email**, fill in **New Email** and **Current Password**, then **Change Email**.',
      },
      {
        task: 'Change my password',
        steps: 'In **Password**, fill in **Current Password** and **New Password**, click **Change Password**.',
      },
      {
        task: 'Turn on two-factor authentication',
        steps:
          'In **Two-Factor Authentication**, click **Set Up Two-Factor**, scan the QR code with an authenticator app, enter the 6-digit code and click **Turn On**. Save the recovery codes.',
      },
      { task: 'Get new recovery codes', steps: 'In **Two-Factor Authentication**, click **New Recovery Codes** and enter your password.' },
      {
        task: 'Connect Claude Desktop or another MCP client',
        steps: 'Scroll to **Connect Claude or Another MCP Client**, click **Copy URL**, and follow the steps shown there.',
      },
      { task: 'Disconnect an MCP client', steps: 'Under **Connected Clients**, click **Disconnect** next to it.' },
    ],
    services: ['account.updateProfile', 'account.listMcpClients', 'account.revokeMcpClient', 'account.mcpConnection'],
  },
  {
    title: 'Settings',
    path: '/settings',
    where: 'Sidebar → **Settings** (bottom of the sidebar)',
    summary:
      'Account for everyone; for Admins also Company, Users, Email, AI, Error Tracking, Storage, Security, Audit Log and System, each a section in the left list, with **Sign Out** at the bottom. Changes apply at once.',
    tasks: [],
  },
  settings(
    'Company',
    'company',
    'settings.manage',
    'Company name, registration number, address, country, currency, time zone and logo.',
    [{ task: 'Change company details or logo', steps: 'Edit the fields, click **Upload Logo** for a logo, then **Save**.' }],
    ['settings.get', 'settings.update'],
  ),
  settings(
    'Users',
    'users',
    'users.read',
    'Everyone with an account, pending invitations and roles (Admin, Member, Read-only).',
    [
      {
        task: 'Invite someone',
        steps: 'Click **Invite**, enter the email, pick a **Role** and click **Send Invitation**.',
        permission: 'users.manage',
      },
      {
        task: 'Resend or cancel an invitation',
        steps: 'Under **Pending Invitations**, click **Resend** or **Revoke**.',
        permission: 'users.manage',
      },
      { task: "Change someone's role", steps: 'Click the row’s **⋯** menu → **Change Role**.', permission: 'users.manage' },
      { task: 'Deactivate someone', steps: 'Click the row’s **⋯** menu → **Deactivate**.', permission: 'users.manage' },
      { task: 'Reset someone’s two-factor', steps: 'Click the row’s **⋯** menu → **Reset Two-Factor**.', permission: 'users.manage' },
    ],
    ['users.list', 'users.update', 'invites.list', 'invites.create', 'invites.resend', 'invites.revoke', 'users.resetTwoFactor'],
  ),
  settings(
    'Email',
    'email',
    'settings.manage',
    'The SMTP server that sends invitations, password resets and notifications.',
    [
      {
        task: 'Set up email',
        steps:
          'Enter **SMTP Host**, **Port**, **Security**, **User Name**, **Password** and **Sender Address**, click **Send Test Email**, then **Save**.',
      },
      { task: 'Stop sending email', steps: 'Click **Remove** and confirm.' },
    ],
    ['settings.testEmail', 'settings.update'],
  ),
  settings(
    'AI',
    'ai',
    'settings.manage',
    'The provider behind the assistant: Anthropic, OpenAI, LiteLLM or any OpenAI-compatible server.',
    [
      {
        task: 'Turn on the AI assistant',
        steps:
          'Pick a **Provider**, enter the **API Key** (for LiteLLM: **Base URL** and **Virtual Key**), pick a **Model** (type a custom id if it is not listed; **Refresh Models** reloads the list), click **Test Connection**, then **Save**.',
      },
      { task: 'Turn off the assistant', steps: 'Click **Turn Off** and confirm.' },
    ],
    ['settings.listAiModels', 'settings.testAi', 'settings.update'],
  ),
  settings('Error Tracking', 'errors', 'settings.manage', 'Send server and browser errors to Bugsink or Sentry.', [
    { task: 'Set up error tracking', steps: 'Paste a Sentry or Bugsink **DSN** and click **Save**.' },
  ]),
  settings(
    'Storage',
    'storage',
    'settings.manage',
    'The S3 bucket for files and backups, set with environment variables.',
    [{ task: 'Check the storage bucket', steps: 'Click **Test Storage**.' }],
    ['settings.storage', 'settings.testStorage'],
  ),
  settings('Security', 'security', 'settings.manage', 'Two-factor rules and session length.', [
    { task: 'Require two-factor for everyone', steps: 'Turn on **Require Two-Factor Authentication** and click **Save**.' },
  ]),
  settings(
    'Audit Log',
    'audit-log',
    'audit.read',
    'Every change: who, what, when, from where, with before and after values.',
    [
      {
        task: 'Find a change',
        steps: 'Type in **Search**, or filter with **All Actions** and **All Surfaces**. Click a row to see before and after.',
      },
    ],
    ['audit.list'],
  ),
  settings(
    'System',
    'system',
    'system.read',
    'Version and updates, background jobs, database migrations and backups.',
    [
      {
        task: 'See the version and whether an update exists',
        steps: 'Look at **Version**: the badge says **Up to Date**, **Update Available** or **Check Failed** (with **Retry**).',
      },
      { task: 'Download a database backup', steps: 'Under **Backups**, click the download icon next to it.' },
      { task: 'Check that background jobs run', steps: 'Click **Run a Test Job**. A notification arrives a few seconds later.' },
    ],
    ['system.info', 'jobs.runDemo'],
  ),
];
