import type { SettingsValues } from '@openinc/shared';
import nodemailer, { type Transporter } from 'nodemailer';
import { getSettings } from '../settings.ts';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email is not set up. An Admin can add SMTP details under Admin settings → Email.');
    this.name = 'EmailNotConfiguredError';
  }
}

type EmailSettings = SettingsValues<'email'>;

let transport: { key: string; transporter: Transporter } | undefined;

function transporterFor(settings: EmailSettings): Transporter {
  const key = JSON.stringify(settings);
  if (transport?.key !== key) {
    transport?.transporter.close();
    transport = {
      key,
      transporter: nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.security === 'tls',
        requireTLS: settings.security === 'starttls',
        ignoreTLS: settings.security === 'none',
        auth: settings.username ? { user: settings.username, pass: settings.password } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return transport.transporter;
}

async function fromLine(settings: EmailSettings): Promise<string> {
  const name = settings.fromName || (await getSettings('company'))?.name || 'OpenInc';
  return `"${name.replace(/"/g, "'")}" <${settings.fromAddress}>`;
}

/** Sends right away. Services should use `queueEmail` so the worker retries when SMTP is down. */
export async function deliverEmail(email: Email, override?: EmailSettings): Promise<{ messageId: string }> {
  const settings = override ?? (await getSettings('email'));
  if (!settings) throw new EmailNotConfiguredError();
  const info = await transporterFor(settings).sendMail({ from: await fromLine(settings), ...email });
  return { messageId: info.messageId };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A plain, readable transactional email: a greeting, paragraphs and at most one button. */
export function renderEmail(input: {
  to: string;
  subject: string;
  greeting?: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footer?: string;
}): Email {
  const text = [input.greeting, ...input.paragraphs, input.action ? `${input.action.label}: ${input.action.url}` : undefined, input.footer]
    .filter(Boolean)
    .join('\n\n');
  const p = (s: string) => `<p style="margin:0 0 16px;line-height:1.55">${escapeHtml(s)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b;font-size:15px">
<div style="max-width:520px;margin:32px auto;background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:32px">
${input.greeting ? p(input.greeting) : ''}${input.paragraphs.map(p).join('')}
${input.action ? `<p style="margin:24px 0"><a href="${escapeHtml(input.action.url)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:500">${escapeHtml(input.action.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#71717a;word-break:break-all">${escapeHtml(input.action.url)}</p>` : ''}
${input.footer ? `<p style="margin:24px 0 0;font-size:13px;color:#71717a">${escapeHtml(input.footer)}</p>` : ''}
</div></body></html>`;
  return { to: input.to, subject: input.subject, text, html };
}
