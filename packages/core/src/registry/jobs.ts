import { and, eq, inArray, users } from '@openinc/db';
import { ROLE_INFO, ROLES } from '@openinc/shared';
import type { Ctx } from '../context.ts';
import { notify } from '../services/notifications.ts';
import { readRegistrySettings, recordChainCheck, verifyChain } from './store.ts';

/** The nightly check. A broken chain means someone edited committed rows outside the app: tell everyone who can commit. */
export async function runRegistryChainCheck(ctx: Ctx) {
  if (!(await readRegistrySettings(ctx))) return { skipped: true };
  const check = await verifyChain(ctx);
  await recordChainCheck(ctx, check);
  if (!check.ok) {
    const roles = ROLES.filter(
      (r) => ROLE_INFO[r].permissions.includes('registry.manage') || ROLE_INFO[r].permissions.includes('registry.commit'),
    );
    const recipients = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, roles), eq(users.active, true)));
    await notify(
      ctx.db,
      recipients.map((r) => r.id),
      {
        type: 'registry.chain_broken',
        title: 'The share register failed its integrity check',
        body: check.message,
        link: '/registry/transactions',
        email: true,
      },
    );
  }
  return check;
}
