import type { UIMessage } from 'ai';
import { Check, FileText, Loader2, TriangleAlert, Wrench } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

function toolLabel(type: string) {
  return type.replace(/^tool-/, '').replace(/_/g, '.');
}

export function ChatMessage({ message }: { message: UIMessage }) {
  const mine = message.role === 'user';
  return (
    <div className={cn('flex flex-col gap-1.5', mine && 'items-end')}>
      {message.parts.map((part, i) => {
        if (part.type === 'text') {
          return mine ? (
            <div key={i} className="max-w-[85%] rounded-lg bg-primary px-3 py-2 whitespace-pre-wrap text-primary-foreground">
              {part.text}
            </div>
          ) : (
            <div
              key={i}
              className="prose-chat max-w-none leading-relaxed [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_table]:w-full [&_table]:text-xs [&_td]:border-b [&_td]:py-1 [&_td]:pr-2 [&_th]:border-b [&_th]:py-1 [&_th]:pr-2 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5"
            >
              <Markdown remarkPlugins={[remarkGfm]}>{part.text}</Markdown>
            </div>
          );
        }
        if (part.type === 'file') {
          return part.mediaType.startsWith('image/') ? (
            <img key={i} src={part.url} alt={part.filename ?? ''} className="max-h-48 max-w-[85%] rounded-lg border object-contain" />
          ) : (
            <a
              key={i}
              href={part.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
            >
              <FileText className="size-3.5" /> {part.filename ?? 'Attachment'}
            </a>
          );
        }
        if (part.type.startsWith('tool-')) {
          const state = (part as { state?: string }).state;
          const failed = state === 'output-error' || !!(part as { output?: { error?: string } }).output?.error;
          return (
            <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wrench className="size-3" />
              <span className="font-mono">{toolLabel(part.type)}</span>
              {state === 'output-available' && !failed && <Check className="size-3 text-success" />}
              {failed && <TriangleAlert className="size-3 text-destructive" />}
              {(state === 'input-streaming' || state === 'input-available') && <Loader2 className="size-3 animate-spin" />}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
