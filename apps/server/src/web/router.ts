import { type LoginResult, portalCookieName, type ServiceDefinition, services as s } from '@openinc/core';
import { acceptInviteInput, createFirstAdminInput, empty, loginInput, loginSecondFactorInput } from '@openinc/shared';
import type { z } from 'zod';
import { clearSessionCookie, readCookie, setPortalCookie, setSessionCookie } from './http-context.ts';
import { call, mutation, procedure, query, router, type TrpcContext } from './trpc.ts';

/** Turns a successful sign-in into the session cookie; the token never reaches the browser's JavaScript. */
function finishLogin(ctx: TrpcContext, result: LoginResult) {
  if (result.status === 'ok') {
    setSessionCookie(ctx.req, ctx.res, result.session.token, result.session.expiresAt);
    return { status: 'ok' as const, mustEnableTwoFactor: result.mustEnableTwoFactor };
  }
  return result;
}

/**
 * Portal calls carry the visitor cookie of the link they name. A call that starts a visit gets the
 * cookie set here; the session token never reaches the visitor's JavaScript.
 */
function portalResolver<I extends z.ZodType, O>(def: ServiceDefinition<I, O>) {
  return async ({ ctx, input }: { ctx: TrpcContext; input: unknown }) => {
    const name = portalCookieName((input as { token: string }).token);
    const portalSession = readCookie(ctx.req, name);
    const result = await call(def, { ...ctx.app, portalSession }, input as z.output<I>);
    if (result && typeof result === 'object' && 'sessionToken' in result) {
      const { sessionToken, ...rest } = result as { sessionToken?: string };
      if (sessionToken) setPortalCookie(ctx.req, ctx.res, name, sessionToken);
      return rest as Omit<O, 'sessionToken'>;
    }
    return result as Omit<O, 'sessionToken'>;
  };
}
const portalQuery = <I extends z.ZodType, O>(def: ServiceDefinition<I, O>) => procedure.input(def.input).query(portalResolver(def));
const portalMutation = <I extends z.ZodType, O>(def: ServiceDefinition<I, O>) => procedure.input(def.input).mutation(portalResolver(def));

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
    showChecklist: mutation(s.setup.showChecklist),
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
    listAiModels: mutation(s.settings.listAiModels),
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
  documents: router({
    list: query(s.documents.list),
    search: query(s.documents.search),
    folders: query(s.documents.folders),
    template: query(s.documents.template),
    applyTemplate: mutation(s.documents.applyTemplate),
    createFolder: mutation(s.documents.createFolder),
    renameFolder: mutation(s.documents.renameFolder),
    deleteFolder: mutation(s.documents.deleteFolder),
    add: mutation(s.documents.add),
    rename: mutation(s.documents.rename),
    move: mutation(s.documents.move),
    delete: mutation(s.documents.delete),
    downloadZip: mutation(s.documents.downloadZip),
  }),
  signing: router({
    list: query(s.signing.list),
    get: query(s.signing.get),
    create: mutation(s.signing.create),
    update: mutation(s.signing.update),
    send: mutation(s.signing.send),
    remind: mutation(s.signing.remind),
    void: mutation(s.signing.void),
    deleteDraft: mutation(s.signing.deleteDraft),
    describe: query(s.signing.describe),
    requestCode: mutation(s.signing.requestCode),
    verifyCode: mutation(s.signing.verifyCode),
    view: query(s.signing.view),
    sign: mutation(s.signing.sign),
    decline: mutation(s.signing.decline),
  }),
  dataroom: router({
    list: query(s.dataroom.list),
    get: query(s.dataroom.get),
    templates: query(s.dataroom.templates),
    roomsForDocument: query(s.dataroom.roomsForDocument),
    create: mutation(s.dataroom.create),
    update: mutation(s.dataroom.update),
    open: mutation(s.dataroom.open),
    close: mutation(s.dataroom.close),
    delete: mutation(s.dataroom.delete),
    createFolder: mutation(s.dataroom.createFolder),
    renameFolder: mutation(s.dataroom.renameFolder),
    deleteFolder: mutation(s.dataroom.deleteFolder),
    addDocuments: mutation(s.dataroom.addDocuments),
    removeItem: mutation(s.dataroom.removeItem),
    moveItem: mutation(s.dataroom.moveItem),
    links: query(s.dataroom.links),
    createLink: mutation(s.dataroom.createLink),
    updateLink: mutation(s.dataroom.updateLink),
    revokeLink: mutation(s.dataroom.revokeLink),
    visitors: query(s.dataroom.visitors),
    visitor: query(s.dataroom.visitor),
    stats: query(s.dataroom.stats),
    documentStats: query(s.dataroom.documentStats),
  }),
  portal: router({
    start: portalMutation(s.portal.start),
    identify: portalMutation(s.portal.identify),
    resendCode: portalMutation(s.portal.resendCode),
    verify: portalMutation(s.portal.verify),
    unlock: portalMutation(s.portal.unlock),
    acceptNda: portalMutation(s.portal.acceptNda),
    room: portalQuery(s.portal.room),
    heartbeat: portalMutation(s.portal.heartbeat),
  }),
  notifications: router({
    list: query(s.notifications.list),
    markRead: mutation(s.notifications.markRead),
    markAllRead: mutation(s.notifications.markAllRead),
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
  registry: router({
    status: query(s.registry.status),
    legalForms: query(s.registry.legalForms),
    setup: mutation(s.registry.setup),
    getRegister: query(s.registry.getRegister),
    searchHolders: query(s.registry.searchHolders),
    getHolder: query(s.registry.getHolder),
    listTransactions: query(s.registry.listTransactions),
    getTransaction: query(s.registry.getTransaction),
    validate: query(s.registry.validate),
    draftTransaction: mutation(s.registry.draftTransaction),
    updateDraft: mutation(s.registry.updateDraft),
    parkTransaction: mutation(s.registry.parkTransaction),
    deleteDraft: mutation(s.registry.deleteDraft),
    submitForApproval: mutation(s.registry.submitForApproval),
    commit: mutation(s.registry.commit),
    reverse: mutation(s.registry.reverse),
    attachDocument: mutation(s.registry.attachDocument),
    detachDocument: mutation(s.registry.detachDocument),
    verifyChain: mutation(s.registry.verifyChain),
    rebuild: mutation(s.registry.rebuild),
    history: query(s.registry.history),
    startImport: mutation(s.registry.startImport),
    listImports: query(s.registry.listImports),
    getImport: query(s.registry.getImport),
    updateImport: mutation(s.registry.updateImport),
    createImportDrafts: mutation(s.registry.createImportDrafts),
    discardImport: mutation(s.registry.discardImport),
  }),
  captable: router({
    get: query(s.captable.get),
    settings: query(s.captable.settings),
    updateSettings: mutation(s.captable.updateSettings),
    history: query(s.captable.history),
    listStakeholders: query(s.captable.listStakeholders),
    stakeholder: query(s.captable.stakeholder),
    saveStakeholder: mutation(s.captable.saveStakeholder),
    assignGroup: mutation(s.captable.assignGroup),
    saveGroup: mutation(s.captable.saveGroup),
    deleteGroup: mutation(s.captable.deleteGroup),
    listPlans: query(s.captable.listPlans),
    savePlan: mutation(s.captable.savePlan),
    changePool: mutation(s.captable.changePool),
    saveSchedule: mutation(s.captable.saveSchedule),
    saveGrant: mutation(s.captable.saveGrant),
    terminateGrant: mutation(s.captable.terminateGrant),
    exerciseGrant: mutation(s.captable.exerciseGrant),
    listUnpriced: query(s.captable.listUnpriced),
    saveUnpriced: mutation(s.captable.saveUnpriced),
    cancelUnpriced: mutation(s.captable.cancelUnpriced),
    listValuations: query(s.captable.listValuations),
    saveValuation: mutation(s.captable.saveValuation),
    deleteValuation: mutation(s.captable.deleteValuation),
    fairValue: mutation(s.captable.fairValue),
    modelRound: query(s.captable.modelRound),
    waterfall: query(s.captable.waterfall),
    listScenarios: query(s.captable.listScenarios),
    getScenario: query(s.captable.getScenario),
    runScenario: query(s.captable.runScenario),
    saveScenario: mutation(s.captable.saveScenario),
    archiveScenario: mutation(s.captable.archiveScenario),
    rebaseScenario: mutation(s.captable.rebaseScenario),
    compareScenarios: query(s.captable.compareScenarios),
    promoteScenario: mutation(s.captable.promoteScenario),
  }),
  oauth: router({
    describe: query(s.oauth.describe),
    approve: mutation(s.oauth.approve),
    deny: mutation(s.oauth.deny),
  }),
});

export type AppRouter = typeof appRouter;
