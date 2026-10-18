import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ConfirmButton, Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTRPC } from '@/lib/trpc';
import type { Room } from './common';
import { ToggleRow } from './LinksTab';

const localDay = (value: Date | string | null) => {
  if (!value) return '';
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function RoomSettingsTab({ room }: { room: Room }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: room.name,
    description: room.description,
    welcomeMessage: room.welcomeMessage,
    ndaText: room.ndaText ?? '',
    closesOn: localDay(room.closesAt),
    defaultAllowDownload: room.defaultAllowDownload,
    defaultWatermark: room.defaultWatermark,
    alertOnFirstVisit: room.alertOnFirstVisit,
    alertOnDownload: room.alertOnDownload,
    alertOnFailedPasswords: room.alertOnFailedPasswords,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const update = useMutation(
    trpc.dataroom.update.mutationOptions({
      onSuccess: () => {
        toast.success('Saved');
        void queryClient.invalidateQueries({ queryKey: trpc.dataroom.pathKey() });
      },
    }),
  );
  const remove = useMutation(
    trpc.dataroom.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.dataroom.pathKey() });
        navigate('/documents/dataroom');
      },
    }),
  );
  const { closesOn, ...rest } = form;

  return (
    <div className="grid max-w-2xl gap-8">
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({
            roomId: room.id,
            ...rest,
            ndaText: rest.ndaText.trim() || null,
            closesAt: closesOn ? new Date(`${closesOn}T23:59:59`).toISOString() : null,
          });
        }}
      >
        <Field label="Name" htmlFor="room-settings-name" hint="Visitors see it on the portal.">
          <Input id="room-settings-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="room-settings-description" hint="Only your team sees this.">
          <Textarea id="room-settings-description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Welcome Message" htmlFor="room-settings-welcome" hint="Shown above the documents when a visitor is inside.">
          <Textarea
            id="room-settings-welcome"
            rows={3}
            value={form.welcomeMessage}
            onChange={(e) => set('welcomeMessage', e.target.value)}
          />
        </Field>
        <Field
          label="NDA Text"
          htmlFor="room-settings-nda"
          hint="Visitors must accept it once before they see anything. It also makes every link ask for the email. Leave empty for no NDA."
        >
          <Textarea id="room-settings-nda" rows={5} value={form.ndaText} onChange={(e) => set('ndaText', e.target.value)} />
        </Field>
        <Field
          label="Closes On"
          htmlFor="room-settings-closes"
          hint="After the end of this day no link works. Leave empty to keep it open."
        >
          <Input
            id="room-settings-closes"
            type="date"
            className="w-44"
            value={form.closesOn}
            onChange={(e) => set('closesOn', e.target.value)}
          />
        </Field>
        <div className="grid gap-4">
          <h3 className="font-medium">Defaults for New Links</h3>
          <ToggleRow label="Allow Downloads" checked={form.defaultAllowDownload} onChange={(v) => set('defaultAllowDownload', v)} />
          <ToggleRow label="Watermark" checked={form.defaultWatermark} onChange={(v) => set('defaultWatermark', v)} />
        </div>
        <div className="grid gap-4">
          <h3 className="font-medium">Alerts</h3>
          <p className="-mt-2 text-sm text-muted-foreground">Sent to {room.ownerName ?? 'the room owner'} in the app and by email.</p>
          <ToggleRow label="First Visit by Someone New" checked={form.alertOnFirstVisit} onChange={(v) => set('alertOnFirstVisit', v)} />
          <ToggleRow label="Downloads" checked={form.alertOnDownload} onChange={(v) => set('alertOnDownload', v)} />
          <ToggleRow
            label="Repeated Wrong Passwords"
            checked={form.alertOnFailedPasswords}
            onChange={(v) => set('alertOnFailedPasswords', v)}
          >
            20 wrong passwords on one link within an hour.
          </ToggleRow>
        </div>
        <Button type="submit" className="justify-self-start" disabled={!form.name.trim() || update.isPending}>
          Save
        </Button>
      </form>
      <div className="grid gap-2 border-t pt-6">
        <h3 className="font-medium">Delete Room</h3>
        <p className="text-sm text-muted-foreground">
          Removes the room with its links, visitors and statistics. The documents stay in Documents. Closing the room is usually enough.
        </p>
        <div>
          <ConfirmButton
            label="Delete Room"
            title="Delete Room"
            description={`${room.name} and all its statistics are deleted. This cannot be undone.`}
            onConfirm={() => remove.mutate({ roomId: room.id })}
          />
        </div>
      </div>
    </div>
  );
}
