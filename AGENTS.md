<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TeenPay — Engineering Conventions (Phase 1)

## Product rules
- TeenPay is a family fintech product for teens. No real money moves in Phase 1.
- Mock data lives ONLY in `src/data/mock.ts` and is always labelled "Sample data" in the UI.
- Never fake an action: unbuilt features open `ComingSoonSheet`, never a dead button.
- Copy is short, friendly, professional. Never childish, never jargon.

## Code rules
- Colors: semantic tokens from `src/app/globals.css` (`--tp-*`) only. No hex in components.
- Money: integer paise, rendered only via the `Amount` component (tabular numerals).
- Domain vocabulary lives in `src/domain/*` — never redefine those types elsewhere.
- One icon system: `lucide-react`. No emojis as UI icons.
- Motion derives from `src/design/motion.ts`; honor reduced motion (already global).
- Navigation derives from `src/design/navigation.ts` (`NAV_ITEMS`).
- Client/server: keep server-safe helpers (e.g. `buttonStyles.ts`) free of `"use client"`.
- Strict TS (`noUnusedLocals/Parameters`), zero lint errors, tests for new behavior.

## Validation
Run `npm run validate` (typecheck + lint + test + build) before committing.
