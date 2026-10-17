import { and, auditLog, count, desc, eq, gte, ilike, lte, or, type SQL, users } from '@openinc/db';
import { empty, listAuditInput } from '@openinc/shared';
import { defineService } from '../service.ts';

export const listAudit = defineService({
  name: 'audit.list',
  description:
    'Read the audit log: who did what and when, from which surface (web, mcp, ai, worker, system), with before and after values. Filter by action, entity, actor, surface or time range.',
  kind: 'query',
  access: 'audit.read',
  input: listAuditInput,
  async handler(ctx, input) {
    const filters: SQL[] = [];
    if (input.entityType) filters.push(eq(auditLog.entityType, input.entityType));
    if (input.entityId) filters.push(eq(auditLog.entityId, input.entityId));
    if (input.actorId) filters.push(eq(auditLog.actorId, input.actorId));
    if (input.action) filters.push(eq(auditLog.action, input.action));
    if (input.surface) filters.push(eq(auditLog.surface, input.surface));
    if (input.from) filters.push(gte(auditLog.occurredAt, new Date(input.from)));
    if (input.to) filters.push(lte(auditLog.occurredAt, new Date(input.to)));
    if (input.search) {
      const like = `%${input.search}%`;
      filters.push(
        or(
          ilike(auditLog.action, like),
          ilike(auditLog.entityType, like),
          ilike(auditLog.entityId, like),
          ilike(auditLog.actorLabel, like),
        )!,
      );
    }
    const where = filters.length ? and(...filters) : undefined;
    const [items, [total]] = await Promise.all([
      ctx.db
        .select({
          id: auditLog.id,
          occurredAt: auditLog.occurredAt,
          actorId: auditLog.actorId,
          actorLabel: auditLog.actorLabel,
          actorName: users.name,
          surface: auditLog.surface,
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          before: auditLog.before,
          after: auditLog.after,
          metadata: auditLog.metadata,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorId))
        .where(where)
        .orderBy(desc(auditLog.id))
        .limit(input.limit)
        .offset(input.offset),
      ctx.db.select({ value: count() }).from(auditLog).where(where),
    ]);
    return { items: items.map((i) => ({ ...i, id: i.id.toString() })), total: total?.value ?? 0 };
  },
});

export const auditFacets = defineService({
  name: 'audit.facets',
  description: 'The distinct actions and entity types in the audit log, for filtering.',
  kind: 'query',
  access: 'audit.read',
  input: empty,
  async handler(ctx) {
    const [actions, entityTypes] = await Promise.all([
      ctx.db.selectDistinct({ value: auditLog.action }).from(auditLog).orderBy(auditLog.action),
      ctx.db.selectDistinct({ value: auditLog.entityType }).from(auditLog).orderBy(auditLog.entityType),
    ]);
    return { actions: actions.map((a) => a.value), entityTypes: entityTypes.map((e) => e.value) };
  },
});
