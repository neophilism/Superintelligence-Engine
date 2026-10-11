# Database foundation (SIE-005)

Use Neon pooled connections for app queries and direct connections for migrations. `npm run db:migrate` obtains a session advisory lock, checksums applied migration files and executes them transactionally. It rejects changed applied migrations. Base schema forces RLS with no policies until OIDC and tenant-context policies arrive in SIE-003/004; it is not a working authenticated backend.

CI uses a disposable PostgreSQL service to verify migrations, composite tenant foreign keys, RLS and a full pg_dump/restore fixture. This is not evidence of a Neon production PITR drill. Production acceptance requires a real backup/PITR test in an authorized Neon project. No paid services or destructive rollback are created here.
