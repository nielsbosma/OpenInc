import {
  articleLimitsRequired,
  companySettings,
  formatMoney,
  parseMoney,
  type RegistrySetupInput,
  registrySetupInputFor,
  rulePackFor,
} from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type CompanyIdentity,
  CompanyIdentityFields,
  CompanyIdentitySummary,
  effectiveLegalForm,
} from '@/components/CompanyIdentityFields';
import { Field, validate } from '@/components/common';
import { settingsLayout } from '@/components/settings-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useCan, useClientConfig } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { useRegistryStatus } from './common';

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div>
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Setup on first use, and Share Register → Settings afterwards. */
export function RegistrySettingsForm() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const status = useRegistryStatus();
  const config = useClientConfig();
  const currency = config?.currency ?? 'EUR';
  const current = status.data?.setUp ? status.data.settings : null;
  const money = (v: bigint | null) =>
    v === null
      ? ''
      : formatMoney(v, currency)
          .replace(/[^\d.,\s]/g, '')
          .trim();
  const can = useCan();
  const editCompany = can('settings.manage');
  const companyView = useQuery({ ...trpc.settings.get.queryOptions({ group: 'company' }), enabled: editCompany });
  const fromStatus = status.data?.company;
  const [identity, setIdentity] = useState<CompanyIdentity>(() => ({
    country: fromStatus?.country ?? 'SE',
    legalForm: fromStatus?.legalForm ?? '',
    registrationNumber: fromStatus?.nationalNumber ?? '',
    euid: fromStatus?.euid ?? '',
    lei: fromStatus?.lei ?? '',
  }));
  const [form, setForm] = useState(() => ({
    numbering: current?.numbering ?? true,
    capitalMode: current?.capitalMode ?? ('quota' as 'quota' | 'nominal'),
    minShareCapital: money(current?.minShareCapital ?? null),
    maxShareCapital: money(current?.maxShareCapital ?? null),
    minShares: current?.minShares?.toString() ?? '',
    maxShares: current?.maxShares?.toString() ?? '',
    fourEyes: current?.fourEyes ?? false,
    drafterCanCommit: current?.drafterCanCommit ?? false,
    commitOverMcp: current?.commitOverMcp ?? false,
    tokenizeImportIds: current?.tokenizeImportIds ?? true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const legalForm = effectiveLegalForm(identity.country, identity.legalForm);
  const pack = rulePackFor(identity.country, legalForm);
  const saveCompany = useMutation(trpc.settings.update.mutationOptions());
  const save = useMutation(trpc.registry.setup.mutationOptions());
  const saving = saveCompany.isPending || save.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const minor = (v: string) => {
      if (!v.trim()) return null;
      try {
        return parseMoney(v, currency).toString();
      } catch {
        return 'invalid';
      }
    };
    const values: RegistrySetupInput = {
      ...form,
      minShareCapital: minor(form.minShareCapital),
      maxShareCapital: minor(form.maxShareCapital),
      minShares: form.minShares.trim() || null,
      maxShares: form.maxShares.trim() || null,
    };
    const result = validate(registrySetupInputFor({ country: identity.country, legalForm, currency }), values);
    const company =
      editCompany && companyView.data ? validate(companySettings, { ...companyView.data.values, ...identity, legalForm }) : null;
    if (result.errors || company?.errors) return setErrors({ ...result.errors, ...company?.errors });
    setErrors({});
    void (async () => {
      // Company details first, through the same call as Settings → Company; the register then reads them.
      if (company?.data) await saveCompany.mutateAsync({ group: 'company', values: company.data });
      await save.mutateAsync(result.data!);
      toast.success('Share register settings saved');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.registry.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.settings.pathKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.system.clientConfig.queryKey() }),
      ]);
    })().catch(() => {});
  };

  return (
    <form onSubmit={submit} className={settingsLayout.sectionedForm}>
      <section className="grid gap-4">
        <h3 className="font-medium">Company</h3>
        {editCompany ? (
          <CompanyIdentityFields
            values={identity}
            onChange={(patch) => setIdentity((v) => ({ ...v, ...patch }))}
            errors={errors}
            idPrefix="reg"
          />
        ) : (
          <CompanyIdentitySummary values={identity} />
        )}
      </section>

      <section className={settingsLayout.twoColumns}>
        <Field
          label="Share Capital"
          htmlFor="reg-capital-mode"
          hint="Quota value: capital divided by shares. Nominal: each class has a value per share."
        >
          <Select value={form.capitalMode} onValueChange={(v) => set({ capitalMode: v as 'quota' | 'nominal' })}>
            <SelectTrigger id="reg-capital-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quota">Quota Value (No Par Value)</SelectItem>
              <SelectItem value="nominal">Nominal Value per Share</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </section>

      <section className={settingsLayout.twoColumns}>
        <div className="sm:col-span-2">
          <h3 className="font-medium">Limits in the Articles</h3>
          <p className="text-muted-foreground">
            {articleLimitsRequired({ country: identity.country, legalForm, currency })
              ? 'Required: the articles of a Swedish aktiebolag state the share capital and number of shares as a minimum and maximum, the maximum at most four times the minimum. Use the same value twice for a fixed amount.'
              : 'Optional. Fill them in if your articles set limits; the register then blocks transactions that go outside them.'}
          </p>
        </div>
        <Field label={`Minimum Share Capital (${currency})`} htmlFor="reg-min-cap" error={errors.minShareCapital}>
          <Input
            id="reg-min-cap"
            inputMode="decimal"
            value={form.minShareCapital}
            onChange={(e) => set({ minShareCapital: e.target.value })}
          />
        </Field>
        <Field label={`Maximum Share Capital (${currency})`} htmlFor="reg-max-cap" error={errors.maxShareCapital}>
          <Input
            id="reg-max-cap"
            inputMode="decimal"
            value={form.maxShareCapital}
            onChange={(e) => set({ maxShareCapital: e.target.value })}
          />
        </Field>
        <Field label="Minimum Number of Shares" htmlFor="reg-min-shares" error={errors.minShares}>
          <Input id="reg-min-shares" inputMode="numeric" value={form.minShares} onChange={(e) => set({ minShares: e.target.value })} />
        </Field>
        <Field label="Maximum Number of Shares" htmlFor="reg-max-shares" error={errors.maxShares}>
          <Input id="reg-max-shares" inputMode="numeric" value={form.maxShares} onChange={(e) => set({ maxShares: e.target.value })} />
        </Field>
      </section>

      <section className="grid gap-3">
        <Toggle
          id="reg-numbering"
          label="Number the Shares"
          hint={
            pack.id === 'se-abl'
              ? 'A Swedish aktiebok lists shares by number. Turn off only if you have a reason.'
              : 'Track share numbers, or only counts.'
          }
          checked={form.numbering}
          onChange={(v) => set({ numbering: v })}
        />
        <Toggle
          id="reg-four-eyes"
          label="Four-Eyes Approval"
          hint="A second board member approves every transaction before it is entered."
          checked={form.fourEyes}
          onChange={(v) => set({ fourEyes: v })}
        />
        <Toggle
          id="reg-drafter-commit"
          label="Members Can Commit"
          hint="Members who prepare transactions may also enter them, without the board."
          checked={form.drafterCanCommit}
          onChange={(v) => set({ drafterCanCommit: v })}
        />
        <Toggle
          id="reg-mcp"
          label="Allow Commits From MCP and the Assistant"
          hint="Off by default: AI clients can read, validate and draft, and a person commits in the app."
          checked={form.commitOverMcp}
          onChange={(v) => set({ commitOverMcp: v })}
        />
        <Toggle
          id="reg-tokenize"
          label="Hide ID Numbers From the AI Import"
          hint="Personal ID numbers are replaced with placeholders before a file goes to the AI provider, and put back afterwards."
          checked={form.tokenizeImportIds}
          onChange={(v) => set({ tokenizeImportIds: v })}
        />
      </section>
      {errors._ && <p className="text-sm text-destructive">{errors._}</p>}
      <div>
        <Button type="submit" disabled={saving}>
          {current ? 'Save' : 'Set Up the Register'}
        </Button>
      </div>
    </form>
  );
}
