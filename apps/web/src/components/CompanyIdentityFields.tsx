import { legalFormsFor, rulePackFor } from '@openinc/shared';
import { Combobox } from '@/components/Combobox';
import { Field } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { countryOptions } from '@/lib/locale-options';

export interface CompanyIdentity {
  country: string;
  legalForm: string;
  registrationNumber: string;
  euid: string;
  lei: string;
}

export const IDENTITY_FIELDS = ['country', 'legalForm', 'registrationNumber', 'euid', 'lei'] as const;

/** A legal form the country does not have (or none yet) shows, and saves, as the country's first. */
export function effectiveLegalForm(country: string, legalForm: string) {
  const forms = legalFormsFor(country);
  return forms.some((f) => f.code === legalForm) ? legalForm : (forms[0]?.code ?? '');
}

/**
 * Country, legal form, registration number, EUID and LEI: Settings → Company, the setup wizard and the share register
 * all edit these with this one component, and save them with settings.update (group company).
 */
export function CompanyIdentityFields({
  values,
  onChange,
  errors = {},
  locked = [],
  idPrefix = 'company',
}: {
  values: CompanyIdentity;
  onChange: (patch: Partial<CompanyIdentity>) => void;
  errors?: Record<string, string | undefined>;
  locked?: readonly string[];
  idPrefix?: string;
}) {
  const forms = legalFormsFor(values.country);
  const legalForm = effectiveLegalForm(values.country, values.legalForm);
  const pack = rulePackFor(values.country, legalForm);
  const id = (field: string) => `${idPrefix}-${field}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Country" htmlFor={id('country')} error={errors.country}>
        <Combobox
          id={id('country')}
          value={values.country}
          onChange={(country) => onChange({ country, legalForm: legalFormsFor(country)[0]?.code ?? '' })}
          options={countryOptions()}
          invalid={!!errors.country}
          disabled={locked.includes('country')}
        />
      </Field>
      <Field label="Legal Form" htmlFor={id('legal-form')} error={errors.legalForm}>
        <Select value={legalForm} onValueChange={(v) => onChange({ legalForm: v })} disabled={locked.includes('legalForm')}>
          <SelectTrigger id={id('legal-form')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {forms.map((f) => (
              <SelectItem key={f.code} value={f.code}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Alert className="sm:col-span-2">
        <AlertDescription>
          <span className="font-medium text-foreground">{pack.label}.</span> {pack.summary}
        </AlertDescription>
      </Alert>
      <Field
        label="Registration Number"
        htmlFor={id('registration-number')}
        error={errors.registrationNumber}
        hint={pack.id === 'se-abl' ? 'Organisationsnummer' : 'Organisation or company number'}
      >
        <Input
          id={id('registration-number')}
          className="font-mono"
          value={values.registrationNumber}
          onChange={(e) => onChange({ registrationNumber: e.target.value })}
          disabled={locked.includes('registrationNumber')}
        />
      </Field>
      <Field label="EUID" htmlFor={id('euid')} error={errors.euid} hint="European unique identifier, if you have one">
        <Input
          id={id('euid')}
          className="font-mono"
          value={values.euid}
          onChange={(e) => onChange({ euid: e.target.value })}
          disabled={locked.includes('euid')}
        />
      </Field>
      <Field label="LEI" htmlFor={id('lei')} error={errors.lei} hint="Legal Entity Identifier, if you have one">
        <Input
          id={id('lei')}
          className="font-mono"
          value={values.lei}
          onChange={(e) => onChange({ lei: e.target.value })}
          disabled={locked.includes('lei')}
        />
      </Field>
    </div>
  );
}

/** The same details, read-only, for people who may manage the register but not Settings → Company. */
export function CompanyIdentitySummary({ values }: { values: CompanyIdentity }) {
  const legalForm = effectiveLegalForm(values.country, values.legalForm);
  const pack = rulePackFor(values.country, legalForm);
  const rows: [string, string][] = [
    ['Country', countryOptions().find((o) => o.value === values.country)?.label ?? values.country],
    ['Legal Form', legalFormsFor(values.country).find((f) => f.code === legalForm)?.label ?? legalForm],
    ['Registration Number', values.registrationNumber || '—'],
    ['EUID', values.euid || '—'],
    ['LEI', values.lei || '—'],
  ];
  return (
    <div className="grid gap-3">
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border p-3 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="truncate font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <Alert>
        <AlertDescription>
          <span className="font-medium text-foreground">{pack.label}.</span> {pack.summary} An Admin changes these in Settings → Company.
        </AlertDescription>
      </Alert>
    </div>
  );
}
