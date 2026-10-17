import { approveAuthorization, denyAuthorization, describeAuthorization } from './oauth.ts';
import type { AnyService } from './service.ts';
import * as account from './services/account.ts';
import * as auditServices from './services/audit.ts';
import * as auth from './services/auth.ts';
import * as chat from './services/chat.ts';
import * as filesServices from './services/files.ts';
import * as help from './services/help.ts';
import * as notifications from './services/notifications.ts';
import * as settings from './services/settings.ts';
import * as setup from './services/setup.ts';
import * as system from './services/system.ts';
import * as users from './services/users.ts';

/**
 * Every service, grouped the way the tRPC router is. MCP tools and AI chat tools are generated
 * from this list, so a service added here (and to the router) is reachable from every surface.
 */
export const services = {
  setup: {
    status: setup.status,
    verifyCode: setup.verifyCode,
    install: setup.install,
    createFirstAdmin: setup.createFirstAdmin,
    complete: setup.completeOnboarding,
    checklist: setup.checklist,
    dismissChecklist: setup.dismissChecklist,
    showChecklist: setup.showChecklist,
  },
  auth: {
    login: auth.login,
    loginSecondFactor: auth.loginSecondFactor,
    logout: auth.logout,
    me: auth.me,
    requestPasswordReset: auth.requestPasswordReset,
    resetPassword: auth.resetPassword,
  },
  account: {
    updateProfile: account.updateProfile,
    changePassword: account.changePassword,
    changeEmail: account.changeEmail,
    beginTotpSetup: account.beginTotpSetup,
    enableTotp: account.enableTotp,
    disableTotp: account.disableTotp,
    regenerateRecoveryCodes: account.regenerateRecoveryCodes,
    setAvatar: account.setAvatar,
    mcpConnection: account.mcpConnection,
    listMcpClients: account.listMcpClients,
    revokeMcpClient: account.revokeMcpClient,
  },
  users: {
    list: users.listUsers,
    get: users.getUser,
    update: users.updateUser,
    resetTwoFactor: users.resetUserTwoFactor,
    sendPasswordReset: users.sendPasswordReset,
  },
  invites: {
    list: users.listInvites,
    create: users.createInvite,
    resend: users.resendInvite,
    revoke: users.revokeInvite,
    describe: users.describeInvite,
    accept: users.acceptInvite,
  },
  settings: {
    get: settings.getSettingsGroup,
    update: settings.updateSettingsGroup,
    clear: settings.clearSettingsGroup,
    overview: settings.overview,
    testEmail: settings.testEmail,
    testAi: settings.testAi,
    listAiModels: settings.listAiModels,
    storage: settings.storage,
    testStorage: settings.testStorage,
  },
  audit: {
    list: auditServices.listAudit,
    facets: auditServices.auditFacets,
  },
  files: {
    get: filesServices.getFile,
    readText: filesServices.readFileText,
  },
  notifications: {
    list: notifications.listNotifications,
    markRead: notifications.markNotificationRead,
    markAllRead: notifications.markAllNotificationsRead,
  },
  system: {
    clientConfig: system.clientConfig,
    info: system.info,
  },
  jobs: {
    runDemo: system.runDemoJob,
  },
  chat: {
    threads: chat.listChatThreads,
    thread: chat.getChatThread,
    deleteThread: chat.deleteChatThread,
  },
  help: {
    ui: help.helpUi,
  },
  oauth: {
    describe: describeAuthorization,
    approve: approveAuthorization,
    deny: denyAuthorization,
  },
} as const;

export const allServices: AnyService[] = Object.values(services).flatMap((group) => Object.values(group) as AnyService[]);

export function toolName(def: Pick<AnyService, 'name'>): string {
  return def.name.replace(/\./g, '_');
}
