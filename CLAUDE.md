# Claude.md - Instructions for Future Sessions

This document is the system prompt for AI-assisted development on this project.

## Before Starting Any Work

1. **Read ARCHITECTURE.md first** — Understand the key decisions and reasoning behind the structure. This prevents second-guessing established patterns.
2. **Check the current README.md** — It describes the current project status and structure. Update it if status changes.
3. **Review this file** — Keep these instructions in mind throughout your session.

---

## Golden Rules

### 1. Update Documentation on Every Change

Every logical change to the codebase must update documentation:

- **README.md**: Update "Current Status" section, structure overview if folders change
- **ARCHITECTURE.md**: Add new decisions or update existing reasoning if architectural changes occur
- **Package READMEs**: Update `packages/*/README.md` if package scope changes
- **Commit messages**: Use Conventional Commits (feat:, fix:, refactor:, docs:, etc.)

**Example workflow:**
```bash
# 1. Make code changes
# 2. Update README.md current status
# 3. Update ARCHITECTURE.md if decisions changed
# 4. Commit with conventional message
git commit -m "feat: add user authentication

- Implemented OAuth2 flow with Supabase
- Updated @platform/auth package
- ARCHITECTURE.md updated with auth decision"
```

### 2. Preserve the Monorepo Philosophy

- ✅ **DO**: Share types, utilities, auth, design tokens across packages
- ✅ **DO**: Use path aliases (`@platform/core`, `@platform/auth`, etc.)
- ✅ **DO**: Keep packages focused and single-responsibility
- ❌ **DON'T**: Duplicate code across packages
- ❌ **DON'T**: Create circular dependencies
- ❌ **DON'T**: Import app-specific code from packages (apps can depend on packages, not vice versa)

### 3. TypeScript Strict Mode is Non-Negotiable

- All packages extend `@platform/config/tsconfig.strict.json`
- No `any` types without explicit justification
- No disabled strict rules
- Type your dependencies, not just function signatures

### 4. Respect Package Boundaries

**@platform/config** — Never add business logic here
- Only design tokens, linting rules, TS configs, Prettier config

**@platform/core** — Business domain logic and shared types
- User types, entities, API client
- NO authentication logic (that's @platform/auth)

**@platform/auth** — Authentication and authorization ONLY
- RBAC definitions, permission checks
- Supabase auth wrapper

**@platform/i18n** — Translations ONLY
- JSON translation files, language utils

**@platform/ui** — Component library ONLY
- Reusable components using design tokens
- Platform-agnostic when possible, platform-specific subfolders when needed

**@platform/db** — Database layer ONLY
- Supabase client, schema types, migration scripts

**apps/web, apps/mobile** — Platform-specific app logic
- Feature implementation, routing, state management

### 5. Conventional Commits and Testing Before Commit

Every commit uses Conventional Commits format:

```
type(scope): subject

# Valid types:
feat:     New feature
fix:      Bug fix
refactor: Code refactoring (no new features or fixes)
docs:     Documentation only
chore:    Dependencies, tooling, build scripts
test:     Tests
perf:     Performance improvements

# Examples:
feat(auth): implement RBAC permission checks
fix(i18n): fix Hebrew text right-to-left display
refactor(core): extract user validation logic
docs: update ARCHITECTURE.md with new decision
```

Before committing:
```bash
pnpm lint      # Must pass
pnpm typecheck # Must pass
pnpm build     # Should pass if making changes
```

---

## Development Checklist

**When adding a feature:**
- [ ] Create/update the relevant package
- [ ] Add TypeScript types with strict mode
- [ ] Export public API from `src/index.ts`
- [ ] Write a placeholder or basic implementation
- [ ] Update package `README.md`
- [ ] Update root `README.md` status section
- [ ] Run `pnpm lint && pnpm typecheck`
- [ ] Commit with conventional message + documentation updates

**When adding a new business decision:**
- [ ] Add a new section to `ARCHITECTURE.md`
- [ ] Use the format: Decision, Reasoning (1-2 sentences)
- [ ] Commit with `docs(architecture):`

**When scaffolding a new app (web, mobile):**
- [ ] Update the placeholder README
- [ ] Create necessary config files
- [ ] Update root `README.md` status
- [ ] Commit with `feat(web):` or `feat(mobile):`

---

## Common Tasks

### Adding a new shared package
```bash
# 1. Create directory
mkdir packages/my-package
cd packages/my-package

# 2. Create minimal structure
echo '{"name": "@platform/my-package", "version": "0.1.0", "private": true}' > package.json
echo 'extends: @platform/config/tsconfig.strict.json' > tsconfig.json
mkdir -p src
echo "export const myPackageVersion = \"0.1.0\";" > src/index.ts

# 3. Update root README.md and ARCHITECTURE.md
# 4. Commit
git add .
git commit -m "feat: add @platform/my-package package

- New shared package for [purpose]
- Updated README.md with new structure"
```

### Adding a feature to a package
```bash
# 1. Add TypeScript file(s) in packages/*/src/
# 2. Export from packages/*/src/index.ts
# 3. Update package README.md with feature description
# 4. Run tests locally
# 5. Commit
git commit -m "feat(core): add user validation utilities

- Created userSchema with validation rules
- Exported validate function from core"
```

### Running a specific package's tasks
```bash
# Lint only @platform/core
turbo lint --filter @platform/core

# Typecheck only @platform/auth
turbo typecheck --filter @platform/auth

# Build web app with dependencies
turbo build --filter @platform/web...
```

---

## Environment & Secrets

- `.env` file is gitignored — never commit it
- `.env.example` documents all required variables
- In CI/CD, secrets come from GitHub Secrets, not the repo
- Development: Copy `.env.example` to `.env`, fill in local values

---

## When You Get Stuck

1. **Type errors?** Check `packages/config/tsconfig.strict.json` — if a rule is too strict, discuss it before disabling
2. **Build issues?** Run `pnpm clean && pnpm install` to reset
3. **Module not found?** Verify the export exists in `src/index.ts` and package name is correct
4. **Circular dependency?** Refactor so that apps depend on packages, not vice versa

---

## Final Notes

This is a **scalable, production-ready foundation**. Treat it as such:
- Code quality > speed
- Types > runtime surprises
- Documentation > assumption
- Clarity > cleverness

Good luck! 🚀
