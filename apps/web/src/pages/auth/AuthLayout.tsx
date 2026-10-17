import type { ReactNode } from 'react';
import { Logo } from '@/components/common';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useClientConfig } from '@/lib/session';
import { cn } from '@/lib/utils';

export function AuthLayout({
  title,
  description,
  children,
  wide,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const config = useClientConfig();
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <Logo src={config?.logoUrl} name={config?.companyName} className="size-8" />
        <span className="text-base font-semibold">{config?.companyName ?? 'OpenInc'}</span>
      </div>
      <Card className={cn('w-full shadow-none', wide ? 'max-w-xl' : 'max-w-sm')}>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
