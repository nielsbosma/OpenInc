import { useMutation, useQuery } from '@tanstack/react-query';
import { FolderLock, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { EmptyState, Field, PageHeader, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useCan, useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { StatusBadge } from './common';

const BLANK = '__blank';

export function DataroomsPage() {
  const trpc = useTRPC();
  const can = useCan();
  const format = useFormat();
  const [creating, setCreating] = useState(false);
  const rooms = useQuery({ ...trpc.dataroom.list.queryOptions(), enabled: can('dataroom.read') });

  if (!can('dataroom.read'))
    return (
      <EmptyState icon={<FolderLock />} title="No Access">
        Your role cannot see datarooms. An Admin can change it.
      </EmptyState>
    );

  return (
    <>
      <PageHeader
        title="Datarooms"
        description="Selections of Documents shared with outside people through password-protected links, with a record of who read what."
        actions={
          can('dataroom.manage') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New Dataroom
            </Button>
          )
        }
      />
      {rooms.isLoading ? (
        <Spinner />
      ) : !rooms.data?.length ? (
        <EmptyState icon={<FolderLock />} title="No Datarooms Yet">
          A dataroom shows investors, banks or buyers the documents you pick, through a link with its own password, and records who opened
          what and for how long. Start from a template for a seed round, due diligence or a bank.
          {can('dataroom.manage') && (
            <div className="mt-4">
              <Button onClick={() => setCreating(true)}>
                <Plus /> New Dataroom
              </Button>
            </div>
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="hidden w-28 text-right sm:table-cell">Documents</TableHead>
                <TableHead className="hidden w-24 text-right sm:table-cell">Links</TableHead>
                <TableHead className="hidden w-24 text-right md:table-cell">Visitors</TableHead>
                <TableHead className="hidden w-44 md:table-cell">Last Activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link to={`/documents/dataroom/${r.id}`} className="flex min-w-0 items-center gap-2.5 font-medium hover:underline">
                      <FolderLock className="size-4 shrink-0 text-primary" />
                      <span className="truncate">{r.name}</span>
                    </Link>
                    {r.description && <p className="mt-0.5 truncate pl-6.5 text-xs text-muted-foreground">{r.description}</p>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} live={r.live} />
                  </TableCell>
                  <TableCell className="hidden text-right font-mono text-xs sm:table-cell">{r.documentCount}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs sm:table-cell">{r.linkCount}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs md:table-cell">{r.visitorCount}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {r.lastActivityAt ? format.dateTime(r.lastActivityAt) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <NewRoomDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function NewRoomDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const templates = useQuery({ ...trpc.dataroom.templates.queryOptions(), enabled: open });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [template, setTemplate] = useState(BLANK);
  const create = useMutation(
    trpc.dataroom.create.mutationOptions({
      onSuccess: (room) => {
        onOpenChange(false);
        navigate(`/documents/dataroom/${room.id}`);
      },
    }),
  );
  const picked = templates.data?.find((t) => t.key === template);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name, description, template: template === BLANK ? undefined : template });
          }}
        >
          <DialogHeader>
            <DialogTitle>New Dataroom</DialogTitle>
            <DialogDescription>It starts as a draft. Nobody outside can open it until you open it and share a link.</DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="room-name">
            <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seed round 2026" autoFocus />
          </Field>
          <Field label="Description" htmlFor="room-description" hint="Only your team sees this.">
            <Textarea id="room-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field
            label="Start From"
            htmlFor="room-template"
            hint={
              picked
                ? `${picked.description} Adds the documents already in the matching Documents folders.`
                : 'An empty room. Add folders and documents yourself.'
            }
          >
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger id="room-template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BLANK}>Empty Room</SelectItem>
                {templates.data?.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              Create Dataroom
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
