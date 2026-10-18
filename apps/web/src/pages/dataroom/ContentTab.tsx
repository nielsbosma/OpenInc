import { formatBytes } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePlus, FileText, Folder, FolderPlus, GripVertical, MoreHorizontal } from 'lucide-react';
import { type DragEvent, useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/Combobox';
import { EmptyState, Field, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useCan } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { folderOptions, type Room } from './common';

type Item = Room['items'][number];
type RoomFolder = Room['folders'][number];

export function ContentTab({ room }: { room: Room }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canManage = useCan()('dataroom.manage');
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.dataroom.pathKey() });
  const [adding, setAdding] = useState<string | null | undefined>(undefined);
  const [newFolder, setNewFolder] = useState<string | null | undefined>(undefined);
  const [renaming, setRenaming] = useState<RoomFolder | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<RoomFolder | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const move = useMutation(trpc.dataroom.moveItem.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.dataroom.removeItem.mutationOptions({ onSuccess: refresh }));
  const deleteFolder = useMutation(trpc.dataroom.deleteFolder.mutationOptions({ onSuccess: refresh }));
  const createFolder = useMutation(trpc.dataroom.createFolder.mutationOptions({ onSuccess: refresh }));
  const renameFolder = useMutation(trpc.dataroom.renameFolder.mutationOptions({ onSuccess: refresh }));

  const itemsIn = (folderId: string | null) => room.items.filter((i) => i.folderId === folderId);
  const foldersIn = (parentId: string | null) => room.folders.filter((f) => f.parentId === parentId);

  const dropProps = (folderId: string | null, position?: number) =>
    canManage
      ? {
          onDragOver: (e: DragEvent) => {
            if (dragged) e.preventDefault();
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (dragged) move.mutate({ itemId: dragged, folderId, position });
            setDragged(null);
          },
        }
      : {};

  const renderItems = (folderId: string | null, depth: number) =>
    itemsIn(folderId).map((item, index, list) => (
      <li
        key={item.id}
        draggable={canManage}
        onDragStart={() => setDragged(item.id)}
        onDragEnd={() => setDragged(null)}
        {...dropProps(folderId, index)}
        className={cn('flex items-center gap-2 border-t px-3 py-2', dragged === item.id && 'opacity-40')}
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        {canManage && <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden />}
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <a href={item.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
          {item.name}
        </a>
        <span className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:block">{formatBytes(item.sizeBytes)}</span>
        {canManage && (
          <RowMenu label={item.name}>
            <DropdownMenuItem disabled={index === 0} onSelect={() => move.mutate({ itemId: item.id, folderId, position: index - 1 })}>
              Move Up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === list.length - 1}
              onSelect={() => move.mutate({ itemId: item.id, folderId, position: index + 1 })}
            >
              Move Down
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMoving(item)}>Move to Folder</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => remove.mutate({ itemId: item.id })}>
              Remove From Room
            </DropdownMenuItem>
          </RowMenu>
        )}
      </li>
    ));

  const renderFolder = (folder: RoomFolder, depth: number): React.ReactNode => (
    <li key={folder.id}>
      <div
        {...dropProps(folder.id)}
        className={cn('flex items-center gap-2 border-t bg-muted/30 px-3 py-2 font-medium', dragged && 'hover:bg-primary/10')}
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        <Folder className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        {canManage && (
          <RowMenu label={folder.name}>
            <DropdownMenuItem onSelect={() => setAdding(folder.id)}>Add Documents</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setNewFolder(folder.id)}>New Subfolder</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRenaming(folder)}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(folder)}>
              Delete Folder
            </DropdownMenuItem>
          </RowMenu>
        )}
      </div>
      <ul>
        {foldersIn(folder.id).map((f) => renderFolder(f, depth + 1))}
        {renderItems(folder.id, depth + 1)}
      </ul>
    </li>
  );

  const empty = !room.items.length && !room.folders.length;
  return (
    <div className="grid gap-4">
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAdding(null)}>
            <FilePlus /> Add Documents
          </Button>
          <Button variant="outline" onClick={() => setNewFolder(null)}>
            <FolderPlus /> New Folder
          </Button>
        </div>
      )}
      {empty ? (
        <EmptyState icon={<Folder />} title="This Room Is Empty">
          Add documents from Documents. The room points at them, so a document renamed or deleted there changes here too.
        </EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-lg border [&>li:first-child>div]:border-t-0 [&>li:first-child]:border-t-0">
          {foldersIn(null).map((f) => renderFolder(f, 0))}
          {renderItems(null, 0)}
        </ul>
      )}
      {canManage && room.items.length > 1 && (
        <p className="text-xs text-muted-foreground">Drag documents to reorder them or drop them on a folder.</p>
      )}

      <AddDocumentsDialog room={room} folderId={adding} onClose={() => setAdding(undefined)} onDone={refresh} />
      <FolderNameDialog
        title={newFolder ? 'New Subfolder' : 'New Folder'}
        open={newFolder !== undefined}
        initial=""
        onClose={() => setNewFolder(undefined)}
        submitLabel="Create Folder"
        onSubmit={(name) => createFolder.mutateAsync({ roomId: room.id, parentId: newFolder ?? undefined, name })}
      />
      <FolderNameDialog
        title="Rename Folder"
        open={!!renaming}
        initial={renaming?.name ?? ''}
        onClose={() => setRenaming(null)}
        submitLabel="Rename"
        onSubmit={(name) => renameFolder.mutateAsync({ folderId: renaming!.id, name })}
      />
      <MoveItemDialog room={room} item={moving} onClose={() => setMoving(null)} onDone={refresh} />
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Folder</DialogTitle>
            <DialogDescription>
              {deleting?.name} and its subfolders leave the room, with the documents in them. The documents stay in Documents.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) deleteFolder.mutate({ folderId: deleting.id });
                setDeleting(null);
              }}
            >
              Delete Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function FolderNameDialog({
  title,
  open,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  open: boolean;
  initial: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial);
  const [pending, setPending] = useState(false);
  const [shown, setShown] = useState(false);
  if (open !== shown) {
    setShown(open);
    if (open) setName(initial);
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            try {
              await onSubmit(name);
              onClose();
            } catch {
              // The mutation cache has shown the error.
            } finally {
              setPending(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Room folders are separate from the folders in Documents.</DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="room-folder-name">
            <Input id="room-folder-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TOP = '__top';

function AddDocumentsDialog({
  room,
  folderId,
  onClose,
  onDone,
}: {
  room: Room;
  folderId: string | null | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const open = folderId !== undefined;
  const [source, setSource] = useState(TOP);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [shown, setShown] = useState(false);
  if (open !== shown) {
    setShown(open);
    if (open) {
      setPicked(new Set());
      setSearch('');
      setTarget(folderId ?? '');
    }
  }
  const folders = useQuery({ ...trpc.documents.folders.queryOptions(), enabled: open });
  const list = useQuery({
    ...trpc.documents.list.queryOptions({ folderId: source === TOP ? undefined : source }),
    enabled: open && !search.trim(),
  });
  const found = useQuery({ ...trpc.documents.search.queryOptions({ query: search.trim() }), enabled: open && !!search.trim() });
  const add = useMutation(
    trpc.dataroom.addDocuments.mutationOptions({
      onSuccess: (r) => {
        toast.success(r.skipped ? `Added ${r.added}; ${r.skipped} were already in the room` : `Added ${r.added} to the room`);
        onClose();
        onDone();
      },
    }),
  );
  const inRoom = new Set(room.items.map((i) => i.documentId));
  const docs = search.trim() ? (found.data ?? []) : (list.data?.documents ?? []);
  const loading = search.trim() ? found.isLoading : list.isLoading;
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Documents</DialogTitle>
          <DialogDescription>Pick documents from Documents. The room points at them; nothing is copied.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From Folder" htmlFor="add-source">
            <Combobox
              id="add-source"
              value={source}
              onChange={(v) => {
                setSource(v);
                setSearch('');
              }}
              options={[
                { value: TOP, label: 'Documents (Top Level)' },
                ...(folders.data ?? []).map((f) => ({ value: f.id, label: f.path })),
              ]}
            />
          </Field>
          <Field label="Search" htmlFor="add-search">
            <Input id="add-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or folder…" />
          </Field>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border">
          {loading ? (
            <div className="p-3">
              <Spinner />
            </div>
          ) : !docs.length ? (
            <p className="p-3 text-sm text-muted-foreground">No documents here.</p>
          ) : (
            <ul className="divide-y">
              {docs.map((d) => (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                    <Checkbox
                      checked={inRoom.has(d.id) || picked.has(d.id)}
                      disabled={inRoom.has(d.id)}
                      onCheckedChange={(c) => toggle(d.id, c === true)}
                    />
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    {inRoom.has(d.id) && <span className="shrink-0 text-xs text-muted-foreground">In the room</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Field label="Into Room Folder" htmlFor="add-target">
          <Combobox id="add-target" value={target} onChange={setTarget} options={folderOptions(room.folders)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!picked.size || add.isPending}
            onClick={() => add.mutate({ roomId: room.id, folderId: target || undefined, documentIds: [...picked] })}
          >
            Add {picked.size || ''} {picked.size === 1 ? 'Document' : 'Documents'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveItemDialog({ room, item, onClose, onDone }: { room: Room; item: Item | null; onClose: () => void; onDone: () => void }) {
  const trpc = useTRPC();
  const [target, setTarget] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  if (item && editing !== item.id) {
    setEditing(item.id);
    setTarget(item.folderId ?? '');
  }
  const move = useMutation(
    trpc.dataroom.moveItem.mutationOptions({
      onSuccess: () => {
        onClose();
        onDone();
      },
    }),
  );
  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setEditing(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to Folder</DialogTitle>
          <DialogDescription className="truncate">{item?.name}</DialogDescription>
        </DialogHeader>
        <Field label="Room Folder" htmlFor="move-room-folder">
          <Combobox id="move-room-folder" value={target} onChange={setTarget} options={folderOptions(room.folders)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!item || move.isPending || target === (item.folderId ?? '')}
            onClick={() => item && move.mutate({ itemId: item.id, folderId: target || null })}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
