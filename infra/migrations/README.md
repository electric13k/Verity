# Migrations

SQL migrations for the primary Postgres database. Rules (v1 lesson, now law):

1. Numbered files: `NNNN_description.sql`, append-only, never edited after merge.
2. Every migration is PR-reviewed before it exists on any shared database.
3. Applied only by explicitly named command (`make migrate` / documented psql invocation) — never automatically at boot, never by an agent without named user approval for production databases.
4. Schema v1 lands in M2.
