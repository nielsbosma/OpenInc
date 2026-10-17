import {
  deleteExpiredSessions,
  deliverEmail,
  EmailNotConfiguredError,
  getDb,
  getSettingsOrDefaults,
  type JobName,
  type JobPayloads,
  notify,
  runDataMigrations,
  runRegistryChainCheck,
  runRegistryImport,
  systemCtx,
} from '@openinc/core';
import { auditLog, loginChallenges, lt, oauthCodes, passwordResetTokens } from '@openinc/db';

type Handlers = { [N in JobName]: (data: JobPayloads[N]) => Promise<unknown> };

export const handlers: Handlers = {
  async 'email.send'(email) {
    try {
      return await deliverEmail(email);
    } catch (error) {
      // Retrying cannot help until an Admin sets up email, so the message is dropped (and logged) instead.
      if (error instanceof EmailNotConfiguredError) {
        console.warn(`[email] not sent, email is not set up: "${email.subject}" to ${email.to}`);
        return { skipped: true };
      }
      throw error;
    }
  },

  'notifications.fanout': (n) => notify(getDb(), n.userIds, n),

  async 'system.demo'({ userId, seconds }) {
    await new Promise((r) => setTimeout(r, seconds * 1000));
    await notify(getDb(), [userId], {
      type: 'jobs.finished',
      title: 'Test job finished',
      body: `The background worker picked up your job and finished after ${seconds} s.`,
      link: '/admin/settings/system',
    });
    return { ok: true };
  },

  'system.dataMigration': ({ name }) => runDataMigrations(systemCtx('worker'), name),

  async 'maintenance.cleanup'() {
    const db = getDb();
    const now = new Date();
    const sessions = await deleteExpiredSessions(db);
    await db.delete(loginChallenges).where(lt(loginChallenges.expiresAt, now));
    await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, now));
    await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now));
    const { auditRetentionDays } = await getSettingsOrDefaults('system');
    let audit = 0;
    if (auditRetentionDays > 0) {
      const cutoff = new Date(now.getTime() - auditRetentionDays * 24 * 60 * 60 * 1000);
      audit = (await db.delete(auditLog).where(lt(auditLog.occurredAt, cutoff)).returning({ id: auditLog.id })).length;
    }
    return { sessions: sessions.length, audit };
  },

  'registry.verifyChain': () => runRegistryChainCheck(systemCtx('worker')),

  'registry.import': ({ importId }) => runRegistryImport(systemCtx('worker'), importId),
};

export const schedules: { name: JobName; cron: string }[] = [
  { name: 'maintenance.cleanup', cron: '15 3 * * *' },
  { name: 'registry.verifyChain', cron: '45 2 * * *' },
];
