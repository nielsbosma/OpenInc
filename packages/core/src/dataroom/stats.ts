/** Rolls visitor events up into the numbers the Activity tab, CSV exports and MCP tools show. Pure, so it is unit tested. */

export interface StatsEvent {
  type: string;
  visitorId: string | null;
  sessionId: string | null;
  linkId: string | null;
  documentId: string | null;
  page: number | null;
  pageCount: number | null;
  durationMs: number | null;
  at: Date;
}

export interface DocumentStats {
  documentId: string;
  uniqueVisitors: number;
  views: number;
  downloads: number;
  totalTimeMs: number;
  avgTimeMs: number;
  pageCount: number | null;
  /** Share of the document's pages that the average viewer reached, 0–1. Null when the page count is unknown. */
  pagesReached: number | null;
  lastViewedAt: Date | null;
}

/** A visitor is the person when they gave an email, else the anonymous session. */
const who = (e: StatsEvent) => e.visitorId ?? (e.sessionId ? `session:${e.sessionId}` : null);

export function overview(events: StatsEvent[]) {
  const visitors = new Set<string>();
  const visits = new Set<string>();
  let views = 0;
  let downloads = 0;
  let totalTimeMs = 0;
  let failedPasswords = 0;
  let lastActivityAt: Date | null = null;
  for (const e of events) {
    if (e.type === 'password_failed') {
      failedPasswords++;
      continue;
    }
    const person = who(e);
    if (person) visitors.add(person);
    if (e.type === 'room_opened' && e.sessionId) visits.add(e.sessionId);
    if (e.type === 'document_opened') views++;
    if (e.type === 'document_downloaded' || e.type === 'room_downloaded') downloads++;
    if (e.type === 'page_viewed') totalTimeMs += e.durationMs ?? 0;
    if (!lastActivityAt || e.at > lastActivityAt) lastActivityAt = e.at;
  }
  return { visitors: visitors.size, visits: visits.size, views, downloads, totalTimeMs, failedPasswords, lastActivityAt };
}

/** Visits and document views per calendar day in the company's time zone, oldest first, with empty days filled in. */
export function daily(events: StatsEvent[], timeZone: string) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const byDay = new Map<string, { visits: number; views: number }>();
  for (const e of events) {
    if (e.type !== 'room_opened' && e.type !== 'document_opened') continue;
    const key = day.format(e.at);
    const row = byDay.get(key) ?? { visits: 0, views: 0 };
    if (e.type === 'room_opened') row.visits++;
    else row.views++;
    byDay.set(key, row);
  }
  const keys = [...byDay.keys()].sort();
  if (!keys.length) return [];
  const out: { date: string; visits: number; views: number }[] = [];
  for (let d = new Date(`${keys[0]}T12:00:00Z`); ; d = new Date(d.getTime() + 86_400_000)) {
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, ...(byDay.get(key) ?? { visits: 0, views: 0 }) });
    if (key >= keys.at(-1)!) break;
  }
  return out;
}

export function perDocument(events: StatsEvent[]): Map<string, DocumentStats> {
  const docs = new Map<
    string,
    {
      viewers: Set<string>;
      views: number;
      downloads: number;
      time: number;
      pageCount: number | null;
      maxPage: Map<string, number>;
      last: Date | null;
    }
  >();
  for (const e of events) {
    if (!e.documentId) continue;
    let d = docs.get(e.documentId);
    if (!d) {
      d = { viewers: new Set(), views: 0, downloads: 0, time: 0, pageCount: null, maxPage: new Map(), last: null };
      docs.set(e.documentId, d);
    }
    const person = who(e);
    if (e.type === 'document_opened') {
      d.views++;
      if (person) d.viewers.add(person);
      if (!d.last || e.at > d.last) d.last = e.at;
    }
    if (e.type === 'document_downloaded') {
      d.downloads++;
      if (person) d.viewers.add(person);
    }
    if (e.type === 'page_viewed') {
      d.time += e.durationMs ?? 0;
      if (e.pageCount) d.pageCount = Math.max(d.pageCount ?? 0, e.pageCount);
      if (person && e.page) d.maxPage.set(person, Math.max(d.maxPage.get(person) ?? 0, e.page));
    }
  }
  const out = new Map<string, DocumentStats>();
  for (const [documentId, d] of docs) {
    const reached = [...d.maxPage.values()];
    out.set(documentId, {
      documentId,
      uniqueVisitors: d.viewers.size,
      views: d.views,
      downloads: d.downloads,
      totalTimeMs: d.time,
      avgTimeMs: d.viewers.size ? Math.round(d.time / d.viewers.size) : 0,
      pageCount: d.pageCount,
      pagesReached: d.pageCount && reached.length ? Math.min(1, reached.reduce((a, b) => a + b, 0) / reached.length / d.pageCount) : null,
      lastViewedAt: d.last,
    });
  }
  return out;
}

/** Time and viewers per page of one document. */
export function perPage(events: StatsEvent[], documentId: string) {
  const pages = new Map<number, { timeMs: number; viewers: Set<string> }>();
  let pageCount = 0;
  for (const e of events) {
    if (e.documentId !== documentId || e.type !== 'page_viewed' || !e.page) continue;
    pageCount = Math.max(pageCount, e.pageCount ?? 0, e.page);
    const p = pages.get(e.page) ?? { timeMs: 0, viewers: new Set<string>() };
    p.timeMs += e.durationMs ?? 0;
    const person = who(e);
    if (person) p.viewers.add(person);
    pages.set(e.page, p);
  }
  return Array.from({ length: pageCount }, (_, i) => {
    const p = pages.get(i + 1);
    return { page: i + 1, timeMs: p?.timeMs ?? 0, viewers: p?.viewers.size ?? 0 };
  });
}

/** Per person: visits, time, documents opened and downloads. Keys are visitor ids, or `session:<id>` for anonymous visits. */
export function perVisitor(events: StatsEvent[]) {
  const out = new Map<
    string,
    {
      visits: number;
      timeSpentMs: number;
      documentsOpened: Set<string>;
      downloads: number;
      linkIds: Set<string>;
      firstAt: Date;
      lastAt: Date;
    }
  >();
  for (const e of events) {
    const person = who(e);
    if (!person || e.type === 'password_failed') continue;
    let v = out.get(person);
    if (!v) {
      v = { visits: 0, timeSpentMs: 0, documentsOpened: new Set(), downloads: 0, linkIds: new Set(), firstAt: e.at, lastAt: e.at };
      out.set(person, v);
    }
    if (e.type === 'room_opened') v.visits++;
    if (e.type === 'document_opened' && e.documentId) v.documentsOpened.add(e.documentId);
    if (e.type === 'document_downloaded' || e.type === 'room_downloaded') v.downloads++;
    if (e.type === 'page_viewed') v.timeSpentMs += e.durationMs ?? 0;
    if (e.linkId) v.linkIds.add(e.linkId);
    if (e.at < v.firstAt) v.firstAt = e.at;
    if (e.at > v.lastAt) v.lastAt = e.at;
  }
  return out;
}
