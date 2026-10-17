import { and, desc, eq, files, isNull, ne, oauthClients, oauthGrants, recoveryCodes, sql, users } from '@openinc/db';
import {
  changeEmailInput,
  changePasswordInput,
  disableTotpInput,
  empty,
  enableTotpInput,
  regenerateRecoveryCodesInput,
  revokeMcpClientInput,
  setAvatarInput,
  updateProfileInput,
} from '@openinc/shared';
import { audit } from '../audit.ts';
import { revokeUserSessions } from '../auth/sessions.ts';
import type { Ctx } from '../context.ts';
import { appUrl } from '../env.ts';
import { badRequest, conflict, notFound, unauthorized } from '../errors.ts';
import { queueEmail } from '../jobs.ts';
import { decrypt, encrypt, sha256 } from '../lib/crypto.ts';
import { renderEmail } from '../lib/email.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { generateRecoveryCodes, generateTotpSecret, totpProvisioning, verifyTotp } from '../lib/totp.ts';
import { defineService } from '../service.ts';
import { getSettingsOrDefaults } from '../settings.ts';
import { productName } from './auth.ts';

async function currentUser(ctx: Ctx) {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, ctx.actor!.userId));
  if (!user) throw notFound('User');
  return user;
}

async function requirePassword(ctx: Ctx, password: string) {
  const user = await currentUser(ctx);
  if (!(await verifyPassword(user.passwordHash, password))) throw unauthorized('Your current password is not right');
  return user;
}

async function securityNotice(user: { email: string; name: string }, what: string) {
  const product = await productName();
  await queueEmail(
    renderEmail({
      to: user.email,
      subject: `${product}: ${what}`,
      greeting: `Hi ${user.name},`,
      paragraphs: [`${what} on your ${product} account.`, 'If this was not you, contact an administrator right away.'],
    }),
  );
}

async function replaceRecoveryCodes(ctx: Ctx, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await ctx.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await ctx.db.insert(recoveryCodes).values(codes.map((code) => ({ userId, codeHash: sha256(code) })));
  return codes;
}

export const updateProfile = defineService({
  name: 'account.updateProfile',
  description: "Change the signed-in user's display name.",
  kind: 'mutation',
  access: 'authenticated',
  input: updateProfileInput,
  async handler(ctx, input) {
    const before = await currentUser(ctx);
    await ctx.db.update(users).set({ name: input.name }).where(eq(users.id, before.id));
    await audit(ctx, {
      action: 'account.update_profile',
      entityType: 'user',
      entityId: before.id,
      before: { name: before.name },
      after: input,
    });
    return { ok: true };
  },
});

export const changePassword = defineService({
  name: 'account.changePassword',
  description: 'Change your own password. Signs out your other sessions.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  input: changePasswordInput,
  async handler(ctx, input) {
    const user = await requirePassword(ctx, input.currentPassword);
    await ctx.db
      .update(users)
      .set({ passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() })
      .where(eq(users.id, user.id));
    await revokeUserSessions(ctx.db, user.id, ctx.sessionId);
    await audit(ctx, { action: 'account.change_password', entityType: 'user', entityId: user.id });
    await securityNotice(user, 'The password was changed');
    return { ok: true };
  },
});

export const changeEmail = defineService({
  name: 'account.changeEmail',
  description: 'Change your own sign-in email.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  input: changeEmailInput,
  async handler(ctx, input) {
    const user = await requirePassword(ctx, input.currentPassword);
    const [taken] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${input.email}`, ne(users.id, user.id)));
    if (taken) throw conflict('Someone already uses that email');
    await ctx.db.update(users).set({ email: input.email }).where(eq(users.id, user.id));
    await audit(ctx, {
      action: 'account.change_email',
      entityType: 'user',
      entityId: user.id,
      before: { email: user.email },
      after: { email: input.email },
    });
    await securityNotice(user, `The sign-in email was changed to ${input.email}`);
    return { ok: true };
  },
});

export const beginTotpSetup = defineService({
  name: 'account.beginTotpSetup',
  description: 'Start setting up two-factor authentication. Returns a QR code to scan with an authenticator app.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  allowWithoutTwoFactor: true,
  input: empty,
  async handler(ctx) {
    const user = await currentUser(ctx);
    if (user.totpSecret) throw badRequest('Two-factor authentication is already on');
    const secret = generateTotpSecret();
    await ctx.db
      .update(users)
      .set({ totpPendingSecret: encrypt(secret) })
      .where(eq(users.id, user.id));
    return { secret, ...(await totpProvisioning(secret, user.email, await productName())) };
  },
});

export const enableTotp = defineService({
  name: 'account.enableTotp',
  description: 'Confirm two-factor setup with the first code from the authenticator app. Returns one-time recovery codes.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  allowWithoutTwoFactor: true,
  input: enableTotpInput,
  async handler(ctx, input) {
    const user = await currentUser(ctx);
    if (!user.totpPendingSecret) throw badRequest('Start the setup first');
    if (!verifyTotp(decrypt(user.totpPendingSecret), input.code))
      throw badRequest('That code is not right. Check that the time on your phone is correct.');
    await ctx.db
      .update(users)
      .set({ totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date() })
      .where(eq(users.id, user.id));
    const codes = await replaceRecoveryCodes(ctx, user.id);
    await audit(ctx, { action: 'account.enable_totp', entityType: 'user', entityId: user.id });
    await securityNotice(user, 'Two-factor authentication was turned on');
    return { recoveryCodes: codes };
  },
});

export const disableTotp = defineService({
  name: 'account.disableTotp',
  description: 'Turn off two-factor authentication.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  input: disableTotpInput,
  async handler(ctx, input) {
    if ((await getSettingsOrDefaults('security')).enforceTwoFactor)
      throw badRequest('Your administrator requires two-factor authentication');
    const user = await requirePassword(ctx, input.currentPassword);
    await ctx.db.update(users).set({ totpSecret: null, totpPendingSecret: null, totpEnabledAt: null }).where(eq(users.id, user.id));
    await ctx.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
    await audit(ctx, { action: 'account.disable_totp', entityType: 'user', entityId: user.id });
    await securityNotice(user, 'Two-factor authentication was turned off');
    return { ok: true };
  },
});

export const regenerateRecoveryCodes = defineService({
  name: 'account.regenerateRecoveryCodes',
  description: 'Replace your two-factor recovery codes with ten new ones. The old ones stop working.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  input: regenerateRecoveryCodesInput,
  async handler(ctx, input) {
    const user = await requirePassword(ctx, input.currentPassword);
    if (!user.totpSecret) throw badRequest('Turn on two-factor authentication first');
    const codes = await replaceRecoveryCodes(ctx, user.id);
    await audit(ctx, { action: 'account.regenerate_recovery_codes', entityType: 'user', entityId: user.id });
    return { recoveryCodes: codes };
  },
});

export const setAvatar = defineService({
  name: 'account.setAvatar',
  description: 'Set or remove your profile image. The file must be an image you uploaded as an avatar.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  input: setAvatarInput,
  async handler(ctx, input) {
    const user = await currentUser(ctx);
    if (input.fileId) {
      const [file] = await ctx.db
        .select()
        .from(files)
        .where(and(eq(files.id, input.fileId), eq(files.kind, 'avatar'), eq(files.uploadedBy, user.id), isNull(files.deletedAt)));
      if (!file) throw notFound('Image');
    }
    await ctx.db.update(users).set({ avatarFileId: input.fileId }).where(eq(users.id, user.id));
    await audit(ctx, {
      action: 'account.set_avatar',
      entityType: 'user',
      entityId: user.id,
      before: { avatarFileId: user.avatarFileId },
      after: input,
    });
    return { ok: true };
  },
});

export const mcpConnection = defineService({
  name: 'account.mcpConnection',
  description: 'The MCP server URL of this install, for connecting Claude Desktop or another MCP client.',
  kind: 'query',
  access: 'authenticated',
  input: empty,
  handler: async () => ({ url: `${appUrl()}/mcp`, name: await productName() }),
});

export const listMcpClients = defineService({
  name: 'account.listMcpClients',
  description: 'List the MCP clients (such as Claude Desktop) connected to your account.',
  kind: 'query',
  access: 'authenticated',
  input: empty,
  async handler(ctx) {
    return ctx.db
      .select({
        clientId: oauthClients.clientId,
        name: oauthClients.name,
        connectedAt: sql<Date>`min(${oauthGrants.createdAt})`.mapWith((v) => new Date(v)),
        lastUsedAt: sql<Date | null>`max(${oauthGrants.lastUsedAt})`.mapWith((v) => (v ? new Date(v) : null)),
      })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthGrants.clientId))
      .where(and(eq(oauthGrants.userId, ctx.actor!.userId), isNull(oauthGrants.revokedAt)))
      .groupBy(oauthClients.clientId, oauthClients.name)
      .orderBy(desc(sql`min(${oauthGrants.createdAt})`));
  },
});

export const revokeMcpClient = defineService({
  name: 'account.revokeMcpClient',
  description: 'Disconnect an MCP client from your account. Its tokens stop working at once.',
  kind: 'mutation',
  access: 'authenticated',
  input: revokeMcpClientInput,
  async handler(ctx, input) {
    const revoked = await ctx.db
      .update(oauthGrants)
      .set({ revokedAt: new Date() })
      .where(and(eq(oauthGrants.userId, ctx.actor!.userId), eq(oauthGrants.clientId, input.clientId), isNull(oauthGrants.revokedAt)))
      .returning({ id: oauthGrants.id });
    await audit(ctx, {
      action: 'account.revoke_mcp_client',
      entityType: 'oauth_client',
      entityId: input.clientId,
      metadata: { grants: revoked.length },
    });
    return { revoked: revoked.length };
  },
});
