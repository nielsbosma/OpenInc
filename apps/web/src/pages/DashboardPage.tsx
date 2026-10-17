import { Link } from 'react-router';
import { PageHeader } from '@/components/common';
import { MODULES } from '@/components/layout/nav';
import { Badge } from '@/components/ui/badge';
import { useClientConfig, useSession } from '@/lib/session';

export function DashboardPage() {
  const { user } = useSession();
  const config = useClientConfig();
  return (
    <>
      <PageHeader title={`Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}`} description={config?.companyName ?? undefined} />
      <section className="@container">
        <h2 className="mb-3 font-medium">Modules</h2>
        <div className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
          {MODULES.map((m) => (
            <Link key={m.path} to={m.path} className="rounded-lg border p-4 transition-colors hover:bg-accent">
              <div className="flex items-center gap-2">
                <m.icon className="size-4 shrink-0 text-primary" />
                <span className="truncate font-medium">{m.title}</span>
                <Badge variant="outline" className="ml-auto shrink-0 text-[10px] font-normal text-muted-foreground">
                  Coming Soon
                </Badge>
              </div>
              <p className="mt-1.5 text-muted-foreground">{m.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
