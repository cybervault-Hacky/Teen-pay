# TeenPay

A teen-focused money platform for pocket money, spending, saving and goals —
built with families, not just for them.

> **Phase 1 — Product Foundation & Premium Design System.**
> The app runs on controlled mock data. No real money moves, no payment
> providers are integrated, and no financial credentials are handled.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript** (strict)
- **Tailwind CSS v4** — semantic design tokens, dark-first with a live light theme
- **Framer Motion** — centralized, reduced-motion-aware motion system
- **Lucide** — the single icon system (no emoji icons)
- **Vitest** + Testing Library — foundation tests

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
| `npm run test`     | Foundation test suite                       |
| `npm run validate` | typecheck + lint + test + build             |

## Project structure

```
src/
├── app/            # Routes: / /pay /money /activity /profile (+ loading, error, 404)
├── components/
│   ├── ui/         # Design-system primitives (Button, Card, Sheet, Amount, …)
│   ├── shell/      # App chrome: header, bottom nav, sidebar, transitions
│   ├── home/       # Home composition (balance, actions, spaces, goals, feed)
│   └── money/      # Money tab components
├── design/         # Tokens, motion system, canonical navigation model
├── domain/         # Product vocabulary: user, family, wallet, ledger,
│                   # payments, goals, transactions, safety, notifications
├── data/           # Controlled mock data (the ONLY data source in Phase 1)
└── lib/            # Formatting (INR/paise), env conventions, classnames
tests/              # Formatting, domain invariants, components, pages
```

## Development principles

1. **Tokens, not hex codes** — every color comes from `globals.css` (`--tp-*`).
2. **One way to render money** — the `Amount` component, integer paise, tabular numerals.
3. **Domain types live in `src/domain`** — components never redefine them.
4. **Mock data stays honest** — sample figures ship with a visible "Sample data" marker.
5. **Accessibility is default** — labels, focus states, keyboard paths, reduced motion.
6. **Motion is purposeful** — fast and subtle, derived from `src/design/motion.ts`.
7. **No fake functionality** — unbuilt features open an honest "coming soon" sheet;
   they never pretend to act.

## Roadmap

- **Phase 1** (current): foundation, design system, shell, mock-data screens.
- **Phase 2**: real wallet & payment architecture (backend, ledger, rails).
