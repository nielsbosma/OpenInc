import { type ReactNode, useState } from 'react';
import { CopyButton } from '@/components/common';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const CLIENTS = [
  { key: 'claude', title: 'Claude' },
  { key: 'chatgpt', title: 'ChatGPT' },
  { key: 'claude-code', title: 'Claude Code' },
  { key: 'cursor', title: 'Cursor' },
  { key: 'vscode', title: 'VS Code' },
] as const;
type ClientKey = (typeof CLIENTS)[number]['key'];

const tabKey = 'openinc-mcp-client';

/** "Acme Robotics AB" → "acme-robotics-ab": a server name every client accepts. */
export function serverSlug(name: string) {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'openinc'
  );
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 pr-24 font-mono text-xs text-foreground">{code}</pre>
      <div className="absolute top-2 right-2">
        <CopyButton value={code} />
      </div>
    </div>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="grid list-decimal gap-2 pl-5 text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{children}</ol>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** Step-by-step setup for the common MCP clients, with this install's URL filled in. Checked against each client's docs in October 2026. */
export function McpClientGuides({ url, name }: { url: string; name: string }) {
  const slug = serverSlug(name);
  const local = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
  const [tab, setTabState] = useState<ClientKey>(() => {
    try {
      const stored = localStorage.getItem(tabKey);
      return CLIENTS.some((c) => c.key === stored) ? (stored as ClientKey) : 'claude';
    } catch {
      return 'claude';
    }
  });
  const setTab = (value: string) => {
    setTabState(value as ClientKey);
    try {
      localStorage.setItem(tabKey, value);
    } catch {}
  };
  const cloudOnly = local && (
    <Note>
      This address only works on your own computer. This client connects from its own servers, so it needs a public HTTPS address (set
      APP_URL).
    </Note>
  );

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-4">
      <TabsList className="h-auto flex-wrap justify-start">
        {CLIENTS.map((c) => (
          <TabsTrigger key={c.key} value={c.key}>
            {c.title}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="claude" className="grid gap-3">
        <Steps>
          <li>
            In claude.ai or the Claude desktop app, open <b>Customize → Connectors</b>, click <b>+</b> and choose{' '}
            <b>Add custom connector</b>.
          </li>
          <li>
            Name it <b>{name}</b>, paste the URL above and click <b>Continue</b>.
          </li>
          <li>
            Click <b>Continue</b>, choose <b>Sign in now</b> under <b>Authentication</b> and click <b>Add</b>. A browser window opens: sign
            in here (with two-factor if it is on) and click <b>Allow</b>.
          </li>
          <li>
            In a chat, turn it on under <b>+ → Connectors</b>.
          </li>
        </Steps>
        <Note>
          Free plans can add one custom connector. On Team and Enterprise plans an Owner adds it under{' '}
          <b>Organization settings → Connectors</b>, then each person clicks <b>Connect</b>.
        </Note>
        {cloudOnly}
      </TabsContent>

      <TabsContent value="chatgpt" className="grid gap-3">
        <Steps>
          <li>
            In ChatGPT on the web, open <b>Plugins</b>, click <b>+</b> and choose <b>Add custom MCP server</b>.
          </li>
          <li>
            Name it <b>{name}</b> and paste the URL above under <b>Connection</b>. Use OAuth for authentication.
          </li>
          <li>
            Tick <b>I understand and want to continue</b>, then <b>Create as a plugin</b>. Sign in here when the browser asks and click{' '}
            <b>Allow</b>.
          </li>
          <li>
            Install the plugin, then type <b>@</b> in a new chat and pick it.
          </li>
        </Steps>
        <Note>
          Full MCP access needs ChatGPT Business, Enterprise or Edu; on Business only admins and owners can add servers. Pro can connect
          with read-only access.
        </Note>
        {cloudOnly}
      </TabsContent>

      <TabsContent value="claude-code" className="grid gap-3">
        <Steps>
          <li>Run this in a terminal:</li>
        </Steps>
        <Snippet code={`claude mcp add --transport http --scope user ${slug} ${url}`} />
        <Steps>
          <li value={2}>
            In Claude Code, run <b>/mcp</b>, pick <b>{slug}</b> and sign in here when the browser opens. Click <b>Allow</b>.
          </li>
        </Steps>
        <Note>
          <span className="font-mono">--scope user</span> makes it available in every project; leave it out for the current project only.
        </Note>
      </TabsContent>

      <TabsContent value="cursor" className="grid gap-3">
        <Steps>
          <li>
            Add this to <span className="font-mono text-foreground">~/.cursor/mcp.json</span> (every project) or{' '}
            <span className="font-mono text-foreground">.cursor/mcp.json</span> (one project). Merge it into <b>mcpServers</b> if the file
            already has servers.
          </li>
        </Steps>
        <Snippet code={JSON.stringify({ mcpServers: { [slug]: { url } } }, null, 2)} />
        <Steps>
          <li value={2}>
            Find <b>{slug}</b> in Cursor's MCP settings. When it asks you to sign in, a browser window opens: sign in here and click{' '}
            <b>Allow</b>.
          </li>
        </Steps>
      </TabsContent>

      <TabsContent value="vscode" className="grid gap-3">
        <Steps>
          <li>
            Add this to <span className="font-mono text-foreground">.vscode/mcp.json</span> in your workspace. Merge it into <b>servers</b>{' '}
            if the file already has servers.
          </li>
        </Steps>
        <Snippet code={JSON.stringify({ servers: { [slug]: { type: 'http', url } } }, null, 2)} />
        <Steps>
          <li value={2}>
            Click <b>Start</b> above the server in the file (or run <b>MCP: List Servers</b>). Trust it, then sign in here when the browser
            opens and click <b>Allow</b>.
          </li>
        </Steps>
        <Note>
          Needs GitHub Copilot. On Copilot Business and Enterprise an admin must turn on the <b>MCP servers in Copilot</b> policy.
        </Note>
      </TabsContent>
    </Tabs>
  );
}
