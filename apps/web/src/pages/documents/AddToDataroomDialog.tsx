import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Combobox } from '@/components/Combobox';
import { Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTRPC } from '@/lib/trpc';
import { folderOptions } from '@/pages/dataroom/common';

export function AddToDataroomDialog({ document, onClose }: { document: { id: string; name: string } | null; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const rooms = useQuery({ ...trpc.dataroom.list.queryOptions(), enabled: !!document });
  const already = useQuery({ ...trpc.dataroom.roomsForDocument.queryOptions({ documentId: document?.id ?? '' }), enabled: !!document });
  const [roomId, setRoomId] = useState('');
  const [folderId, setFolderId] = useState('');
  const room = useQuery({ ...trpc.dataroom.get.queryOptions({ roomId }), enabled: !!roomId });
  const add = useMutation(
    trpc.dataroom.addDocuments.mutationOptions({
      onSuccess: () => {
        toast.success(`Added to ${room.data?.name ?? 'the dataroom'}`);
        void queryClient.invalidateQueries({ queryKey: trpc.dataroom.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.documents.pathKey() });
        close();
      },
    }),
  );
  const close = () => {
    setRoomId('');
    setFolderId('');
    onClose();
  };
  const inRoom = new Set((already.data ?? []).map((r) => r.roomId));
  const options = (rooms.data ?? []).filter((r) => r.status !== 'closed' && !inRoom.has(r.id)).map((r) => ({ value: r.id, label: r.name }));

  return (
    <Dialog open={!!document} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to Dataroom</DialogTitle>
          <DialogDescription className="truncate">{document?.name}</DialogDescription>
        </DialogHeader>
        {!!already.data?.length && (
          <p className="text-sm text-muted-foreground">Already in {already.data.map((r) => r.name).join(', ')}.</p>
        )}
        <Field label="Dataroom" htmlFor="add-to-room">
          <Combobox
            id="add-to-room"
            value={roomId}
            onChange={(v) => {
              setRoomId(v);
              setFolderId('');
            }}
            options={options}
            placeholder={rooms.isLoading ? 'Loading…' : options.length ? 'Select a dataroom…' : 'No dataroom to add it to'}
          />
        </Field>
        {room.data && room.data.folders.length > 0 && (
          <Field label="Folder" htmlFor="add-to-room-folder">
            <Combobox id="add-to-room-folder" value={folderId} onChange={setFolderId} options={folderOptions(room.data.folders)} />
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!document || !roomId || add.isPending}
            onClick={() => document && add.mutate({ roomId, folderId: folderId || undefined, documentIds: [document.id] })}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
