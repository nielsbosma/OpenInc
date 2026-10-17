import { and, asc, count, desc, eq, gt, ilike, invites, isNull, ne, or, type SQL, sql, users } from '@openinc/db';
import {
  acceptInviteInput,
  createInviteInput,
  empty,
  inviteIdInput,
  inviteTokenInput,
  listUsersInput,
  ROLE_INFO,
  updateUserInput,
  userIdInput,
} from '@openinc/shared';
import { audit } from '../audit.ts';
import { revokeUserSessions } from '../auth/sessions.ts';
import type { Ctx } from '../context.ts';
import { appUrl } from '../env.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { queueEmail } from '../jobs.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { renderEmail } from '../lib/email.ts';
import { hashPassword } from '../lib/password.ts';
import { defineService } from '../service.ts';
import { issuePasswordReset, productName, startSession } from './auth.ts';
import { notify } from './notifications.ts';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  active: users.active,
  twoFactorEnabled: sql<boolean>`${users.totpEnabledAt} is not null`,
  avatarFileId: users.avatarFileId,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

async function getUserRow(ctx: Ctx, userId: string) {
  const [row] = await ctx.db.select(userColumns).from(users).where(eq(users.id, userId));
  if (!row) throw notFound('User');
  return row;
}

async function activeAdminCount(ctx: Ctx, exceptUserId: string) {
  const [row] = await ctx.db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, exceptUserId)));
  return row?.value ?? 0;
}

export const listUsers = defineService({
  name: 'users.list',
  description: 'List people with an account: role, two-factor status and last sign-in. Search by name or email.',
  kind: 'query',
  access: 'users.read',
  input: listUsersInput,
  async handler(ctx, input) {
    const filters: SQL[] = [];
    if (!input.includeInactive) filters.push(eq(users.active, true));
    if (input.search) filters.push(or(ilike(users.name, `%${input.search}%`), ilike(users.email, `%${input.search}%`))!);
    const where = filters.length ? and(...filters) : undefined;
    const [items, [total]] = await Promise.all([
      ctx.db.select(userColumns).from(users).where(where).orderBy(asc(users.name)).limit(input.limit).offset(input.offset),
      ctx.db.select({ value: count() }).from(users).where(where),
    ]);
    return { items, total: total?.value ?? 0 };
  },
});

export const getUser = defineService({
  name: 'users.get',
  description: 'Get one person by user id.',
  kind: 'query',
  access: 'users.read',
  input: userIdInput,
  handler: (ctx, input) => getUserRow(ctx, input.userId),
});

export const updateUser = defineService({
  name: 'users.update',
  description:
    "Change someone's name or role (admin, member, readonly), or deactivate/reactivate them. Deactivating signs them out everywhere.",
  kind: 'mutation',
  access: 'users.manage',
  input: updateUserInput,
  async handler(ctx, input) {
    const before = await getUserRow(ctx, input.userId);
    const losesAdmin = before.role === 'admin' && before.active && ((input.role && input.role !== 'admin') || input.active === false);
    if (losesAdmin && (await activeAdminCount(ctx, before.id)) === 0) throw badRequest('There must always be at least one active Admin');
    if (input.userId === ctx.actor!.userId && input.active === false) throw badRequest('You cannot deactivate yourself');
    const changes = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.active !== undefined && { active: input.active }),
    };
    if (Object.keys(changes).length === 0) return before;
    await ctx.db.update(users).set(changes).where(eq(users.id, input.userId));
    if (input.active === false) await revokeUserSessions(ctx.db, input.userId);
    const after = await getUserRow(ctx, input.userId);
    await audit(ctx, { action: 'users.update', entityType: 'user', entityId: input.userId, before, after });
    if (input.role && input.role !== before.role) {
      await notify(ctx.db, [input.userId], {
        type: 'users.role_changed',
        title: `Your role is now ${ROLE_INFO[input.role].label}`,
        body: `${ctx.actor!.name} changed your role from ${ROLE_INFO[before.role].label} to ${ROLE_INFO[input.role].label}.`,
      });
    }
    return after;
  },
});

export const resetUserTwoFactor = defineService({
  name: 'users.resetTwoFactor',
  description: "Turn off someone's two-factor authentication, e.g. when they lost their phone and their recovery codes.",
  kind: 'mutation',
  access: 'users.manage',
  input: userIdInput,
  async handler(ctx, input) {
    const before = await getUserRow(ctx, input.userId);
    await ctx.db.update(users).set({ totpSecret: null, totpPendingSecret: null, totpEnabledAt: null }).where(eq(users.id, input.userId));
    await audit(ctx, {
      action: 'users.reset_two_factor',
      entityType: 'user',
      entityId: input.userId,
      before: { twoFactorEnabled: before.twoFactorEnabled },
      after: { twoFactorEnabled: false },
    });
    return { ok: true };
  },
});

export const sendPasswordReset = defineService({
  name: 'users.sendPasswordReset',
  description: 'Email someone a link to choose a new password.',
  kind: 'mutation',
  access: 'users.manage',
  input: userIdInput,
  async handler(ctx, input) {
    const user = await getUserRow(ctx, input.userId);
    if (!user.active) throw badRequest('This account is deactivated');
    await issuePasswordReset(ctx, user);
    await audit(ctx, { action: 'users.send_password_reset', entityType: 'user', entityId: user.id });
    return { ok: true };
  },
});

const inviteColumns = {
  id: invites.id,
  email: invites.email,
  name: invites.name,
  role: invites.role,
  invitedBy: users.name,
  expiresAt: invites.expiresAt,
  lastSentAt: invites.lastSentAt,
  createdAt: invites.createdAt,
};

const pending = () => and(isNull(invites.acceptedAt), isNull(invites.revokedAt));

async function sendInviteEmail(ctx: Ctx, invite: { email: string; name: string | null }, token: string) {
  const product = await productName();
  await queueEmail(
    renderEmail({
      to: invite.email,
      subject: `${ctx.actor?.name ?? 'Someone'} invited you to ${product}`,
      greeting: invite.name ? `Hi ${invite.name},` : 'Hi,',
      paragraphs: [
        `${ctx.actor?.name ?? 'An administrator'} invited you to ${product}. Choose a password to get started. The link works for 7 days.`,
      ],
      action: { label: 'Accept the Invitation', url: `${appUrl()}/invite?token=${encodeURIComponent(token)}` },
    }),
  );
}

export const listInvites = defineService({
  name: 'invites.list',
  description: 'List pending invitations: who was invited, with which role, by whom and when they expire.',
  kind: 'query',
  access: 'users.read',
  input: empty,
  async handler(ctx) {
    return ctx.db
      .select(inviteColumns)
      .from(invites)
      .leftJoin(users, eq(users.id, invites.invitedBy))
      .where(pending())
      .orderBy(desc(invites.createdAt));
  },
});

export const createInvite = defineService({
  name: 'invites.create',
  description: 'Invite someone by email with a role (admin, member or readonly). They get an email with a link to choose a password.',
  kind: 'mutation',
  access: 'users.manage',
  input: createInviteInput,
  async handler(ctx, input) {
    const [existing] = await ctx.db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
    if (existing) throw conflict('Someone with that email already has an account');
    await ctx.db
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(sql`lower(${invites.email}) = ${input.email}`, pending()));
    const token = randomToken();
    const [invite] = await ctx.db
      .insert(invites)
      .values({
        email: input.email,
        name: input.name ?? null,
        role: input.role,
        tokenHash: sha256(token),
        invitedBy: ctx.actor!.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();
    await sendInviteEmail(ctx, invite!, token);
    await audit(ctx, {
      action: 'invites.create',
      entityType: 'invite',
      entityId: invite!.id,
      after: { email: invite!.email, role: invite!.role },
    });
    return { id: invite!.id, email: invite!.email, role: invite!.role, expiresAt: invite!.expiresAt };
  },
});

export const resendInvite = defineService({
  name: 'invites.resend',
  description: 'Send a pending invitation again with a fresh link valid for 7 days. The old link stops working.',
  kind: 'mutation',
  access: 'users.manage',
  input: inviteIdInput,
  async handler(ctx, input) {
    const token = randomToken();
    const [invite] = await ctx.db
      .update(invites)
      .set({ tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS), lastSentAt: new Date() })
      .where(and(eq(invites.id, input.inviteId), pending()))
      .returning();
    if (!invite) throw notFound('Pending invitation');
    await sendInviteEmail(ctx, invite, token);
    await audit(ctx, { action: 'invites.resend', entityType: 'invite', entityId: invite.id });
    return { ok: true };
  },
});

export const revokeInvite = defineService({
  name: 'invites.revoke',
  description: 'Cancel a pending invitation. Its link stops working.',
  kind: 'mutation',
  access: 'users.manage',
  input: inviteIdInput,
  async handler(ctx, input) {
    const [invite] = await ctx.db
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.id, input.inviteId), pending()))
      .returning();
    if (!invite) throw notFound('Pending invitation');
    await audit(ctx, {
      action: 'invites.revoke',
      entityType: 'invite',
      entityId: invite.id,
      before: { email: invite.email, role: invite.role },
    });
    return { ok: true };
  },
});

async function findInvite(ctx: Ctx, token: string) {
  const [invite] = await ctx.db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, sha256(token)), pending(), gt(invites.expiresAt, new Date())));
  if (!invite) throw badRequest('This invitation has expired or was cancelled. Ask for a new one.');
  return invite;
}

export const describeInvite = defineService({
  name: 'invites.describe',
  description: 'What an invitation link is for, shown on the accept page.',
  kind: 'query',
  access: 'public',
  input: inviteTokenInput,
  async handler(ctx, input) {
    const invite = await findInvite(ctx, input.token);
    return {
      email: invite.email,
      name: invite.name ?? '',
      role: invite.role,
      roleLabel: ROLE_INFO[invite.role].label,
      product: await productName(),
    };
  },
});

export const acceptInvite = defineService({
  name: 'invites.accept',
  description: 'Create an account from an invitation link and sign in.',
  kind: 'mutation',
  access: 'public',
  input: acceptInviteInput,
  async handler(ctx, input) {
    const invite = await findInvite(ctx, input.token);
    const [taken] = await ctx.db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${invite.email.toLowerCase()}`);
    if (taken) throw conflict('An account with this email already exists. Sign in instead.');
    const [user] = await ctx.db
      .insert(users)
      .values({ email: invite.email, name: input.name, role: invite.role, passwordHash: await hashPassword(input.password) })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    await ctx.db.update(invites).set({ acceptedAt: new Date(), acceptedUserId: user!.id }).where(eq(invites.id, invite.id));
    await audit(
      { ...ctx, actor: null },
      { action: 'invites.accept', entityType: 'user', entityId: user!.id, after: user, metadata: { inviteId: invite.id } },
    );
    if (invite.invitedBy) {
      await notify(ctx.db, [invite.invitedBy], {
        type: 'invites.accepted',
        title: `${user!.name} joined`,
        body: `${user!.email} accepted your invitation.`,
        link: '/admin/users',
      });
    }
    return startSession(ctx, user!.id, 'invite');
  },
});
