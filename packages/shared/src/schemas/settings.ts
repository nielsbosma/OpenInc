import { z } from 'zod';
import { isCountryCode } from '../countries.ts';

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function isCurrency(value: string): boolean {
  if (!/^[A-Z]{3}$/.test(value)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: value });
    return true;
  } catch {
    return false;
  }
}

const text = (max = 200) => z.string().trim().max(max);

export const companySettings = z.object({
  name: text().min(1, 'Enter the company name'),
  registrationNumber: text(60).default(''),
  address: text(500).default(''),
  country: z.string().toUpperCase().refine(isCountryCode, 'Pick a country'),
  currency: z.string().toUpperCase().refine(isCurrency, 'Pick a currency'),
  timeZone: z.string().refine(isTimeZone, 'Pick a time zone'),
  logoFileId: z.uuid().nullable().default(null),
});

export const EMAIL_SECURITY = ['starttls', 'tls', 'none'] as const;

export const emailSettings = z.object({
  host: text().min(1, 'Enter the SMTP host'),
  port: z.coerce.number().int().min(1).max(65535).default(587),
  security: z.enum(EMAIL_SECURITY).default('starttls'),
  username: text().default(''),
  password: z.string().max(500).default(''),
  fromAddress: z.email('Enter a valid sender address'),
  fromName: text().default(''),
});

/** Secrets are optional on input: left out means keep the stored value. */
const emailSettingsInput = emailSettings.extend({ password: z.string().max(500).optional() });

export const AI_PROVIDERS = ['anthropic', 'openai', 'litellm', 'openai-compatible'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_INFO: Record<AiProvider, { label: string; needsBaseUrl: boolean; baseUrlPlaceholder: string; keyLabel: string }> =
  {
    anthropic: { label: 'Anthropic', needsBaseUrl: false, baseUrlPlaceholder: '', keyLabel: 'API Key' },
    openai: { label: 'OpenAI', needsBaseUrl: false, baseUrlPlaceholder: '', keyLabel: 'API Key' },
    litellm: { label: 'LiteLLM', needsBaseUrl: true, baseUrlPlaceholder: 'https://litellm.example.com', keyLabel: 'Virtual Key' },
    'openai-compatible': {
      label: 'OpenAI-Compatible',
      needsBaseUrl: true,
      baseUrlPlaceholder: 'https://host.example.com/v1',
      keyLabel: 'API Key',
    },
  };

/** Shown before a key is entered; with a key, the model list comes from the provider itself. */
export const AI_CURATED_MODELS: Record<AiProvider, string[]> = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  openai: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'],
  litellm: [],
  'openai-compatible': [],
};

export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-5',
  litellm: '',
  'openai-compatible': '',
};

const aiFields = {
  provider: z.enum(AI_PROVIDERS),
  model: text().min(1, 'Enter a model name'),
  apiKey: z.string().max(500).default(''),
  baseUrl: z.union([z.literal(''), z.url('Enter a URL like https://host/v1')]).default(''),
};

const needsBaseUrl = (v: { provider: AiProvider; baseUrl: string }) => !AI_PROVIDER_INFO[v.provider].needsBaseUrl || v.baseUrl !== '';
const baseUrlMessage = { message: 'Enter the base URL', path: ['baseUrl'] };

export const aiSettings = z.object(aiFields).refine(needsBaseUrl, baseUrlMessage);
const aiSettingsInput = z.object({ ...aiFields, apiKey: z.string().max(500).optional() }).refine(needsBaseUrl, baseUrlMessage);

export const errorTrackingSettings = z.object({
  dsn: z.union([z.literal(''), z.url('Enter a DSN like https://key@host/1')]).default(''),
  environment: text(60).default('production'),
});

export const securitySettings = z.object({
  enforceTwoFactor: z.boolean().default(false),
  sessionDays: z.coerce.number().int().min(1).max(90).default(14),
});

export const systemSettings = z.object({
  auditRetentionDays: z.coerce.number().int().min(0).max(36500).default(0).describe('0 keeps the audit log forever'),
  updateCheck: z.boolean().default(true),
});

export const onboardingSettings = z.object({
  completedAt: z.string().nullable().default(null),
});

/** Every settings group: its schema and which of its fields are secrets (encrypted at rest, never sent to the browser). */
export const SETTINGS = {
  company: { schema: companySettings, secrets: [] },
  email: { schema: emailSettings, secrets: ['password'] },
  ai: { schema: aiSettings, secrets: ['apiKey'] },
  errorTracking: { schema: errorTrackingSettings, secrets: [] },
  security: { schema: securitySettings, secrets: [] },
  system: { schema: systemSettings, secrets: [] },
  onboarding: { schema: onboardingSettings, secrets: [] },
} as const;

export type SettingsGroup = keyof typeof SETTINGS;
export const SETTINGS_GROUPS = Object.keys(SETTINGS) as SettingsGroup[];
export type SettingsValues<G extends SettingsGroup> = z.output<(typeof SETTINGS)[G]['schema']>;

/** Groups an Admin edits in the UI. `onboarding` is internal state. */
export const EDITABLE_GROUPS = ['company', 'email', 'ai', 'errorTracking', 'security', 'system'] as const;
export type EditableGroup = (typeof EDITABLE_GROUPS)[number];

/** The env var that pins a setting, e.g. `OPENINC_EMAIL_HOST` or `OPENINC_AI_API_KEY`. */
export function settingEnvName(group: SettingsGroup, field: string): string {
  const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  return `OPENINC_${snake(group)}_${snake(field)}`;
}

export const getSettingsInput = z.object({ group: z.enum(EDITABLE_GROUPS) });

/**
 * Secrets are write-only: leave a secret out (or send undefined) to keep it, send '' to clear it.
 * Other fields replace the stored value.
 */
export const updateSettingsInput = z.discriminatedUnion('group', [
  z.object({ group: z.literal('company'), values: companySettings }),
  z.object({ group: z.literal('email'), values: emailSettingsInput }),
  z.object({ group: z.literal('ai'), values: aiSettingsInput }),
  z.object({ group: z.literal('errorTracking'), values: errorTrackingSettings }),
  z.object({ group: z.literal('security'), values: securitySettings }),
  z.object({ group: z.literal('system'), values: systemSettings }),
]);

export const clearSettingsInput = z.object({ group: z.enum(['email', 'ai', 'errorTracking']) });

export const testEmailInput = z.object({
  to: z.email().optional().describe('Defaults to your own address'),
  settings: emailSettingsInput.optional().describe('Unsaved settings to test; saved ones are used when left out'),
});

export const testAiInput = z.object({
  settings: aiSettingsInput.optional().describe('Unsaved settings to test; saved ones are used when left out'),
});

export const listAiModelsInput = z.object({
  settings: z
    .object({ ...aiFields, model: z.string().max(200).default(''), apiKey: z.string().max(500).optional() })
    .optional()
    .describe('Unsaved provider, key and URL from the form; saved ones are used when left out'),
});
