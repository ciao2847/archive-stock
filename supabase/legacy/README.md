# Historical SQL

These files document the database before timestamped migration tracking was
introduced. They are retained for audit purposes only and are not an ordered,
repeatable migration chain.

Do not edit or apply these scripts to an existing environment. Every new schema,
policy or RPC change belongs in `../migrations/` with a Supabase CLI timestamp.
