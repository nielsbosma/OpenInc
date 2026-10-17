import { type LoginResult, services as s } from '@openinc/core';
import { acceptInviteInput, createFirstAdminInput, empty, loginInput, loginSecondFactorInput } from '@openinc/shared';
import { clearSessionCookie, setSessionCookie } from './http-context.ts';
import { call, mutation, procedure, query, router, type TrpcContext } from './trpc.ts';

/** Turns a successful sign-in into the session cookie; the token never reaches the browser's JavaScript. */
function finishLogin(ctx: TrpcContext, result: LoginResult) {
  if (result.status === 'ok') {
    setSessionCookie(ctx.req, ctx.res, result.session.token, result.session.expiresAt);
    return { status: 'ok' as const, mustEnableTwoFactor: result.mustEnableTwoFactor };
  }
  return result;
}

export const appRouter = router({
  setup: router({
    status: query(s.setup.status),
    verifyCode: mutation(s.setup.verifyCode),
    install: mutation(s.setup.install),
    createFirstAdmin: procedure
      .input(createFirstAdminInput)
      .mutation(async ({ ctx, input }) => finishLogin(ctx, await call(s.setup.createFirstAdmin, ctx.app, input))),
    complete: mutation(s.setup.complete),
    checklist: query(s.setup.checklist),
    dismissChecklist: mutation(s.setup.dismissChecklist),
  }),
  auth: router({
    login: procedure.input(loginInput).mutation(async ({ ctx, input }) => finishLogin(ctx, await call(s.auth.login, ctx.app, input))),
    loginSecondFactor: procedure
      .input(loginSecondFactorInput)
      .mutation(async ({ ctx, input }) => finishLogin(ctx, await call(s.auth.loginSecondFactor, ctx.app, input))),
    logout: procedure.input(empty).mutation(async ({ ctx, input }) => {
      const result = ctx.app.actor ? await call(s.auth.logout, ctx.app, input) : { ok: true };
      clearSessionCookie(ctx.res);
      return result;
    }),
    session: procedure.query(async ({ ctx }) => (ctx.app.actor ? call(s.auth.me, ctx.app, {}) : null)),
    requestPasswordReset: mutation(s.auth.requestPasswordReset),
    resetPassword: mutation(s.auth.resetPassword),
  }),
  account: router({
    updateProfile: mutation(s.account.updateProfile),
    changePassword: mutation(s.account.changePassword),
    changeEmail: mutation(s.account.changeEmail),
    beginTotpSetup: mutation(s.account.beginTotpSetup),
    enableTotp: mutation(s.account.enableTotp),
    disableTotp: mutation(s.account.disableTotp),
    regenerateRecoveryCodes: mutation(s.account.regenerateRecoveryCodes),
    setAvatar: mutation(s.account.setAvatar),
    mcpConnection: query(s.account.mcpConnection),
    listMcpClients: query(s.account.listMcpClients),
    revokeMcpClient: mutation(s.account.revokeMcpClient),
  }),
  users: router({
    list: query(s.users.list),
    get: query(s.users.get),
    update: mutation(s.users.update),
    resetTwoFactor: mutation(s.users.resetTwoFactor),
    sendPasswordReset: mutation(s.users.sendPasswordReset),
  }),
  invites: router({
    list: query(s.invites.list),
    create: mutation(s.invites.create),
    resend: mutation(s.invites.resend),
    revoke: mutation(s.invites.revoke),
    describe: query(s.invites.describe),
    accept: procedure
      .input(acceptInviteInput)
      .mutation(async ({ ctx, input }) => finishLogin(ctx, await call(s.invites.accept, ctx.app, input))),
  }),
  settings: router({
    get: query(s.settings.get),
    update: mutation(s.settings.update),
    clear: mutation(s.settings.clear),
    overview: query(s.settings.overview),
    testEmail: mutation(s.settings.testEmail),
    testAi: mutation(s.settings.testAi),
    storage: query(s.settings.storage),
    testStorage: mutation(s.settings.testStorage),
  }),
  audit: router({
    list: query(s.audit.list),
    facets: query(s.audit.facets),
  }),
  files: router({
    get: query(s.files.get),
    readText: query(s.files.readText),
  }),
  notifications: router({
    list: query(s.notifications.list),
    markRead: mutation(s.notifications.markRead),
    markAllRead: mutation(s.notifications.markAllRead),
  }),
  dashboard: router({
    summary: query(s.dashboard.summary),
  }),
  system: router({
    clientConfig: query(s.system.clientConfig),
    info: query(s.system.info),
  }),
  jobs: router({
    runDemo: mutation(s.jobs.runDemo),
  }),
  chat: router({
    threads: query(s.chat.threads),
    thread: query(s.chat.thread),
    deleteThread: mutation(s.chat.deleteThread),
  }),
  help: router({
    ui: query(s.help.ui),
  }),
  oauth: router({
    describe: query(s.oauth.describe),
    approve: mutation(s.oauth.approve),
    deny: mutation(s.oauth.deny),
  }),
});

export type AppRouter = typeof appRouter;
