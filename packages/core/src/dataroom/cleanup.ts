import { dataRoomEvents, dataRoomSessions, lt } from '@openinc/db';
import type { Ctx } from '../context.ts';
import { getSettingsOrDefaults } from '../settings.ts';

/** Nightly: ended visits go, and visitor activity older than the Admin's retention setting. */
export async function cleanupDataroom(ctx: Ctx, now = new Date()) {
  const { dataroomEventRetentionDays } = await getSettingsOrDefaults('system');
  let events = 0;
  if (dataroomEventRetentionDays > 0) {
    const cutoff = new Date(now.getTime() - dataroomEventRetentionDays * 24 * 60 * 60 * 1000);
    events = (await ctx.db.delete(dataRoomEvents).where(lt(dataRoomEvents.at, cutoff)).returning({ id: dataRoomEvents.id })).length;
    await ctx.db.delete(dataRoomSessions).where(lt(dataRoomSessions.createdAt, cutoff));
  }
  // Ended sessions keep their row (events point at it) but lose the IP address and user agent.
  await ctx.db.update(dataRoomSessions).set({ ipAddress: null, userAgent: null }).where(lt(dataRoomSessions.expiresAt, now));
  return { events };
}
