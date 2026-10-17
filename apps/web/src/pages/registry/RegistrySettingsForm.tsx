import { formatMoney, legalFormsFor, parseMoney, type RegistrySetupInput, registrySetupInput, rulePackFor } from '@openinc/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/Combobox';
import { Field, validate } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { countryOptions } from '@/lib/locale-options';
import { useClientConfig } from '@/lib/session';
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
  const [form, setForm] = useState(() => ({
    country: current?.country ?? 'SE',
    legalForm: current?.legalForm ?? '',
    nationalNumber: current?.nationalNumber ?? '',
    euid: current?.euid ?? '',
    lei: current?.lei ?? '',
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
  const forms = legalFormsFor(form.country);
  const legalForm = forms.some((f) => f.code === form.legalForm) ? form.legalForm : (forms[0]?.code ?? '');
  const pack = rulePackFor(form.country, legalForm);
  const save = useMutation(
    trpc.registry.setup.mutationOptions({
      onSuccess: async () => {
        toast.success('Share register settings saved');
        await queryClient.invalidateQueries({ queryKey: trpc.registry.pathKey() });
      },
    }),
  );

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
      legalForm,
      minShareCapital: minor(form.minShareCapital),
      maxShareCapital: minor(form.maxShareCapital),
      minShares: form.minShares.trim() || null,
      maxShares: form.maxShares.trim() || null,
    };
    const result = validate(registrySetupInput, values);
    if (result.errors) return setErrors(result.errors);
    setErrors({});
    save.mutate(result.data);
  };

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" htmlFor="reg-country" error={errors.country}>
          <Combobox id="reg-country" value={form.country} onChange={(v) => set({ country: v })} options={countryOptions()} />
        </Field>
        <Field label="Legal Form" htmlFor="reg-legal-form" error={errors.legalForm}>
          <Select value={legalForm} onValueChange={(v) => set({ legalForm: v })}>
            <SelectTrigger id="reg-legal-form" className="w-full">
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
          htmlFor="reg-number"
          error={errors.nationalNumber}
          hint={pack.id === 'se-abl' ? 'Organisationsnummer' : undefined}
        >
          <Input
            id="reg-number"
            className="font-mono"
            value={form.nationalNumber}
            onChange={(e) => set({ nationalNumber: e.target.value })}
          />
        </Field>
        <Field label="EUID" htmlFor="reg-euid" error={errors.euid} hint="European unique identifier, if you have one">
          <Input id="reg-euid" className="font-mono" value={form.euid} onChange={(e) => set({ euid: e.target.value })} />
        </Field>
        <Field label="LEI" htmlFor="reg-lei" error={errors.lei}>
          <Input id="reg-lei" className="font-mono" value={form.lei} onChange={(e) => set({ lei: e.target.value })} />
        </Field>
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

      <section className="grid gap-4 sm:grid-cols-2">
        <h3 className="font-medium sm:col-span-2">Limits in the Articles</h3>
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
        <Button type="submit" disabled={save.isPending}>
          {current ? 'Save' : 'Set Up the Register'}
        </Button>
      </div>
    </form>
  );
}
