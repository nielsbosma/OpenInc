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
  path: `/admin/settings/${key}`,
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
    summary: 'Navigation on the left, content in the middle, the assistant in a column on the right.',
    tasks: [
      {
        task: 'Jump to a page or run an action',
        steps: 'Click **Search** at the top of the sidebar, or press **Ctrl+K** (**⌘K** on a Mac). Type, then press **Enter**.',
      },
      {
        task: 'Open the assistant',
        steps:
          'Click the **sparkle icon** (Assistant) in the top bar, or choose **Open Assistant** in Ctrl+K. Until an Admin sets up an AI provider it explains how to turn it on.',
      },
      { task: 'See notifications', steps: 'Click the **bell** in the top bar. **Mark All Read** clears the count.' },
      {
        task: 'Switch between light and dark mode',
        steps: 'Open the **user menu** (your avatar, top right) and flip **Dark Mode**, or choose **Dark Mode**/**Light Mode** in Ctrl+K.',
      },
      {
        task: 'Finish setting up',
        steps:
          'Admins see **Finish Setting Up** near the bottom of the sidebar. Click it to see the remaining steps. The **X** hides it; **Show Setup Checklist** in Ctrl+K brings it back.',
      },
      { task: 'Sign out', steps: 'Open the **user menu** and click **Sign Out**.' },
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
    title: 'Share Register',
    path: '/registry',
    where: 'Sidebar → **Share Register**',
    permission: 'registry.read',
    summary:
      'The share register (aktiebok): holders, classes, share numbers, votes and capital percentages as of any date, every transaction behind it, and exports. Tabs: **Register**, **Transactions**, **Classes**, **Import**, **Settings**. Every change is a transaction: prepared as a draft, checked against the whole history, then committed by the board, after which it never changes (mistakes are fixed with **Reverse**).',
    tasks: [
      {
        task: 'Set up the share register',
        steps:
          'Open **Share Register**, pick the **Country** and **Legal Form** (they choose the rule pack), fill in the **Registration Number** and click **Set Up the Register**.',
        permission: 'registry.manage',
      },
      {
        task: 'Start the register',
        steps:
          'Click **Start the Register** and choose **Incorporation (a New Company)** or **Opening Balance (an Existing Register)**. Fill in the share capital, the classes and who holds what, then **Commit to the Register** on **Review**.',
        permission: 'registry.draft',
      },
      {
        task: 'See the register on an earlier date',
        steps: 'On **Register**, change **As of Date**.',
      },
      {
        task: 'Record a sale, gift or inheritance',
        steps:
          'Click **New Transaction** → **Transfer**. Pick **Kind of Transfer**, **From** and **To** (or **Add New Holder**), the shares, any **Restrictions** steps and the price, then check **Review** and click **Commit to the Register** (or **Submit for Approval**). For an inheritance, transfer to the estate first, then use **Division of Property** from the estate.',
        permission: 'registry.draft',
      },
      {
        task: 'Record a new issue',
        steps:
          'Click **New Transaction** → **New Issue** and go through **Decision**, **Subscription**, **Payment** and **Registration**. Without a registration date a Swedish AB gets interim shares; when Bolagsverket registers it, open the issue and click **Enter Registration**.',
        permission: 'registry.draft',
      },
      {
        task: 'Wait for a decision or registration',
        steps:
          'On **Review**, click **Park as Awaiting Decision** or **Park as Awaiting Registration**. Find it later on **Transactions**.',
        permission: 'registry.draft',
      },
      {
        task: 'Attach evidence',
        steps:
          'In the wizard click **Save Draft**, then on **Documents** pick the kind and click **Attach Document**. Committed transactions can get documents on their own page.',
        permission: 'registry.draft',
      },
      {
        task: 'Approve a transaction',
        steps:
          'Open it from **Transactions** and click **Approve and Commit**. With four-eyes approval on, someone other than the person who prepared it must do this.',
        permission: 'registry.commit',
      },
      {
        task: 'Correct a committed transaction',
        steps:
          'Open it and click **Reverse**, give a reason, then enter the right transaction. If a later transaction depends on it, the reversal is refused and the conflict is named.',
        permission: 'registry.commit',
      },
      {
        task: 'Add a share class or change its rights',
        steps:
          'On **Classes**, click **Change Class Terms** (or **New Transaction** → **Class Terms Change**). Click **Change Class** for an existing class or **Add Share Class** for a new one, and set votes, **Seniority**, **Liquidation Preference (x)**, **Participation**, **Cap (x)**, **Anti-dilution** and the transfer restrictions. In a Swedish AB it needs a registration date from Bolagsverket.',
        permission: 'registry.draft',
      },
      {
        task: 'Import an existing register from a spreadsheet or PDF',
        steps:
          'Open **Import**, click **Upload a File** and pick an XLSX, XLS, CSV or PDF. When it is **Ready for Review**, click each row to see its cell or line in the file on the right, correct anything, click **Check Again**, then **Create Drafts**. Nothing is entered until the drafts are committed (or **Commit All in Order**).',
        permission: 'registry.draft',
      },
      {
        task: 'Download the register',
        steps:
          'On **Register**, click **Export**: **PDF in English**, **PDF in Swedish (Aktiebok)**, **Excel (XLSX)**, **CSV**, the full history, or **Everything as JSON**. Each holder page has **Extract**; a sale has **Settlement Note**.',
      },
    ],
    services: [
      'registry.status',
      'registry.getRegister',
      'registry.getHolder',
      'registry.listTransactions',
      'registry.getTransaction',
      'registry.validate',
      'registry.draftTransaction',
      'registry.commit',
      'registry.reverse',
    ],
  },
  { title: 'Cap Table', path: '/cap-table', where: 'Sidebar → **Cap Table**', summary: 'Coming soon: the cap table.', tasks: [] },
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
      { task: 'Change my name or profile image', steps: 'On **Profile**, edit **Name** and click **Save**, or click **Upload Image**.' },
      {
        task: 'Change my email',
        steps: 'On **Profile**, under **Email**, fill in **New Email** and **Current Password**, then **Change Email**.',
      },
      {
        task: 'Change my password',
        steps: 'Open **Security**, fill in **Current Password** and **New Password**, click **Change Password**.',
      },
      {
        task: 'Turn on two-factor authentication',
        steps:
          'Open **Security**, click **Set Up Two-Factor**, scan the QR code with an authenticator app, enter the 6-digit code and click **Turn On**. Save the recovery codes.',
      },
      { task: 'Get new recovery codes', steps: 'Open **Security**, click **New Recovery Codes** and enter your password.' },
      {
        task: 'Connect Claude Desktop or another MCP client',
        steps: 'Open **MCP**, click **Copy URL**, and follow the steps shown there.',
      },
      { task: 'Disconnect an MCP client', steps: 'Open **MCP** and click **Disconnect** next to it.' },
    ],
    services: ['account.updateProfile', 'account.listMcpClients', 'account.revokeMcpClient', 'account.mcpConnection'],
  },
  {
    title: 'Admin Settings',
    path: '/admin/settings',
    where: 'Sidebar → **Settings** (bottom of the sidebar)',
    summary:
      'Company, Users, Email, AI, Error Tracking, Storage, Security, Audit Log and System, each a section in the left list. Changes apply at once.',
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
    'Everyone with an account, pending invitations and roles (Admin, Board / CEO, Member, Auditor, Read-only).',
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
