import { approveAuthorization, denyAuthorization, describeAuthorization } from './oauth.ts';
import type { AnyService } from './service.ts';
import * as account from './services/account.ts';
import * as auditServices from './services/audit.ts';
import * as auth from './services/auth.ts';
import * as captable from './services/captable.ts';
import * as chat from './services/chat.ts';
import * as dataroom from './services/dataroom.ts';
import * as portal from './services/dataroom-portal.ts';
import * as documents from './services/documents.ts';
import * as filesServices from './services/files.ts';
import * as help from './services/help.ts';
import * as notifications from './services/notifications.ts';
import * as registry from './services/registry.ts';
import * as registryImport from './services/registry-import.ts';
import * as settings from './services/settings.ts';
import * as setup from './services/setup.ts';
import * as signing from './services/signing.ts';
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
  documents: {
    list: documents.listDocuments,
    search: documents.searchDocuments,
    folders: documents.listFolders,
    template: documents.documentsTemplate,
    applyTemplate: documents.applyDocumentsTemplate,
    createFolder: documents.createFolder,
    renameFolder: documents.renameFolder,
    deleteFolder: documents.deleteFolder,
    add: documents.addDocument,
    rename: documents.renameDocument,
    move: documents.moveDocument,
    delete: documents.deleteDocument,
    downloadZip: documents.downloadZip,
  },
  signing: {
    list: signing.listEnvelopes,
    get: signing.getEnvelope,
    create: signing.createEnvelope,
    update: signing.updateEnvelope,
    send: signing.sendEnvelope,
    remind: signing.remindEnvelope,
    void: signing.voidEnvelope,
    deleteDraft: signing.deleteDraftEnvelope,
    describe: signing.describeSigning,
    requestCode: signing.requestSigningCode,
    verifyCode: signing.verifySigningCode,
    view: signing.viewSigning,
    sign: signing.signDocument,
    decline: signing.declineSigning,
  },
  dataroom: {
    list: dataroom.listRooms,
    get: dataroom.getRoom,
    templates: dataroom.listRoomTemplates,
    roomsForDocument: dataroom.roomsForDocument,
    create: dataroom.createRoom,
    update: dataroom.updateRoom,
    open: dataroom.openRoom,
    close: dataroom.closeRoom,
    delete: dataroom.deleteRoom,
    createFolder: dataroom.createRoomFolder,
    renameFolder: dataroom.renameRoomFolder,
    deleteFolder: dataroom.deleteRoomFolder,
    addDocuments: dataroom.addRoomDocuments,
    removeItem: dataroom.removeRoomItem,
    moveItem: dataroom.moveRoomItem,
    links: dataroom.listLinks,
    createLink: dataroom.createLink,
    updateLink: dataroom.updateLink,
    revokeLink: dataroom.revokeLink,
    visitors: dataroom.listVisitors,
    visitor: dataroom.getVisitor,
    stats: dataroom.roomStats,
    documentStats: dataroom.roomDocumentStats,
  },
  portal: {
    start: portal.portalStart,
    identify: portal.portalIdentify,
    resendCode: portal.portalResendCode,
    verify: portal.portalVerify,
    unlock: portal.portalUnlock,
    acceptNda: portal.portalAcceptNda,
    room: portal.portalRoom,
    heartbeat: portal.portalHeartbeat,
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
  registry: {
    status: registry.registryStatus,
    legalForms: registry.registryLegalForms,
    setup: registry.setupRegistry,
    getRegister: registry.getRegister,
    searchHolders: registry.searchHolders,
    getHolder: registry.getHolder,
    listTransactions: registry.listTransactions,
    getTransaction: registry.getTransaction,
    validate: registry.validateTransaction,
    draftTransaction: registry.createDraft,
    updateDraft: registry.updateDraft,
    parkTransaction: registry.parkDraft,
    deleteDraft: registry.deleteDraft,
    submitForApproval: registry.submitDraft,
    commit: registry.commitTransaction,
    reverse: registry.reverseTransaction,
    attachDocument: registry.attachDocument,
    detachDocument: registry.detachDocument,
    verifyChain: registry.verifyRegistryChain,
    rebuild: registry.rebuildRegistry,
    history: registry.registryHistory,
    startImport: registryImport.startImport,
    listImports: registryImport.listImports,
    getImport: registryImport.getImport,
    updateImport: registryImport.updateImport,
    createImportDrafts: registryImport.createImportDrafts,
    discardImport: registryImport.discardImport,
  },
  captable: {
    get: captable.getCaptable,
    settings: captable.getCaptableSettings,
    updateSettings: captable.updateCaptableSettings,
    history: captable.ownershipHistory,
    listStakeholders: captable.listStakeholders,
    stakeholder: captable.stakeholderDetail,
    saveStakeholder: captable.saveStakeholder,
    assignGroup: captable.assignGroup,
    saveGroup: captable.saveGroup,
    deleteGroup: captable.deleteGroup,
    listPlans: captable.listPlans,
    savePlan: captable.savePlan,
    changePool: captable.changePool,
    saveSchedule: captable.saveSchedule,
    saveGrant: captable.saveGrant,
    terminateGrant: captable.terminateGrant,
    exerciseGrant: captable.exerciseGrant,
    listUnpriced: captable.listUnpriced,
    saveUnpriced: captable.saveUnpriced,
    cancelUnpriced: captable.cancelUnpriced,
    listValuations: captable.listValuations,
    saveValuation: captable.saveValuation,
    deleteValuation: captable.deleteValuation,
    fairValue: captable.fairValue,
    modelRound: captable.modelRound,
    waterfall: captable.waterfall,
    listScenarios: captable.listScenarios,
    getScenario: captable.getScenario,
    runScenario: captable.runScenarioService,
    saveScenario: captable.saveScenario,
    archiveScenario: captable.archiveScenario,
    rebaseScenario: captable.rebaseScenario,
    compareScenarios: captable.compareScenarios,
    promoteScenario: captable.promoteScenario,
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
