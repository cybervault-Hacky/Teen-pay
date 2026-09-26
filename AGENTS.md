<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TeenPay — Engineering Conventions (Phase 2)

## Product rules
- TeenPay is a family fintech product for teens. No real money moves — ever in the sandbox.
- Simulated money is always labelled with the `SandboxBadge` in the UI.
- Never fake an action: unbuilt features open `ComingSoonSheet`, never a dead button.
- Copy is short, friendly, professional. Never childish, never jargon.

## Money rules (sandbox)
- Balances are DERIVED by folding the ledger (`src/sandbox/projection.ts`) — never stored, never edited in place.
- All money state flows through `useSandbox()` — no scattered `localStorage` calls (only `src/sandbox/storage.ts` touches storage).
- Amounts are integer paise; UI parses with `parseAmountInput`, the engine re-validates with `validateTransferPaise`.
- Pending entries/requests never affect balances — Upcoming only.
- Paired legs (moves, goal funding) post together with `counterEntryId` + `groupId`, or not at all.
- Every mutating operation carries an idempotency key and replays safely.
- Engine errors are human-readable and rendered directly — never expose codes to users.

## Code rules
- Colors: semantic tokens from `src/app/globals.css` (`--tp-*`) only. No hex in components.
- Money: integer paise, rendered only via the `Amount` component (tabular numerals).
- Domain vocabulary lives in `src/domain/*` — never redefine those types elsewhere.
- One icon system: `lucide-react`. No emojis as UI icons.
- Motion derives from `src/design/motion.ts`; honor reduced motion (already global).
- Navigation derives from `src/design/navigation.ts` (`NAV_ITEMS`).
- Client/server: keep server-safe helpers (e.g. `buttonStyles.ts`) free of `"use client"`.
- Link-styled-as-icon-button uses `iconButtonClassName()` — never nest `<button>` inside `<a>`.
- Flow sheets reset per subject via render-time state adjustment, not effects.
- Strict TS (`noUnusedLocals/Parameters`), zero lint errors, tests for new behavior.

## Validation
Run `npm run validate` (typecheck + lint + test + build) before committing.
