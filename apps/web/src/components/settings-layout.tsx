import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Spacing for every Settings section, in one place: forms stay a readable width (tables and dashboards may use the
 * full column), rows and cards get room to breathe.
 */
export const settingsLayout = {
  /** A settings form: about 768px wide, roomy rows. */
  form: 'grid max-w-3xl gap-6',
  /** A form in several titled sections. */
  sectionedForm: 'grid max-w-3xl gap-10',
  /** A narrow form of a few fields, such as a password change. */
  narrowForm: 'grid max-w-md gap-6',
  /** Two fields side by side, one column on narrow screens. */
  twoColumns: 'grid gap-x-5 gap-y-6 sm:grid-cols-2',
  /** Cards and blocks stacked in a section. */
  stack: 'grid gap-8',
} as const;

/** A titled card inside a Settings section. */
export function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('gap-5 py-7 shadow-none', className)}>
      <CardHeader className="gap-1.5 px-7">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription className="max-w-prose leading-relaxed">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="px-7">{children}</CardContent>
    </Card>
  );
}

/** The heading over a Settings section's content. */
export function SettingsSectionHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {description && <p className="mt-1.5 max-w-prose leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  );
}
