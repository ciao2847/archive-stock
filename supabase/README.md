# Supabase database workflow

This project uses timestamped, imperative migrations.

## Source of truth

- `migrations/` contains every new production database change.
- `legacy/` contains historical installation scripts that were applied manually
  before migration tracking was introduced. Do not edit or rerun them blindly.
- `scripts/` contains destructive or one-off maintenance tools. Review and run
  them manually; they are never part of deployment migrations.

## Commands

```bash
npx supabase@2.116.0 migration new descriptive_name
npx supabase@2.116.0 migration list --linked
SUPABASE_PROJECT_ID=your-project-ref npm run db:types
```

Apply migrations to a staging project first. Run database advisors and the test
suite before applying the same migration to production.
