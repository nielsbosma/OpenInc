/**
 * Where the install is in its life. The server always answers HTTP, even when Postgres or S3 is
 * unreachable, so the browser can show a setup page instead of the container crash-looping.
 */
export type SystemPhase =
  | 'starting'
  | 'config-error'
  | 'unreachable'
  | 'needs-install'
  | 'installing'
  | 'migrating'
  | 'failed'
  | 'too-new'
  | 'ready';

export interface SystemProblem {
  area: 'config' | 'database' | 'storage' | 'migration';
  message: string;
  hint?: string;
}

export interface MigrationProgress {
  total: number;
  done: number;
  current: string | null;
  steps: { name: string; status: 'pending' | 'running' | 'done' | 'failed' }[];
  backupKey: string | null;
}

export interface SystemStatus {
  phase: SystemPhase;
  version: string;
  problems: SystemProblem[];
  progress: MigrationProgress | null;
  /** True until the first admin account exists. The setup wizard is open only then. */
  needsAdmin: boolean;
  /** The image version the database needs, when the database is newer than this image. */
  requiredVersion: string | null;
}

export const SETUP_CHECKLIST = ['email', 'invite', 'twoFactor', 'ai'] as const;
export type SetupChecklistItem = (typeof SETUP_CHECKLIST)[number];
