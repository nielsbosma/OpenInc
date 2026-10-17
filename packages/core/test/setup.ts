// Unit tests need a valid environment but no services. Integration tests use the local Compose stack
// (pnpm infra:up) or the CI services, and skip themselves when Postgres is not reachable.
process.env.NODE_ENV = 'test';
process.env.APP_SECRET ??= 'test-app-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://openinc:openinc@localhost:5470/openinc_test';
process.env.S3_ENDPOINT ??= 'http://localhost:9300';
process.env.S3_BUCKET ??= 'openinc-test';
process.env.S3_ACCESS_KEY ??= 'openinc';
process.env.S3_SECRET_KEY ??= 'openinc-secret';
process.env.APP_URL ??= 'http://localhost:5173';
