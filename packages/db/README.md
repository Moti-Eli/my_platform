# @platform/db

Database client, schema, and migrations.

## Structure

- `src/` - Database client and schema types
- `supabase/migrations/` - Database migrations
- [`SCHEMA.md`](./SCHEMA.md) - Plain-English entity-relationship explanation

## Schema

The core data model is a **multi-tenant RBAC** design (organizations as
tenants; users link to orgs via memberships; roles live on the membership;
permissions are global and code-defined). See [`SCHEMA.md`](./SCHEMA.md) for the
full explanation.

**Migrations:**

- `20260605000001_core_rbac_schema.sql` — Step 1: core tables, indexes, and
  seed permissions. **No Row Level Security yet** (added as a separate reviewed
  step).

## Usage

```typescript
import { dbVersion } from "@platform/db";
```
