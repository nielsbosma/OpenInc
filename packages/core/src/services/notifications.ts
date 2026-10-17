import { and, count, type DbOrTx, desc, eq, inArray, isNull, notifications, type SQL, users } from '@openinc/db';
import { empty, listNotificationsInput, notificationIdInput } from '@openinc/shared';
import { appUrl } from '../env.ts';
import { queueEmail } from '../jobs.ts';
import { renderEmail } from '../lib/email.ts';
import { defineService } from '../service.ts';
import { getSettings } from '../settings.ts';

export interface NewNotification {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Also send it by email (only when email is set up). */
  email?: boolean;
}

/** Puts a notification in each user's bell, and emails it when asked to. */
export async function notify(db: DbOrTx, userIds: string[], n: NewNotification): Promise<void> {
  if (userIds.length === 0) return;
  await db
    .insert(notifications)
    .values(userIds.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? '', link: n.link })));
  if (!n.email || !(await getSettings('email'))) return;
  const recipients = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(and(inArray(users.id, userIds), eq(users.active, true)));
  for (const r of recipients) {
    await queueEmail(
      renderEmail({
        to: r.email,
        subject: n.title,
        greeting: `Hi ${r.name},`,
        paragraphs: [n.body || n.title],
        action: n.link ? { label: 'Open', url: `${appUrl()}${n.link}` } : undefined,
      }),
    );
  }
}

export const listNotifications = defineService({
  name: 'notifications.list',
  description: "List the signed-in user's notifications, newest first, with the unread count.",
  kind: 'query',
  access: 'authenticated',
  input: listNotificationsInput,
  async handler(ctx, input) {
    const mine = eq(notifications.userId, ctx.actor!.userId);
    const filters: SQL[] = [mine];
    if (input.unreadOnly) filters.push(isNull(notifications.readAt));
    const [items, [unread]] = await Promise.all([
      ctx.db
        .select()
        .from(notifications)
        .where(and(...filters))
        .orderBy(desc(notifications.createdAt))
        .limit(input.limit)
        .offset(input.offset),
      ctx.db
        .select({ value: count() })
        .from(notifications)
        .where(and(mine, isNull(notifications.readAt))),
    ]);
    return { items, unread: unread?.value ?? 0 };
  },
});

export const markNotificationRead = defineService({
  name: 'notifications.markRead',
  description: 'Mark one notification as read.',
  kind: 'mutation',
  access: 'authenticated',
  input: notificationIdInput,
  async handler(ctx, input) {
    await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, input.notificationId), eq(notifications.userId, ctx.actor!.userId), isNull(notifications.readAt)));
    return { ok: true };
  },
});

export const markAllNotificationsRead = defineService({
  name: 'notifications.markAllRead',
  description: "Mark all of the signed-in user's notifications as read.",
  kind: 'mutation',
  access: 'authenticated',
  input: empty,
  async handler(ctx) {
    const rows = await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.actor!.userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { marked: rows.length };
  },
});
