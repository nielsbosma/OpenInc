import { GROUP_COLORS, groupInput } from '@openinc/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton, Field, Spinner, validate } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/session';
import { type RouterOutputs, useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { GROUP_SWATCH, useStakeholders } from './common';
import { useCaptableInvalidate } from './PlansTab';

type Group = RouterOutputs['captable']['listStakeholders']['groups'][number];

const NO_GROUP = '__none';
const colorLabel = (c: string) => c[0]!.toUpperCase() + c.slice(1);

export function SettingsTab() {
  const trpc = useTRPC();
  const can = useCan();
  const invalidate = useCaptableInvalidate();
  const settings = useQuery(trpc.captable.settings.queryOptions());
  const people = useStakeholders();
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const update = useMutation(
    trpc.captable.updateSettings.mutationOptions({
      onSuccess: () => {
        toast.success('Settings saved');
        void invalidate();
      },
    }),
  );
  const assign = useMutation(trpc.captable.assignGroup.mutationOptions({ onSuccess: () => void invalidate() }));
  const remove = useMutation(
    trpc.captable.deleteGroup.mutationOptions({
      onSuccess: () => {
        toast.success('Group deleted');
        void invalidate();
      },
    }),
  );
  if (!can('captable.manage'))
    return <p className="text-muted-foreground">Only people who manage the cap table can change its settings.</p>;
  if (settings.isLoading || people.isLoading || !settings.data || !people.data) return <Spinner />;
  const s = settings.data;
  const groups = people.data.groups;
  return (
    <div className="grid max-w-4xl gap-5">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Cap Table Settings</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-start gap-3">
            <Switch
              id="include-pool"
              checked={s.includeUnallocatedPool}
              onCheckedChange={(v) => update.mutate({ ...s, includeUnallocatedPool: v })}
            />
            <div className="grid gap-1">
              <Label htmlFor="include-pool">Count the Unallocated Pool in Fully Diluted</Label>
              <p className="text-xs text-muted-foreground">The usual definition for investors. Every table states the definition in use.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id="holders-full"
              checked={s.holdersSeeFullTable}
              onCheckedChange={(v) => update.mutate({ ...s, holdersSeeFullTable: v })}
            />
            <div className="grid gap-1">
              <Label htmlFor="holders-full">Shareholders See the Full Cap Table</Label>
              <p className="text-xs text-muted-foreground">
                Off: shareholders only see their own position and its value at the last price.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Stakeholder Groups</CardTitle>
          <CardDescription>Founders, employees, investors, advisors: every view rolls up by group.</CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> New Group
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          {groups.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <div key={g.id} className="flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
                  <span className={cn('inline-block size-2.5 rounded-sm', GROUP_SWATCH[g.color])} />
                  {g.name}
                  <Button variant="ghost" size="sm" onClick={() => setEditing(g)}>
                    Rename
                  </Button>
                  <ConfirmButton
                    label="Delete"
                    title={`Delete ${g.name}?`}
                    description="Its members become ungrouped. Nothing else changes."
                    onConfirm={() => remove.mutate({ id: g.id })}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stakeholder</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead className="w-56">Group</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.data.stakeholders.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.inRegister ? 'Share register' : 'Cap table only'}</TableCell>
                    <TableCell>
                      <Select
                        value={p.groupId ?? NO_GROUP}
                        onValueChange={(v) => assign.mutate({ stakeholderId: p.id, groupId: v === NO_GROUP ? null : v })}
                      >
                        <SelectTrigger className="w-full" aria-label={`Group of ${p.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_GROUP}>No Group</SelectItem>
                          {groups.map((g) => (
                            <SelectItem key={g.id} value={g.id}>
                              {g.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      {editing && <GroupDialog group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GroupDialog({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const trpc = useTRPC();
  const invalidate = useCaptableInvalidate();
  const [form, setForm] = useState({ name: group?.name ?? '', color: group?.color ?? 'indigo' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation(
    trpc.captable.saveGroup.mutationOptions({
      onSuccess: () => {
        toast.success('Group saved');
        void invalidate();
        onClose();
      },
    }),
  );
  const submit = () => {
    const result = validate(groupInput, { ...form, id: group?.id });
    if (result.errors) return setErrors(result.errors);
    save.mutate(result.data);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? 'Rename Group' : 'New Group'}</DialogTitle>
          <DialogDescription>Groups only change how the cap table rolls up; they never touch the register.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="group-name" error={errors.name}>
            <Input id="group-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Color" htmlFor="group-color">
            <Select value={form.color} onValueChange={(v) => setForm({ ...form, color: v })}>
              <SelectTrigger id="group-color" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_COLORS.map((c) => (
                  <SelectItem key={c} value={c}>
                    <span className={cn('inline-block size-2.5 rounded-sm', GROUP_SWATCH[c])} />
                    {colorLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Save Group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
