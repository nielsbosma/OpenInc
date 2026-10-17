import { useChat } from '@ai-sdk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport, type FileUIPart, type UIMessage } from 'ai';
import { ArrowUp, History, Paperclip, Plus, Sparkles, Square, X } from 'lucide-react';
import { type ClipboardEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { toast } from 'sonner';
import { Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { useTRPC, useTRPCClient } from '@/lib/trpc';
import { uploadFile } from '@/lib/upload';
import { ChatMessage } from './ChatMessage';

interface PendingFile {
  key: string;
  name: string;
  part?: FileUIPart;
  previewUrl?: string;
}

const SUGGESTIONS = [
  'Who has an account here, and with which role?',
  'How do I turn on two-factor authentication?',
  'What changed recently?',
];

function Conversation({
  threadId,
  initialMessages,
  onClose,
  onNew,
  onOpenThread,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  onClose: () => void;
  onNew: () => void;
  onOpenThread: (id: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const location = useLocation();
  const pageRef = useRef(location.pathname);
  pageRef.current = location.pathname;
  const transport = useMemo(
    () => new DefaultChatTransport<UIMessage>({ api: '/api/chat', credentials: 'same-origin', body: () => ({ page: pageRef.current }) }),
    [],
  );
  const { messages, sendMessage, status, stop, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onFinish: () => void queryClient.invalidateQueries({ queryKey: trpc.chat.threads.queryKey() }),
  });
  const threads = useQuery(trpc.chat.threads.queryOptions());
  const [text, setText] = useState('');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = status === 'submitted' || status === 'streaming';
  const uploading = files.some((f) => !f.part);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever a message arrives or the status changes
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages, status]);

  async function attach(list: Iterable<File>) {
    for (const file of list) {
      const key = crypto.randomUUID();
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      setFiles((f) => [...f, { key, name: file.name || 'pasted image', previewUrl }]);
      try {
        const uploaded = await uploadFile(file, 'chat-attachment', file.name || 'pasted-image.png');
        setFiles((f) =>
          f.map((p) =>
            p.key === key
              ? { ...p, part: { type: 'file', mediaType: uploaded.contentType, filename: uploaded.name, url: uploaded.url } }
              : p,
          ),
        );
      } catch (e) {
        setFiles((f) => f.filter((p) => p.key !== key));
        toast.error(e instanceof Error ? e.message : 'Upload failed');
      }
    }
  }

  function send(value = text) {
    if (busy || uploading || (!value.trim() && files.length === 0)) return;
    const parts = files.flatMap((f) => (f.part ? [f.part] : []));
    void sendMessage(parts.length ? { text: value.trim(), files: parts } : { text: value.trim() });
    setText('');
    setFiles([]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = [...e.clipboardData.files];
    if (pasted.length) {
      e.preventDefault();
      void attach(pasted);
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b px-3">
        <Sparkles className="size-4 text-primary" />
        <span className="font-medium">Assistant</span>
        <div className="ml-auto flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Earlier chats">
                <History />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Earlier chats</DropdownMenuLabel>
              {threads.data?.length ? (
                threads.data.map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => onOpenThread(t.id)}>
                    <span className="truncate">{t.title}</span>
                  </DropdownMenuItem>
                ))
              ) : (
                <div className="px-2 py-1.5 text-muted-foreground">No earlier chats</div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="New chat">
            <Plus />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close assistant">
            <X />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-2">
            <p className="text-muted-foreground">
              Ask anything, or ask it to do something for you. It can do what you can do in the app, and every change is in the audit log.
            </p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="rounded-md border px-3 py-2 text-left hover:bg-accent" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m) => (
              <ChatMessage key={m.id} message={m} />
            ))}
            {status === 'submitted' && <Spinner />}
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">{error.message}</p>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="border-t p-3">
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {files.map((f) => (
              <div key={f.key} className="flex items-center gap-1.5 rounded-md border bg-muted/50 py-1 pr-1 pl-1.5 text-xs">
                {f.previewUrl ? (
                  <img src={f.previewUrl} alt="" className="size-6 rounded object-cover" />
                ) : (
                  <Paperclip className="size-3.5" />
                )}
                <span className="max-w-32 truncate">{f.name}</span>
                {!f.part ? (
                  <Spinner className="size-3" />
                ) : (
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((all) => all.filter((p) => p.key !== f.key))}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-lg border bg-background p-1.5 focus-within:ring-[3px] focus-within:ring-ring/50">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && void attach([...e.target.files])} />
          <Button variant="ghost" size="icon-sm" onClick={() => fileInput.current?.click()} aria-label="Attach files">
            <Paperclip />
          </Button>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder="Message the assistant…"
            className="max-h-40 min-h-8 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          {busy ? (
            <Button size="icon-sm" variant="secondary" onClick={() => stop()} aria-label="Stop">
              <Square />
            </Button>
          ) : (
            <Button size="icon-sm" onClick={() => send()} disabled={uploading || (!text.trim() && !files.length)} aria-label="Send">
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The assistant: it calls the same services as the UI, as the signed-in user. Chats are saved per user. */
export function ChatPanel({ onClose }: { onClose: () => void }) {
  const client = useTRPCClient();
  const [thread, setThread] = useState<{ id: string; messages: UIMessage[] }>(() => ({ id: crypto.randomUUID(), messages: [] }));
  async function open(id: string) {
    try {
      const t = await client.chat.thread.query({ threadId: id });
      setThread({ id: t.id, messages: t.messages as UIMessage[] });
    } catch {
      toast.error('Could not open that chat');
    }
  }
  return (
    <Conversation
      key={thread.id}
      threadId={thread.id}
      initialMessages={thread.messages}
      onClose={onClose}
      onNew={() => setThread({ id: crypto.randomUUID(), messages: [] })}
      onOpenThread={(id) => void open(id)}
    />
  );
}
