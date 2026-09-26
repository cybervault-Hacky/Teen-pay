# TeenPay

A teen-focused money platform for pocket money, spending, saving and goals —
built with families, not just for them.

> **Phase 2 — Interactive Sandbox.** The app runs on a local ledger engine
> with derived balances, persisted to this device. No real money moves, no
> payment providers are integrated, and no financial credentials are handled.
> Simulated money is always marked with a visible **Sandbox** badge.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** — semantic design tokens, dark-first with a live light theme
- **Framer Motion** — centralized, reduced-motion-aware motion system
- **Lucide** — the single icon system (no emoji icons)
- **Vitest** + Testing Library — domain, engine, store and flow tests

## Local development

```bash
npm install
cp .env.example .env    # optional — defaults already work
npm run dev             # http://localhost:3000
```

| Command            | Purpose                                     |
| ------------------ | ------------------------------------------- |
| `npm run dev`      | Development server                          |
| `npm run build`    | Production build                            |
| `npm run lint`     | ESLint (Next core-web-vitals + TypeScript)  |
| `npm run typecheck`| Strict `tsc --noEmit`                       |
| `npm run test`     | Full test suite (87 tests)                  |
| `npm run validate` | typecheck + lint + test + build             |

## The sandbox ledger

All money behavior lives in `src/sandbox/` — a pure ledger engine behind a
single React store (`useSandbox()`), persisted to `localStorage` under a
versioned key. Key rules:

- **Balances are derived, never stored** — wallet, spaces and goal progress
  are folded from append-only ledger entries on every read.
- **Pending never counts** — pending splits and requests feed Upcoming only.
- **Paired legs post together** — moves and goal funding write linked
  debit + credit entries or nothing at all.
- **Every operation is idempotent** — retries replay instead of double-posting.
- **Requests move no money** — only paying or cancelling changes their state.
- **Reset anytime** — Profile → Reset sandbox data restores the fresh seed.

## Project structure

```
src/
├── app/            # Routes: / /pay /money /activity /profile /parent
│                   # /notifications (+ loading, error, 404)
├── components/
│   ├── ui/         # Design-system primitives (Button, Card, Sheet, Amount, …)
│   ├── shell/      # App chrome: header, bottom nav, sidebar, transitions
│   ├── home/       # Home composition (balance, actions, spaces, goals, feed)
│   ├── pay/        # Amount entry + send/request flow sheets
│   ├── money/      # Space cards + move/contribute sheets
│   └── parent/     # Allowance sheet
├── design/         # Tokens, motion system, canonical navigation model
├── domain/         # Product vocabulary: user, family, wallet, ledger,
│                   # payments, goals, transactions, safety, notifications
├── data/           # Static catalog: family, recipients, merchants, goal blueprints
├── sandbox/        # Ledger engine, projections, seed, storage, store
└── lib/            # Formatting (INR/paise), env conventions, classnames
tests/              # Amounts, engine, projections, storage, store, components, flows
```

## Development principles

1. **Tokens, not hex codes** — every color comes from `globals.css` (`--tp-*`).
2. **One way to render money** — the `Amount` component, integer paise, tabular numerals.
3. **Domain types live in `src/domain`** — components never redefine them.
4. **Sandbox stays honest** — simulated money ships with a visible Sandbox marker.
5. **Balances derive from the ledger** — UI never stores or edits a balance.
6. **Accessibility is default** — labels, focus states, keyboard paths, reduced motion.
7. **Motion is purposeful** — fast and subtle, derived from `src/design/motion.ts`.
8. **No fake functionality** — unbuilt features open an honest "coming soon" sheet;
   they never pretend to act.

## Roadmap

- **Phase 1** (done): foundation, design system, shell, mock-data screens.
- **Phase 2** (current): interactive sandbox — local ledger, pay/request flows,
  parent view, notifications, persistence.
- **Phase 3**: real wallet & payment architecture (backend, ledger, rails).
