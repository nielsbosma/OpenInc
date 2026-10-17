import { EmptyState, PageHeader } from '@/components/common';
import type { NavItem } from '@/components/layout/nav';

/** A slot in the navigation for a module that has its own spec and is not built yet. */
export function ComingSoonPage({ module }: { module: NavItem }) {
  return (
    <>
      <PageHeader title={module.title} description={module.description} />
      <EmptyState icon={<module.icon />} title="Coming Soon">
        {module.title} is the next part of OpenInc to be built. Everything it needs (accounts, roles, files, audit log, the assistant) is
        already in place.
      </EmptyState>
    </>
  );
}
