import { formatBytes } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FileArchive, FileText, Folder, FolderOpen, FolderPlus, FolderTree, MoreHorizontal, Upload } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Combobox } from '@/components/Combobox';
import { EmptyState, Field, PageHeader, Spinner } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan, useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { uploadFile } from '@/lib/upload';
import { AddToDataroomDialog } from './AddToDataroomDialog';

const TOP = '__top';

type Rename = { kind: 'folder' | 'document'; id: string; name: string };

export function DocumentsPage() {
  const { folderId } = useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const format = useFormat();
  const can = useCan();
  const canWrite = can('files.write');
  const canShare = can('dataroom.manage');
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const [rename, setRename] = useState<Rename | null>(null);
  const [moving, setMoving] = useState<{ id: string; name: string; folderId: string | null } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [sharing, setSharing] = useState<{ id: string; name: string } | null>(null);
  const deletingRooms = useQuery({
    ...trpc.dataroom.roomsForDocument.queryOptions({ documentId: deleting?.id ?? '' }),
    enabled: !!deleting && canShare,
  });

  const list = useQuery(trpc.documents.list.queryOptions({ folderId }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.documents.pathKey() });
  const add = useMutation(trpc.documents.add.mutationOptions());
  const remove = useMutation(trpc.documents.delete.mutationOptions({ onSuccess: refresh }));
  const zip = useMutation(
    trpc.documents.downloadZip.mutationOptions({
      onSuccess: () => toast.success('Making the zip. You will get a notification with the download link when it is ready.'),
    }),
  );
  const deleteFolder = useMutation(trpc.documents.deleteFolder.mutationOptions({ onSuccess: refresh }));

  const onFiles = async (picked: FileList | null) => {
    const all = Array.from(picked ?? []);
    if (!all.length || !canWrite) return;
    setUploading(all.length);
    try {
      for (const file of all) {
        const uploaded = await uploadFile(file, 'document');
        await add.mutateAsync({ fileId: uploaded.id, folderId });
        setUploading((n) => n - 1);
      }
      toast.success(all.length === 1 ? `Uploaded ${all[0]!.name}` : `Uploaded ${all.length} documents`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(0);
      refresh();
      if (input.current) input.current.value = '';
    }
  };

  const data = list.data;
  const empty = data && !data.folders.length && !data.documents.length;

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        if (!canWrite || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <PageHeader
        title="Documents"
        description="Company documents, stored in your bucket. Drop files anywhere on this page to upload them here."
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setNewFolder(true)}>
                <FolderPlus /> New Folder
              </Button>
              <Button disabled={uploading > 0} onClick={() => input.current?.click()}>
                <Upload /> {uploading ? `Uploading ${uploading}…` : 'Upload'}
              </Button>
              <input ref={input} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />
            </>
          )
        }
      />

      {data && !data.suggestTemplate && (
        <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
          <Breadcrumbs path={data.path} />
          <RowMenu label={data.folder?.name ?? 'Documents'}>
            <DropdownMenuItem onSelect={() => zip.mutate({ folderId })}>
              <FileArchive /> Download Zip
            </DropdownMenuItem>
          </RowMenu>
        </div>
      )}

      {list.isLoading ? (
        <Spinner />
      ) : !data ? null : data.suggestTemplate ? (
        <SuggestedStructure canWrite={canWrite} onApplied={refresh} />
      ) : empty ? (
        <EmptyState icon={<FolderOpen />} title="This Folder Is Empty">
          {data.hints.length > 0 ? (
            <div className="grid gap-2">
              <p>Documents that usually go here:</p>
              <ul className="grid gap-1 text-left">
                {data.hints.map((h) => (
                  <li key={h} className="flex items-center gap-2">
                    <FileText className="size-3.5 shrink-0" /> {h}
                  </li>
                ))}
              </ul>
            </div>
          ) : canWrite ? (
            'Upload documents or create a folder.'
          ) : (
            'Nothing has been added here yet.'
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden w-32 sm:table-cell">Size</TableHead>
                <TableHead className="hidden w-40 md:table-cell">Uploaded By</TableHead>
                <TableHead className="hidden w-44 md:table-cell">Added</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.folders.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <Link to={`/documents/${f.id}`} className="flex items-center gap-2.5 font-medium hover:underline">
                      <Folder className="size-4 shrink-0 text-primary" />
                      <span className="truncate">{f.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {folderSummary(f.documentCount, f.folderCount)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell" />
                  <TableCell className="hidden md:table-cell" />
                  <TableCell>
                    {canWrite && (
                      <RowMenu label={f.name}>
                        <DropdownMenuItem onSelect={() => setRename({ kind: 'folder', id: f.id, name: f.name })}>Rename</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          disabled={f.documentCount + f.folderCount > 0}
                          onSelect={() => deleteFolder.mutate({ folderId: f.id })}
                        >
                          Delete Folder
                        </DropdownMenuItem>
                      </RowMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.documents.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <a href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 hover:underline">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{d.name}</span>
                      {d.dataroomCount > 0 && (
                        <Badge variant="secondary" className="shrink-0">
                          {d.dataroomCount === 1 ? 'In 1 Dataroom' : `In ${d.dataroomCount} Datarooms`}
                        </Badge>
                      )}
                    </a>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{formatBytes(d.sizeBytes)}</TableCell>
                  <TableCell className="hidden truncate text-muted-foreground md:table-cell">{d.uploadedBy ?? '—'}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{format.dateTime(d.createdAt)}</TableCell>
                  <TableCell>
                    <RowMenu label={d.name}>
                      <DropdownMenuItem asChild>
                        <a href={`${d.url}?download`}>Download</a>
                      </DropdownMenuItem>
                      {canShare && (
                        <DropdownMenuItem onSelect={() => setSharing({ id: d.id, name: d.name })}>Add to Dataroom</DropdownMenuItem>
                      )}
                      {canWrite && (
                        <>
                          <DropdownMenuItem onSelect={() => setRename({ kind: 'document', id: d.id, name: d.name })}>
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setMoving({ id: d.id, name: d.name, folderId: d.folderId })}>
                            Move
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting({ id: d.id, name: d.name })}>
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </RowMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80">
          <p className="flex items-center gap-2 font-medium">
            <Upload className="size-4" /> Drop to upload to {data?.folder?.name ?? 'Documents'}
          </p>
        </div>
      )}

      <NewFolderDialog open={newFolder} onOpenChange={setNewFolder} parentId={folderId} onDone={refresh} />
      <RenameDialog item={rename} onClose={() => setRename(null)} onDone={refresh} />
      <MoveDialog item={moving} onClose={() => setMoving(null)} onDone={refresh} />
      <AddToDataroomDialog document={sharing} onClose={() => setSharing(null)} />
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              {deleting?.name} will be removed from Documents and can no longer be downloaded.
              {!!deletingRooms.data?.length &&
                ` It is also removed from ${deletingRooms.data.map((r) => r.name).join(', ')}, so visitors there lose it.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) remove.mutate({ documentId: deleting.id });
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function folderSummary(documents: number, folders: number) {
  const parts = [];
  if (folders) parts.push(`${folders} ${folders === 1 ? 'folder' : 'folders'}`);
  if (documents || !folders) parts.push(`${documents} ${documents === 1 ? 'document' : 'documents'}`);
  return parts.join(', ');
}

function Breadcrumbs({ path }: { path: { id: string; name: string }[] }) {
  if (!path.length) return <div />;
  return (
    <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      <Link to="/documents" className="hover:text-foreground">
        Documents
      </Link>
      {path.map((p, i) => (
        <span key={p.id} className="flex items-center gap-1">
          <ChevronRight className="size-3.5" />
          {i === path.length - 1 ? (
            <span className="font-medium text-foreground">{p.name}</span>
          ) : (
            <Link to={`/documents/${p.id}`} className="hover:text-foreground">
              {p.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
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

function SuggestedStructure({ canWrite, onApplied }: { canWrite: boolean; onApplied: () => void }) {
  const trpc = useTRPC();
  const template = useQuery(trpc.documents.template.queryOptions());
  const apply = useMutation(
    trpc.documents.applyTemplate.mutationOptions({
      onSuccess: (r) => {
        toast.success(`Created ${r.created} folders`);
        onApplied();
      },
    }),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderTree className="size-4" /> Suggested Folder Structure
        </CardTitle>
        <CardDescription>
          Documents is empty. This is a structure for the documents most companies need to keep, from formation and board minutes to
          shareholder agreements and annual reports.
          {canWrite ? ' Create it in one go, or start with your own folders.' : ' Someone who may upload files can create it.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {template.isLoading ? (
          <Spinner />
        ) : (
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {template.data?.folders.map((f) => (
              <div key={f.name} className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  <Folder className="size-4 shrink-0 text-primary" /> {f.name}
                </div>
                {f.description && <p className="mt-0.5 text-xs text-muted-foreground">{f.description}</p>}
                <ul className="mt-2 grid gap-1 border-l pl-3">
                  {f.folders.map((sub) => (
                    <li key={sub.name} className="min-w-0 text-sm" title={sub.documents.join(', ')}>
                      {sub.name}
                      {sub.documents.length > 0 && (
                        <span className="block truncate text-xs text-muted-foreground">{sub.documents.join(', ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {canWrite && (
          <div>
            <Button onClick={() => apply.mutate({})} disabled={apply.isPending || !template.data}>
              <FolderTree /> {apply.isPending ? 'Creating…' : 'Create These Folders'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NewFolderDialog({
  open,
  onOpenChange,
  parentId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: string;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const [name, setName] = useState('');
  const create = useMutation(
    trpc.documents.createFolder.mutationOptions({
      onSuccess: () => {
        onOpenChange(false);
        setName('');
        onDone();
      },
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ parentId, name });
          }}
        >
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
            <DialogDescription>{parentId ? 'Created inside the folder you are in.' : 'Created at the top level.'}</DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="folder-name">
            <Input id="folder-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              Create Folder
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ item, onClose, onDone }: { item: Rename | null; onClose: () => void; onDone: () => void }) {
  const trpc = useTRPC();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  if (item && editing !== item.id) {
    setEditing(item.id);
    setName(item.name);
  }
  const options = {
    onSuccess: () => {
      onClose();
      onDone();
    },
  };
  const renameFolder = useMutation(trpc.documents.renameFolder.mutationOptions(options));
  const renameDocument = useMutation(trpc.documents.rename.mutationOptions(options));
  const pending = renameFolder.isPending || renameDocument.isPending;
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
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!item) return;
            if (item.kind === 'folder') renameFolder.mutate({ folderId: item.id, name });
            else renameDocument.mutate({ documentId: item.id, name });
          }}
        >
          <DialogHeader>
            <DialogTitle>{item?.kind === 'folder' ? 'Rename Folder' : 'Rename Document'}</DialogTitle>
          </DialogHeader>
          <Field label="Name" htmlFor="rename-name">
            <Input id="rename-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  item,
  onClose,
  onDone,
}: {
  item: { id: string; name: string; folderId: string | null } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const folders = useQuery({ ...trpc.documents.folders.queryOptions(), enabled: !!item });
  const [target, setTarget] = useState<string>(TOP);
  const [editing, setEditing] = useState<string | null>(null);
  if (item && editing !== item.id) {
    setEditing(item.id);
    setTarget(item.folderId ?? TOP);
  }
  const move = useMutation(
    trpc.documents.move.mutationOptions({
      onSuccess: () => {
        onClose();
        onDone();
      },
    }),
  );
  const options = [{ value: TOP, label: 'Documents (Top Level)' }, ...(folders.data ?? []).map((f) => ({ value: f.id, label: f.path }))];
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
          <DialogTitle>Move Document</DialogTitle>
          <DialogDescription className="truncate">{item?.name}</DialogDescription>
        </DialogHeader>
        <Field label="Folder" htmlFor="move-folder">
          <Combobox id="move-folder" value={target} onChange={setTarget} options={options} placeholder="Select a folder…" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!item || move.isPending || target === (item.folderId ?? TOP)}
            onClick={() => item && move.mutate({ documentId: item.id, folderId: target === TOP ? null : target })}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
