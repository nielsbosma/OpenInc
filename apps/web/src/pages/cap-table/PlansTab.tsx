import {
  ACCELERATION,
  ACCELERATION_LABELS,
  grantInput,
  type LEAVER,
  planInput,
  poolChangeInput,
  vestingScheduleInput,
} from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Combobox } from '@/components/Combobox';
import { EmptyState, Field, Spinner, validate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { countryOptions } from '@/lib/locale-options';
import { useCan } from '@/lib/session';
import { type RouterOutputs, useTRPC } from '@/lib/trpc';
import { fmt, StakeholderPicker, today } from './common';

type PlansData = RouterOutputs['captable']['listPlans'];
type Plan = PlansData['plans'][number];
type Grant = Plan['grants'][number];

const NO_SCHEDULE = '__none';

export function useCaptableInvalidate() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: trpc.captable.pathKey() });
}

export function PlansTab() {
  const trpc = useTRPC();
  const can = useCan();
  const [asOf, setAsOf] = useState(today());
  const plans = useQuery(trpc.captable.listPlans.queryOptions({ asOf }, { placeholderData: (prev) => prev }));
  const [dialog, setDialog] = useState<null | 'plan' | 'schedule' | { kind: 'pool'; plan: Plan } | { kind: 'grant'; plan?: Plan }>(null);
  const manage = can('captable.manage');
  const data = plans.data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="As of Date" htmlFor="plans-as-of" className="w-44">
          <Input id="plans-as-of" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        </Field>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialog('schedule')}>
              <Plus /> New Vesting Schedule
            </Button>
            {!!data?.plans.length && (
              <Button variant="outline" onClick={() => setDialog({ kind: 'grant' })}>
                <Plus /> New Grant
              </Button>
            )}
            <Button onClick={() => setDialog('plan')}>
              <Plus /> New Equity Plan
            </Button>
          </div>
        )}
      </div>
      {plans.isLoading || !data ? (
        <Spinner />
      ) : !data.plans.length ? (
        <EmptyState icon={<Layers />} title="No Equity Plans">
          An equity plan holds a pool of options, warrants or virtual shares to grant to employees and advisors.
        </EmptyState>
      ) : (
        <>
          {data.plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              asOf={data.asOf}
              manage={manage}
              onPool={() => setDialog({ kind: 'pool', plan: p })}
              onGrant={() => setDialog({ kind: 'grant', plan: p })}
            />
          ))}
          <VestingCalendar calendar={data.calendar} />
        </>
      )}
      {data && (
        <>
          <PlanDialog open={dialog === 'plan'} onOpenChange={(o) => !o && setDialog(null)} profiles={data.profiles} />
          <ScheduleDialog open={dialog === 'schedule'} onOpenChange={(o) => !o && setDialog(null)} />
          {typeof dialog === 'object' && dialog?.kind === 'pool' && <PoolDialog plan={dialog.plan} onClose={() => setDialog(null)} />}
          {typeof dialog === 'object' && dialog?.kind === 'grant' && (
            <GrantDialog plans={data.plans} schedules={data.schedules} initialPlanId={dialog.plan?.id} onClose={() => setDialog(null)} />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono">{fmt(value)}</div>
    </div>
  );
}

function PlanCard({
  plan,
  asOf,
  manage,
  onPool,
  onGrant,
}: {
  plan: Plan;
  asOf: string;
  manage: boolean;
  onPool: () => void;
  onGrant: () => void;
}) {
  const [leaver, setLeaver] = useState<Grant | null>(null);
  const [exercise, setExercise] = useState<Grant | null>(null);
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{plan.name}</CardTitle>
        <CardDescription>
          {plan.profileLabel} · {plan.kind === 'virtual' ? 'Cash-settled, never reaches the register' : `Delivers class ${plan.classCode}`}
          {plan.approvedOn && <> · approved {plan.approvedOn}</>}
        </CardDescription>
        {manage && (
          <CardAction className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onPool}>
              Change Pool
            </Button>
            <Button size="sm" onClick={onGrant}>
              <Plus /> New Grant
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
          <Stat label="Pool" value={plan.poolSize} />
          <Stat label="Granted" value={plan.granted} />
          <Stat label="Outstanding" value={plan.outstanding} />
          <Stat label="Vested" value={plan.vested} />
          <Stat label="Exercised" value={plan.exercised} />
          <Stat label="Forfeited" value={plan.forfeited} />
          <Stat label="Unallocated" value={plan.unallocated} />
        </div>
        {plan.grants.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stakeholder</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Strike</TableHead>
                  <TableHead>Granted</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead className="text-right">Vested</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                  {manage && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.grants.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      <Link to={`/cap-table/stakeholders/${g.stakeholderId}`} className="hover:underline">
                        {g.stakeholderName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono">{fmt(g.units)}</TableCell>
                    <TableCell className="text-right font-mono">{Number(g.strikePrice)}</TableCell>
                    <TableCell className="font-mono text-xs">{g.grantDate}</TableCell>
                    <TableCell>{g.scheduleName ?? 'No Vesting'}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(g.vested)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(g.outstanding)}</TableCell>
                    <TableCell>
                      {g.terminatedOn ? (
                        <Badge variant="secondary">
                          Terminated {g.terminatedOn}
                          {g.leaver ? ` (${g.leaver === 'good' ? 'Good' : 'Bad'} Leaver)` : ''}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Active</Badge>
                      )}
                    </TableCell>
                    {manage && (
                      <TableCell className="text-right whitespace-nowrap">
                        {plan.kind !== 'virtual' && g.vested !== '0' && (
                          <Button variant="ghost" size="sm" onClick={() => setExercise(g)}>
                            Exercise
                          </Button>
                        )}
                        {!g.terminatedOn && (
                          <Button variant="ghost" size="sm" onClick={() => setLeaver(g)}>
                            Mark as Leaver
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {leaver && <LeaverDialog grant={leaver} onClose={() => setLeaver(null)} />}
      {exercise && <ExerciseDialog grant={exercise} asOf={asOf} onClose={() => setExercise(null)} />}
    </Card>
  );
}

function VestingCalendar({ calendar }: { calendar: PlansData['calendar'] }) {
  const max = Math.max(...calendar.map((c) => Number(c.units)), 1);
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Vesting Calendar</CardTitle>
        <CardDescription>Units that vest in each of the next 12 months, across all active grants.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
          {calendar.map((c) => (
            <div key={c.month} className="grid gap-1 text-center">
              <div className="flex h-20 items-end justify-center rounded bg-muted/40">
                <div className="w-full rounded bg-primary/70" style={{ height: `${(Number(c.units) / max) * 100}%` }} />
              </div>
              <div className="font-mono text-xs">{fmt(c.units)}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{c.month}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PlanDialog({
  open,
  onOpenChange,
  profiles,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  profiles: PlansData['profiles'];
}) {
  const trpc = useTRPC();
  const invalidate = useCaptableInvalidate();
  const empty = { name: '', profile: 'options', classCode: '', poolSize: '', approvedOn: '', notes: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation(
    trpc.captable.savePlan.mutationOptions({
      onSuccess: () => {
        toast.success('Equity plan created');
        void invalidate();
        setForm(empty);
        onOpenChange(false);
      },
    }),
  );
  const profile = profiles.find((p) => p.id === form.profile);
  const submit = () => {
    const result = validate(planInput, {
      ...form,
      kind: profile?.kind,
      approvedOn: form.approvedOn || null,
      poolSize: form.poolSize || '0',
    });
    if (result.errors) return setErrors(result.errors);
    setErrors({});
    save.mutate(result.data);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Equity Plan</DialogTitle>
          <DialogDescription>The profile sets the kind of instrument; check the terms with local counsel.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="plan-name" error={errors.name} className="sm:col-span-2">
            <Input id="plan-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Profile" htmlFor="plan-profile" hint={profile?.description} className="sm:col-span-2">
            <Combobox
              id="plan-profile"
              value={form.profile}
              onChange={(v) => setForm({ ...form, profile: v })}
              options={profiles.map((p) => ({ value: p.id, label: p.label, hint: p.country ?? 'Any country' }))}
            />
          </Field>
          {profile?.kind !== 'virtual' && (
            <Field label="Share Class" htmlFor="plan-class" error={errors.classCode} hint="The class an exercise delivers">
              <Input
                id="plan-class"
                className="font-mono"
                value={form.classCode}
                onChange={(e) => setForm({ ...form, classCode: e.target.value })}
              />
            </Field>
          )}
          <Field label="Pool Size" htmlFor="plan-pool" error={errors.poolSize}>
            <Input
              id="plan-pool"
              className="font-mono"
              inputMode="numeric"
              value={form.poolSize}
              onChange={(e) => setForm({ ...form, poolSize: e.target.value })}
            />
          </Field>
          <Field label="Approved On" htmlFor="plan-approved" error={errors.approvedOn}>
            <Input
              id="plan-approved"
              type="date"
              value={form.approvedOn}
              onChange={(e) => setForm({ ...form, approvedOn: e.target.value })}
            />
          </Field>
          <Field label="Notes" htmlFor="plan-notes" className="sm:col-span-2">
            <Textarea id="plan-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Create Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PoolDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const trpc = useTRPC();
  const invalidate = useCaptableInvalidate();
  const [form, setForm] = useState({ delta: '', date: today(), note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation(
    trpc.captable.changePool.mutationOptions({
      onSuccess: () => {
        toast.success('Pool changed');
        void invalidate();
        onClose();
      },
    }),
  );
  const submit = () => {
    const result = validate(poolChangeInput, { ...form, planId: plan.id });
    if (result.errors) return setErrors(result.errors);
    save.mutate(result.data);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Pool</DialogTitle>
          <DialogDescription>
            {plan.name} has {fmt(plan.poolSize)} units, {fmt(plan.unallocated)} unallocated. Use a negative number to shrink it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Change in Units" htmlFor="pool-delta" error={errors.delta}>
            <Input id="pool-delta" className="font-mono" value={form.delta} onChange={(e) => setForm({ ...form, delta: e.target.value })} />
          </Field>
          <Field label="From Date" htmlFor="pool-date" error={errors.date}>
            <Input id="pool-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Note" htmlFor="pool-note" hint="For example the board decision" className="sm:col-span-2">
            <Input id="pool-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Change Pool
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantDialog({
  plans,
  schedules,
  initialPlanId,
  onClose,
}: {
  plans: Plan[];
  schedules: PlansData['schedules'];
  initialPlanId?: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const invalidate = useCaptableInvalidate();
  const [form, setForm] = useState({
    planId: initialPlanId ?? plans[0]!.id,
    stakeholderId: '',
    units: '',
    strikePrice: '0',
    grantDate: today(),
    vestingStart: today(),
    scheduleId: schedules[0]?.id ?? NO_SCHEDULE,
    notes: '',
  });
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState({ name: '', email: '', country: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const addStakeholder = useMutation(
    trpc.captable.saveStakeholder.mutationOptions({
      onSuccess: (s) => {
        void invalidate();
        setForm((f) => ({ ...f, stakeholderId: s.id }));
        setAdding(false);
      },
    }),
  );
  const save = useMutation(
    trpc.captable.saveGrant.mutationOptions({
      onSuccess: () => {
        toast.success('Grant saved');
        void invalidate();
        onClose();
      },
    }),
  );
  const submit = () => {
    const result = validate(grantInput, { ...form, scheduleId: form.scheduleId === NO_SCHEDULE ? null : form.scheduleId });
    if (result.errors) return setErrors(result.errors);
    save.mutate(result.data);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Grant</DialogTitle>
          <DialogDescription>Shares only reach the register when the grant is exercised.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Equity Plan" htmlFor="grant-plan" className="sm:col-span-2">
            <Select value={form.planId} onValueChange={(v) => setForm({ ...form, planId: v })}>
              <SelectTrigger id="grant-plan" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({fmt(p.unallocated)} unallocated)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Stakeholder" htmlFor="grant-stakeholder" error={errors.stakeholderId} className="sm:col-span-2">
            <div className="flex gap-2">
              <StakeholderPicker
                id="grant-stakeholder"
                value={form.stakeholderId}
                onChange={(v) => setForm({ ...form, stakeholderId: v })}
              />
              <Button type="button" variant="outline" onClick={() => setAdding(!adding)}>
                <Plus /> Add Stakeholder
              </Button>
            </div>
          </Field>
          {adding && (
            <div className="grid gap-3 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-3">
              <Field label="Name" htmlFor="new-person-name">
                <Input id="new-person-name" value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} />
              </Field>
              <Field label="Email" htmlFor="new-person-email">
                <Input
                  id="new-person-email"
                  type="email"
                  value={person.email}
                  onChange={(e) => setPerson({ ...person, email: e.target.value })}
                />
              </Field>
              <Field label="Country" htmlFor="new-person-country">
                <Combobox
                  id="new-person-country"
                  value={person.country}
                  onChange={(v) => setPerson({ ...person, country: v })}
                  options={countryOptions()}
                />
              </Field>
              <Button
                type="button"
                className="sm:col-span-3"
                disabled={!person.name.trim() || addStakeholder.isPending}
                onClick={() => addStakeholder.mutate({ ...person, kind: 'person', groupId: null })}
              >
                Save Stakeholder
              </Button>
            </div>
          )}
          <Field label="Units" htmlFor="grant-units" error={errors.units}>
            <Input
              id="grant-units"
              className="font-mono"
              inputMode="numeric"
              value={form.units}
              onChange={(e) => setForm({ ...form, units: e.target.value })}
            />
          </Field>
          <Field label="Strike Price" htmlFor="grant-strike" error={errors.strikePrice} hint="Per unit, in major currency units">
            <Input
              id="grant-strike"
              className="font-mono"
              value={form.strikePrice}
              onChange={(e) => setForm({ ...form, strikePrice: e.target.value })}
            />
          </Field>
          <Field label="Grant Date" htmlFor="grant-date" error={errors.grantDate}>
            <Input id="grant-date" type="date" value={form.grantDate} onChange={(e) => setForm({ ...form, grantDate: e.target.value })} />
          </Field>
          <Field label="Vesting Start" htmlFor="grant-vesting" error={errors.vestingStart}>
            <Input
              id="grant-vesting"
              type="date"
              value={form.vestingStart}
              onChange={(e) => setForm({ ...form, vestingStart: e.target.value })}
            />
          </Field>
          <Field label="Vesting Schedule" htmlFor="grant-schedule" className="sm:col-span-2">
            <Select value={form.scheduleId} onValueChange={(v) => setForm({ ...form, scheduleId: v })}>
              <SelectTrigger id="grant-schedule" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SCHEDULE}>No Vesting</SelectItem>
                {schedules.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Notes" htmlFor="grant-notes" className="sm:col-span-2">
            <Textarea id="grant-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Save Grant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const trpc = useTRPC();
  const invalidate = useCaptableInvalidate();
  const empty = { name: '', cliffMonths: '12', totalMonths: '48', frequencyMonths: '1', acceleration: 'none' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation(
    trpc.captable.saveSchedule.mutationOptions({
      onSuccess: () => {
        toast.success('Vesting schedule saved');
        void invalidate();
        setForm(empty);
        onOpenChange(false);
      },
    }),
  );
  const submit = () => {
    const result = validate(vestingScheduleInput, {
      ...form,
      cliffMonths: Number(form.cliffMonths),
      totalMonths: Number(form.totalMonths),
      frequencyMonths: Number(form.frequencyMonths),
    });
    if (result.errors) return setErrors(result.errors);
    save.mutate(result.data);
  };
  const num = (key: 'cliffMonths' | 'totalMonths' | 'frequencyMonths', label: string) => (
    <Field label={label} htmlFor={`schedule-${key}`} error={errors[key]}>
      <Input
        id={`schedule-${key}`}
        className="font-mono"
        inputMode="numeric"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Vesting Schedule</DialogTitle>
          <DialogDescription>
            A template to attach to grants, for example four years with a one-year cliff, vesting monthly.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" htmlFor="schedule-name" error={errors.name} className="sm:col-span-3">
            <Input id="schedule-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          {num('cliffMonths', 'Cliff (Months)')}
          {num('totalMonths', 'Total (Months)')}
          {num('frequencyMonths', 'Vests Every (Months)')}
          <Field label="Acceleration on Exit" htmlFor="schedule-acceleration" className="sm:col-span-3">
            <Select value={form.acceleration} onValueChange={(v) => setForm({ ...form, acceleration: v })}>
              <SelectTrigger id="schedule-acceleration" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCELERATION.map((a) => (
                  <SelectItem key={a} value={a}>
                    {ACCELERATION_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Save Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaverDialog({ grant, onClose }: { grant: Grant; onClose: () => void }) {
  const trpc = useTRPC();
  const invalidate = useCaptableInvalidate();
  const [date, setDate] = useState(today());
  const [leaver, setLeaver] = useState<(typeof LEAVER)[number]>('good');
  const save = useMutation(
    trpc.captable.terminateGrant.mutationOptions({
      onSuccess: () => {
        toast.success('Leaver recorded');
        void invalidate();
        onClose();
      },
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as Leaver</DialogTitle>
          <DialogDescription>
            A good leaver keeps what had vested; a bad leaver forfeits everything not yet exercised. Forfeited units go back to the pool.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Leaving Date" htmlFor="leaver-date">
            <Input id="leaver-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Leaver" htmlFor="leaver-kind">
            <Select value={leaver} onValueChange={(v) => setLeaver(v as typeof leaver)}>
              <SelectTrigger id="leaver-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="good">Good Leaver</SelectItem>
                <SelectItem value="bad">Bad Leaver</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate({ grantId: grant.id, date, leaver })} disabled={save.isPending || !date}>
            Mark as Leaver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExerciseDialog({ grant, asOf, onClose }: { grant: Grant; asOf: string; onClose: () => void }) {
  const trpc = useTRPC();
  const invalidate = useCaptableInvalidate();
  const [units, setUnits] = useState(grant.vested);
  const [date, setDate] = useState(asOf);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const save = useMutation(
    trpc.captable.exerciseGrant.mutationOptions({
      onSuccess: (r) => {
        toast.success('Exercise drafted in the share register');
        void invalidate();
        setDraftUrl(r.draft.url);
      },
    }),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Exercise</DialogTitle>
          <DialogDescription>
            Drafts a new issue at the strike price. It counts on the cap table once someone commits it in the share register.
          </DialogDescription>
        </DialogHeader>
        {draftUrl ? (
          <p>
            The new issue is a draft.{' '}
            <Link to={draftUrl} className="font-medium text-primary hover:underline">
              Open in Register
            </Link>
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Units" htmlFor="exercise-units" hint={`${fmt(grant.vested)} vested and not exercised`}>
              <Input id="exercise-units" className="font-mono" value={units} onChange={(e) => setUnits(e.target.value)} />
            </Field>
            <Field label="Exercise Date" htmlFor="exercise-date">
              <Input id="exercise-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {draftUrl ? 'Close' : 'Cancel'}
          </Button>
          {!draftUrl && (
            <Button onClick={() => save.mutate({ grantId: grant.id, units, date })} disabled={save.isPending || !/^\d+$/.test(units)}>
              Draft the Exercise
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
