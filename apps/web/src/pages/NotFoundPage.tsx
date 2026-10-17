import { Link } from 'react-router';
import { EmptyState } from '@/components/common';

export function NotFoundPage() {
  return (
    <EmptyState title="Page not found">
      <Link to="/" className="text-primary hover:underline">
        Go to the dashboard
      </Link>
    </EmptyState>
  );
}
