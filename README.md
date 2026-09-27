# TeenPay

A money platform for teenagers and their families — receive pocket money, manage a balance, save toward goals, and pay trusted people. TeenPay is designed for teens first: calm, clear, and safe, without asking a teenager to juggle a traditional bank account.

> **Status: Phase 6 — Money Spaces & goals (sandbox).**
> On top of Phase 5 (account-owned wallets, one append-only double-entry ledger, idempotent operations with references, wallet freeze): **Money Spaces** — a default Save, goals with a target and optional date, and custom spaces — whose balances are **derived from the same ledger** (no second ledger, no stored balance). Moving money in or out is an idempotent, referenced (`SPC-`) operation through `postOperation`; only **available** money can be spent; a guardian sees totals, never a teen's Space details; storage schema v5, migrated from every earlier phase.
>
> **No real authentication provider is active.** "Continue as Teen / Parent" starts a sandbox session on this device — no password, no OTP, no verification.
>
> **No real money — ever.** This is a product sandbox. There are no bank accounts, no UPI, no KYC, no payment providers, and no real transactions of any kind. Every identity (Aarav, Priya, friends) is fictional, every move is simulated, and everything is stored only in your browser. Screens are honestly marked "Sandbox".

## Technology stack

- **Next.js 15** (App Router) + **React 19**
- **TypeScript** (strict, `noUncheckedIndexedAccess`)
- **Tailwind CSS v4** with a centralized semantic token system (dark-first, light-ready)
- **Framer Motion** (fast, subtle, reduced-motion aware)
- **lucide-react** (single, consistent icon system)
- **ESLint 9** (flat config) + **Vitest** & Testing Library (+ user-event)

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Only when you add real configuration later:

```bash
cp .env.example .env.local
```

### Scripts

| Command             | Purpose                                |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Start the dev server                   |
| `npm run build`     | Production build                       |
| `npm run start`     | Serve the production build             |
| `npm run lint`      | ESLint                                 |
| `npm run typecheck` | `tsc --noEmit`                         |
| `npm run test`      | Vitest (engine, store, flows, UI, tokens) |
| `npm run check`     | typecheck + lint + tests + build       |

## Project structure

```
src/
  app/            # Routes: /, /pay, /money, /money/[spaceId], /activity, /family,
                  # /profile, /parent, /sign-in, /create-account
  auth/           # Auth abstraction: types, AuthProvider/useAuth, sandbox service
  components/
    ui/           # Primitives: Button, Card, Input, Modal, AmountDisplay, …
    layout/       # AppShell, SideNav (desktop), TabBar (mobile), headers
    home/         # Home screen sections (balance, quick actions, spaces, …)
    pay/          # Pay flow: recipient picker, amount input, step machine
    activity/     # Ledger-derived feed, request cards, transaction detail
    money/        # Money screen (available, spaces, space activity, actions)
    spaces/       # Space card, detail, create/edit, add/move back, archive
    wallet/       # Wallet status card (freeze), frozen banner, balance announcer
    parent/       # Parent dashboard, rules + schedule forms
    family/       # Family views, approval cards, rules summary, disconnect
    auth/         # Sign-in, create-account, auth gate + frame, sandbox notice
    sandbox/      # Sandbox role switcher + role gate
    profile/      # Profile sections (account, family, security, sandbox)
    notifications/# Notification bell + grouped notification center
    motion/       # Shared motion primitives
  domain/         # Domain types: user/account, family, permissions,
                  # security, money (validation), wallet, space,
                  # transaction, recipient, request, ledger,
                  # safety, approval, events, notification
  sandbox/        # The sandbox: engine, operations, rules, transitions,
                  # space-transitions, family-transitions, events,
                  # identity, seed, scope,
                  # authorization, accounts, selectors, persistence,
                  # repository, and the React store
  lib/            # Small shared helpers (cn, currency, format, ids, nav)
```

## Sandbox & ledger architecture

Everything financial in the app follows one rule: **the ledger is the only source of truth, and everything else is derived from it.**

```
UI actions ──▶ store (useSandbox) ──▶ pure transitions ──▶ validate ──▶ ledger
   ▲                                                                              │
   └──────────── derived selectors ◀─────────────────────────────────────────────┘
```

- **`src/sandbox/engine.ts`** — pure, side-effect-free rules: whole-rupee positive amounts (one check in `domain/money.ts`), the ₹10,000 per-move sandbox cap, INR only, type/direction/counterparty consistency, and the per-wallet no-negative-balance rule. Entries are frozen and appended idempotently.
- **`src/sandbox/operations.ts`** — `postOperation`, the only way to write ledger entries (Phase 5, below).
- **`src/sandbox/transitions.ts`** — pure state transitions: `pay`, approvals, `createRequest`, `respondRequest` (only "paid" touches the ledger), `sendAllowance`, sandbox refunds, wallet freeze, notifications. Money Space transitions live in `space-transitions.ts` (Phase 6).
- **`src/sandbox/store.tsx`** — the single client-side boundary. Components never touch localStorage or the ledger directly; they consume typed state and actions from `useSandbox()`. A future real backend can implement exactly this contract over an API.
- **Derived, never stored** — the available balance, every Money Space balance, goal progress, activity, the pending-requests list, and notification counts are all computed from ledger entries on render. There is no "current balance" field anywhere.
- **Money Spaces** — available = what can be spent; Spaces (Save, goals, custom) hold money set aside inside the same wallet; total = available + Spaces. Upcoming = pending requests (expecting money never increases the balance). See Phase 6.
- **Idempotency** — the Pay flow generates one idempotency key when you reach review; double-confirming replays it and can never create a second payment.
- **Persistence** — one versioned localStorage key (`teenpay-sandbox-v1`, schema v5 since Phase 6), validated and migrated on load. Unreadable data is backed up, never silently dropped (see Phase 4).
- **Reset** — **Profile → Reset sandbox data** (with confirmation) restores the initial state: ledger, requests, notifications, and balances. Your theme preference is kept.
- **Fictional family** — teen Aarav Sharma (`@aarav`), parent Priya Sharma (`@priya`). See Phase 3 below.

### Honest sandbox indicators

Every financial screen carries a quiet "Sandbox" badge, flows state "sandbox payment / sandbox request / sandbox transaction", and recipients are labeled fictional. The app never suggests real money moves.

## Phase 3 — family linking & guardian controls

Everything below is sandbox-only: fictional people, no sign-in, no verification, no legal consent, nothing sent anywhere.

**Identity & session.** `domain/user.ts` models a `User` (id, role `teen | parent`, name, displayName, username, avatar initials, status, `identitySource: "sandbox"`, createdAt) so a real auth provider can later populate the same shape. `state.session.currentUserId` says whose view is active. **Profile → Sandbox → Sandbox role** switches between Aarav (Teen) and Priya (Parent); it is labelled as a demo control, never creates a new family or ledger, and teen-only / parent-only screens explain themselves and offer the switch (`RoleGate`).

**Family & linking.** `Family` holds members, one `GuardianLink` per teen (multi-teen-ready) and per-teen `GuardianControls`. Link states: `not_linked → invitation_created → invitation_pending → linked → disconnected`. Teen: **Family → Connect parent** creates a fictional code (`TEEN-4821` style). Parent: **Family → Add teen → Find teen → review → Connect**. Disconnect asks first, cancels pending approvals and removes controls — it never touches ledger history. The seed starts unlinked.

**Guardian controls** (only while linked, always visible to the teen in Family): daily limit, per-payment limit, "ask me first" approval threshold, notification preferences, and a pocket-money schedule (e.g. "₹500 · Every Monday", with a next-date preview — nothing auto-sends; there is no scheduler). These are family rules, separate from the ₹10,000 technical sandbox cap.

**Payment decision** (`sandbox/rules.ts → evaluatePayment`, one pipeline for the Pay UI, the store, and approval execution):

1. amount (positive whole rupees, ≤ ₹10,000) → 2. recipient → 3. available balance → 4. per-payment limit → 5. approval threshold (strictly above → **approval request**, no money moves) → 6. daily limit (Asia/Kolkata calendar day) → 7. execute through the ledger engine.

Design decision: payments above the threshold are decided by the parent, so an **approved** payment skips the approval rule and the daily-limit check (the parent's decision is the permission) but re-checks amount, balance and the per-payment ceiling at approval time — and it still counts toward today's total. That is why, with ₹500/day and approvals above ₹500, a ₹750 payment becomes an approval rather than a rejection.

**Approvals.** `ApprovalRequest` (teen, guardian, amount, recipient, note, status `pending | approved | declined | cancelled`). Approving executes the payment exactly once — the approval id derives from the payment's idempotency key and a double approve is a no-op. Decline or cancel moves no money. Pending approvals appear in Home, Activity and Family, never as ledger activity.

**Events & notifications.** Transitions emit small domain events (`family_linked`, `family_unlinked`, `spending_limit_updated`, `approval_requested`, `approval_approved`, `approval_declined`, `allowance_sent`, …). One projector (`sandbox/events.ts`) turns them into per-recipient notifications and a capped family log (Activity → Family updates). The notification center groups Money / Family / Approvals with unread counts, mark-read and mark-all-read; notifications never affect money.

**Persistence.** State schema v2 in the same key (now v3 — see Phase 4); Phase 2 (v1) data is migrated on load. Role, links, controls, approvals and notifications survive refresh; **Reset** restores the deterministic seed (unlinked, teen role).

**Limitations.** Single shared ledger for the seeded teen (multi-teen is modelled, not exercised); one device, no sync; invite codes are four random digits, local to this device; schedules are previews; no real identity, consent, or verification of any kind.

## Phase 4 — authentication, accounts & secure cloud foundation

Still a sandbox: **no real authentication provider is active**, no credentials exist anywhere, and nothing leaves the browser.

**Architecture.** App → Auth → Account → Family → Data → Sandbox financial domain.

```
UI ──▶ useAuth() ──▶ AuthService (sandbox today)      session: who is acting
UI ──▶ useSandbox() ──▶ scope + authorize ──▶ transitions ──▶ Repository (local today, cloud later)
```

- **Auth abstraction** (`src/auth`). Components only use `useAuth()`. `AuthService` is the provider seam; `createSandboxAuthService` is the only implementation and declares `isRealAuthentication: false, usesCredentials: false`. It is labelled **"Sandbox session"** everywhere.
- **Session** — `{ sessionId, accountId, role, provider, assurance: "sandbox_unverified", createdAt, expiresAt }` (8 hours). States: `restoring → signed_out → authenticating → authenticated → expired → signed_out`. Missing or malformed session data means signed out. It is stored under its own key (`teenpay-session-v1`) and holds no tokens or secrets.
- **Routes** — `/sign-in` ("Continue as Teen / Parent" plus other sandbox accounts) and `/create-account` (your name, TeenPay ID, role; nothing else). Protected routes redirect to `/sign-in?next=…` and return you there afterwards. Expiry shows "Your session has expired. Please sign in again."
- **Sign out** ends the session only; all data stays. **Profile → Security** shows the active session, sign out, a sandbox "expire session now" control, and **Request account deletion**. That is a placeholder that records the request and deletes nothing, least of all financial history.
- **Role switching** (**Profile → Sandbox**) stays a demo control. It switches the sandbox session to the other family member, and it is never presented as signing in.

**Accounts.** `id, identifier (sandbox:<username>; no email/phone collected), name, displayName, username, role, status, createdAt, updatedAt`. `familyMembership` is derived from the family (`accountProfile()`), never stored twice. TeenPay IDs (`@aarav`) are normalized to lowercase, 3–20 characters, start with a letter, allow letters/digits/`_`/`.`, and must be unique and not reserved. A new teen account gets its own family and wallet. Many accounts, families and teens are supported; the seed is still Aarav and Priya.

**Family authorization.** Memberships are `{ accountId, familyId, role, relationship, status: pending | active | removed, createdAt }`. Removed memberships are kept as history. Invitations are records (`id, familyId, inviter, intended relationship, code, createdAt, expiresAt, status`) that expire after 48 hours. Every action runs **account → active membership → family access → permission** (`sandbox/authorization.ts`) inside the engine; the UI role is never trusted. The permissions are small and typed:
  - Parent: view teen overview, manage rules, configure allowance, approve payments.
  - Teen: view own money, initiate payments, request money, view family rules.

UI hints use the same helpers (`canViewTeenOverview`, `canManageSpendingRules`, `canApprovePayment`, `canInitiatePayment`). Each viewer gets a scoped view: a teen's wallet is visible only to that teen and linked guardians, and notifications are per account.

**Data layer.** Data is split by owner: account (profile, username), family (memberships, invites, links, controls), teen wallet (ledger, payments, requests, approvals, goals) and notifications. Security events are lightweight: `sign_in`, `sign_out`, `session_expired`, `family_invite_created`, `family_member_linked`, `family_member_removed`, and account creation/deletion requests. The store talks to a `SandboxRepository` (`createLocalRepository` / `createMemoryRepository`); a cloud repository can implement the same `load/save/reset` contract. Components never touch storage.

**Migration.** Phase 2 (v1) → Phase 3 (v2) → Phase 4 (v3) runs automatically on load. If stored data can't be read, the original is copied to `teenpay-sandbox-backup`, the app starts from the seed, and it explains what happened. Financial state is never partially rewritten.

**Security limits.** No real identity, passwords, OTP, KYC, or verification. localStorage holds only sandbox data and a sandbox session. Anyone using this browser can continue as any sandbox account. Nothing syncs between devices. There is one family per session view.

## Phase 5 — wallet & ledger core

Still a sandbox: **no UPI, bank accounts, cards, payment gateway, real deposits, withdrawals or settlement, and no KYC, Aadhaar or PAN.** Every rupee is fictional and stays in this browser.

**Chain.** Account → Wallet → Ledger → Balance → Activity.

```
UI ─▶ useSandbox().actions ─▶ authorize ─▶ money check ─▶ rules ─▶ approval decision
                                                                      │ (pending: no money)
                         notifications ◀─ domain events ◀─ ledger ◀─ postOperation
UI ◀─ selectors (getWallet, getBalance, listTransactions, getTransaction, …) ◀─ ledger
```

**Wallets** (`domain/wallet.ts`). `{ id, ownerAccountId, kind: "primary", currency: "INR", status: active | frozen | closed, createdAt, updatedAt }`. Every account owns its own wallet (there is no global wallet), and the model is ready for several wallets per account. Parents have wallets too: pocket money now leaves the parent's wallet and arrives in the teen's. Seed: Aarav ₹1,850 available and Priya ₹5,500. New parents get ₹10,000 of labelled *sandbox funds*; new teens start at ₹0.

**Ledger** (`domain/ledger.ts`, `sandbox/operations.ts`).
- Each entry has `walletId`, `accountId`, `type`, `amount`, `currency`, `direction`, `status`, `reference`, `operationId`, `createdBy` and `createdAt`, plus optional links (`approvalId`, `relatedEntryId`, goal/request).
- Types stay few: deposit, payment sent/received, transfer in/out, allowance debit/credit, save/goal allocation, refund, reversal and adjustment.
- Every movement is a **`MoneyOperation`** posted by `postOperation`, the single write path. An operation has one or two balanced wallet legs; a transfer's two legs are written together or not at all. Legs outside the sandbox (a fictional recipient, sandbox funds) are recorded on the operation.
- The operation *is* the audit record: id, actor, wallets, amount, currency, time, type, reference and related operation.

**Immutability.** There is no update or delete function. Entries are frozen objects, and the repository merge rejects any change to or removal of an existing entry or operation (`LedgerIntegrityError`). Corrections are new, linked entries: a **refund** credits against a payment (partial refunds are allowed, never more than was paid), and a **reversal** exactly undoes an untouched entry. A transaction's status is derived: a fully compensated entry shows as Refunded or Reversed, and a partly refunded one says so. A completed entry never becomes "failed". Pending approvals are not ledger entries.

**Balances** are always `sum(credits) − sum(debits)` of one wallet's entries. No balance is stored anywhere, and no wallet can go below zero. Home, Money, Activity and the parent dashboard read the same selectors, so they always agree. The daily limit counts only **completed payments from that wallet**. Refunds don't give limit back.

**Idempotency.** Every operation id is an idempotency key generated once per user intent:
- Pay: when review opens.
- Pocket money: per send.
- Save/goal moves: when the sheet opens.
- Refunds: `ref_<entry>_full`.
- Approvals: the payment id is fixed when the request is made.

Replaying the same key with the same content is a no-op returning the original result. The same key with different content is refused (`duplicate`). A double click, retry, refresh or stale screen therefore moves money at most once. References are stable per operation and unique (`PAY-7K2M9QXA`).

**Wallet states.** *Active*: money moves. *Frozen*: balance, activity and history stay visible, but payments, transfers, pocket money, savings moves and approval execution are refused with a clear message. *Closed*: history only.
- Freeze and unfreeze are domain operations (sandbox safety controls, not card or bank freezes).
- The teen may freeze their own wallet and lift their own freeze. A linked guardian can do both, and a guardian's freeze can only be lifted by a guardian.
- Both sides are notified (`wallet_frozen` / `wallet_unfrozen`).

**Approvals** run one pipeline: authorization → money validation → rules → approval decision → ledger → balance → activity → notification. Executing an approval re-checks the family link, that the request is still pending, that the teen exists, the amount, wallet status, balance and per-payment limit. It posts the fixed payment id exactly once, marks the approval approved, then emits events. A second approve is a no-op.

**Events → notifications.** Typed domain events (`payment_sent`, `allowance_sent`, `refund_received`, `wallet_frozen`, `wallet_unfrozen`, `approval_requested`, `approval_approved`, `approval_declined`, …) are emitted only after a successful write and projected into notifications. Notifications never touch money. A failed operation writes nothing and notifies nobody.

**Access.** Scoping happens in the repository layer (`scopeFor`):
- A viewer gets their own wallet, plus a teen's wallet only if they are that teen or the teen's linked guardian.
- Teen B, a parent in another family, an unlinked or removed guardian, and a signed-out user all see nothing of Aarav's wallet and can't write to it. A write that targets a wallet outside the scope is rejected even if a transition produced it.

**Queries** (`sandbox/selectors.ts`): `getWallet`, `getBalance`, `listWalletEntries`, `listAccountEntries`, `listTransactions`, `getTransaction` (detail: amount, direction, status, type, reference, date, from/to, wallet, description, approval, refunds), `selectIncoming`, `selectOutgoing` and `selectDailySpending`. The UI never filters raw ledger arrays.

**Screens.**
- **Money**: wallet card (available balance, status in words with an icon, freeze/unfreeze behind a confirmation), totals, the unchanged Money Spaces, and recent activity.
- **Home**: a frozen banner when relevant.
- **Activity**: grouped as Today / Yesterday / dated days, with a detail sheet showing the reference and, for payments, a clearly labelled *Sandbox: simulate refund*.
- **Parent**: the teen's wallet status and freeze control, and pocket money sent from the parent's own wallet (its balance is shown).
- Balance changes are announced politely to screen readers (not on first render).

**Persistence.** Schema **v4**. On load, v1 → v2 → v3 → v4 run automatically:
- Every account gets its wallet.
- Legacy entries gain wallet, account, operation, reference and status.
- Legacy pocket money is recorded as sandbox funding, so no balance changes.
- Parents receive sandbox starting funds.

The original payload is backed up first, and unreadable data follows the existing backup-and-explain path. **Reset** restores the deterministic seed: wallets, ledger and operations exactly, with no orphans. **Deletion requests** keep every wallet, entry and operation. Storage holds no secrets. The store only talks to `SandboxRepository`, so a future `CloudLedgerRepository` can implement the same contract without the UI knowing.

**Tests** (`npm test`): 276 at the end of Phase 5, which added 66 of them:
- `wallet-ledger.test.ts`: money validation, wallets and freeze, ledger immutability and no-negative, payments, transfers and pocket money, refunds, approvals, lifecycle and audit.
- `wallet-isolation.test.tsx`: teen vs teen, other family, unlinked/removed guardian, signed-out stale UI, and repository merge guards.
- `wallet-migration.test.ts`: v3 → v4.
- `phase5-journey.test.tsx`: a 25-step money journey through the real auth and store providers, plus screen checks.

**Limitations.** Sandbox only, with no money provider of any kind. One device, no sync. One primary wallet per account (multi-wallet is modelled, not exposed). General wallet-to-wallet transfers exist in the engine (pocket money uses them) but have no screen of their own. Refunds are simulated by the teen. The parent's funds are fictional sandbox funds.

## Phase 6 — Money Spaces & goals

**Status.** Complete (sandbox). Save, goals and custom spaces are real, ledger-backed allocations inside a teen's wallet. There is still no real money, UPI, bank, card, payment gateway or KYC — every rupee here is fictional and stays in your browser.

**Architecture.** One domain module and one transition module; nothing parallel.
- `domain/space.ts` — the `MoneySpace` record (`id, ownerAccountId, walletId, name, type save | goal | custom, icon, targetAmount?, deadline?, status active | archived, displayOrder, isDefault?, createdAt, updatedAt, archivedAt?`), the only validation (`validateSpaceDraft`: name, target, date, icon), and the derived maths (`spaceProgress`, `deadlineInfo`, `deadlineLabel`). It replaces the old `money-space.ts` and `goal.ts`.
- `sandbox/space-transitions.ts` — `createSpace`, `updateSpace`, `moveSpaceMoney` (add / move back) and `archiveSpace`. Every money movement goes through `postOperation`.
- `sandbox/selectors.ts` — the query API: `selectSpaces`, `selectActiveSpaces`, `selectArchivedSpaces`, `getSpace`, `selectSaveSpace`, `getSpaceBalance`, `getSpaceProgress`, `getSpaceRemaining`, `listSpaceEntries`, `selectSpaceActivity`, `selectRecentSpaceActivity`, `selectMoneySummary`, `selectAllocatedTotal`, `selectAvailableBalance`, `selectTotal`. Space views are memoized per ledger, Space list and day.
- Store actions (`useSandbox().actions`): `createSpace`, `updateSpace`, `archiveSpace`, `addToSpace`, `withdrawFromSpace`. Each returns a typed `SandboxResult`.

**Accounting model.** A Space has **no balance field**. Its balance is the sum of the wallet's `space_allocation` entries for it (money moved in, a debit of available) minus its `space_release` entries (money moved back, a credit). Both are ordinary, immutable ledger entries of a `space` operation. They carry the Space id and a stable `SPC-XXXXXXXX` reference (never a payment reference). `postOperation` checks every Space leg:
- the Space exists, belongs to that wallet and its owner, and is active;
- the counterparty matches;
- the amount is positive and whole-rupee;
- available money can't go negative;
- a Space can't be overdrawn;
- the wallet isn't frozen.

A replay of the same operation id is a no-op. The same id with a different amount, Space or direction is rejected as a conflict.

**Available balance semantics.** `total = available + allocated`. The wallet balance *is* available money, so payments, transfers, approvals and daily limits automatically respect allocations: with ₹1,850 available and ₹2,300 in Spaces (total ₹4,150), the most you can pay is ₹1,850. Moving money back makes it spendable again. Money Space moves are not "money in" or "money out" (the parent's in/out totals exclude them) and can't be refunded or reversed as payments.

**Goals and progress.** Goals need a target (₹1–₹1,00,000). They may have a target date (a real date, today or later, within 10 years). Progress is derived as current, remaining and percentage, with one decimal rounded down (₹750 of ₹2,000 → **37.5%**), so it never shows 100% early.
- Adding to a goal stops at its target, and reaching it sends a "Goal reached" notification. Save and custom spaces may go past an optional target.
- Deadlines show the date and the time left. A passed date reads a neutral **"Target date passed"**.
- Nothing ever moves automatically, and nothing promises an outcome.
- Zero or negative targets, a target below what's already saved, invalid or past dates, duplicate names (case-insensitive, among active spaces), and names over 30 characters are rejected with human messages, inline in the form and again in the engine.
- There are at most 12 active spaces per account.

**Archiving.** Archiving never deletes or hides money. Any balance is first moved back to available in the same atomic step, as a normal referenced `space_release`. Then the Space is marked archived. Its history stays on its page, in Activity and in the ledger, and it can't take money or be edited. The default Save can't be archived. On a frozen wallet, a Space that still holds money can't be archived (that would move money); an empty one can.

**Idempotency.** Each sheet generates one key per intent: the create key becomes the Space id (and `<id>_start` names the starting-amount move), and add / move back / archive each have their own key. A double click, a retry or a refresh re-submits the same key and changes nothing. A failed attempt records nothing, so the corrected attempt uses a fresh key.

**Authorization and privacy.** Only the owner can create, edit, move money in or out of, or archive their Spaces. Guardians get `not_permitted`; anyone else gets "This Money Space isn't available." (`unknown_space`), so ids are never confirmed. Scoping happens in the repository layer:
- another account's view never contains your Spaces;
- a linked guardian sees the teen's available and allocated totals, but Space entries arrive **redacted** ("Money Space", no id, name or target);
- an opted-in guardian's notification says only "Aarav set aside ₹250 in a Money Space.";
- the merge rejects writes to Spaces the viewer doesn't own, deleting a Space, moving it to another wallet, or reusing an id;
- teen B, another family's parent, a disconnected parent and a signed-out (stale) screen are all denied (tested at the repository boundary and in the store).

No new guardian permission was added.

**Errors.** `insufficient_balance` (available), `insufficient_space_balance`, `invalid_amount`, `unknown_space` (not found / not yours), `space_archived`, `wallet_frozen`, `not_permitted` / `not_signed_in`, `duplicate` (conflicting key), `invalid_target`, `invalid_deadline`, `exceeds_space_target`, `space_limit_reached`. Each has a human message, and a `field` when it belongs to a form field.

**Screens.**
- **Money** (in this order): the wallet and how the money splits (Available / In spaces / Total); Money Spaces (cards with an accessible progress bar, the date, Add and Move back, and an "Archived (n)" toggle); recent space activity; Plan ahead (New goal / New space).
- **`/money/[spaceId]`**: balance, target, progress, date, total added and moved back, real activity, and Add money / Move back / Edit / Archive. Unknown or other accounts' ids show a neutral "not available".
- **Home**: only a compact summary ("₹2,300 set aside in 2 spaces", up to three linked spaces, View all).
- **Activity**: "Added to Save" / "Moved from Save" rows; the transaction detail shows the reference and links to the Space.
- **Frozen wallet**: moves are disabled with the reason in words; balances and history stay visible.

Progress bars expose `aria-valuetext` ("₹1,500 of ₹2,500, 60%"), and balance changes are announced politely. Status never relies on colour alone. Lucide icons only, no emoji.

**Persistence.** Schema **v5** (a `spaces` list; entry types `space_allocation` / `space_release`). On load v1 → … → v4 → v5 runs automatically, with the original payload backed up first:
- each teen gets a default Save (`spc_save_<account>`);
- each goal record becomes a goal Space with the same id, target and a parsed date ("Nov 30" → 2026-11-30, unreadable → no date);
- `save_allocation` / `goal_allocation` entries become `space_allocation` entries naming their Space. Ids, amounts, dates and references are unchanged; no entry is added or removed, so every balance is identical;
- an allocation whose goal record is missing gets a custom Space, so its money stays visible.

The v5 validator refuses tampered data (entries naming unknown or foreign Spaces, Space ids on non-Space entries, Spaces on another account's wallet, a Space going below ₹0, bad targets, dates or icons, duplicate ids). That data is backed up and replaced by the seed, never loaded. **Reset** is deterministic.

**Seed.** Aarav: available ₹1,850; Save ₹800 of a ₹2,000 target (40%); goal "New Bike" ₹1,500 of ₹2,500 (60%, target date 30 Nov 2026). Allocated ₹2,300, total ₹4,150, every entry posted through `postOperation`. Priya: ₹5,500. New teens start with an empty Save.

**Tests** (`npm test`): 349 in total (27 files). Phase 6 adds 73: `money-spaces.test.ts` (domain, money, idempotency, create/edit/archive, frozen, guardian notification), `money-spaces-isolation.test.tsx` (repository boundary and stale signed-out screen), `money-spaces-persistence.test.ts` (v4 → v5, tampering, reload, reset), `money-spaces-ui.test.tsx` (Money, Home, detail, create/add/move back/archive, validation, a11y) and `phase6-journey.test.tsx` (a 15-step journey through the real app, plus a second account denied). All earlier tests were kept; those that asserted the old Save/goal entry types or copy were updated to the new model.

**Limitations.** Sandbox only. One device, no sync. Spaces can't be reordered in the UI yet (`displayOrder` is modelled). There are no shared or family Spaces, no recurring or automatic moves, and no interest. A guardian sees only totals — there is no opt-in sharing of Space details yet.

## Design system

All styling flows from the semantic tokens in `src/app/globals.css`:

- **Surfaces:** `bg`, `surface`, `surface-2`, `surface-3`
- **Lines:** `line`, `line-strong`
- **Text:** `ink`, `ink-muted`, `ink-faint`
- **Brand:** `accent`, `accent-strong`, `on-accent`
- **States:** `success`, `warning`, `danger`

Components never hard-code colors — they use the semantic utilities generated by the `@theme` block. Dark is the default theme; the light theme is already wired through `[data-theme="light"]` and is toggleable in **Profile → Appearance**.

Money is rendered exclusively through `AmountDisplay` (tabular numerals, INR formatting), so every number in the app stays aligned and consistent. Dates are rendered in the product timezone (Asia/Kolkata) with absolute labels, keeping server and client output identical.

## Development principles

1. **Sandbox is honest.** No screen may imply that real money moves.
2. **Ledger over state.** Financial invariants live in the engine, not the UI.
3. **Teens and parents are different roles.** The domain model keeps them distinct.
4. **Tokens before colors.** Style with semantic utilities, never raw values.
5. **Accessible by default.** Semantic HTML, keyboard paths, visible focus, reduced motion.
6. **Small abstractions, real boundaries.** The store contract is where a real backend plugs in.
7. **No secrets in code.** Configuration comes from environment variables (see `.env.example`).

## Phase roadmap

- **Phase 1** — foundation, design system, app shell, demo Home
- **Phase 2** — local ledger engine, ledger-aware money spaces, Pay/Request flows, parent/guardian allowance + basic parent view, derived activity & notifications, local persistence & reset
- **Phase 3** — sandbox identities & role switcher, invite-code family linking, parent dashboard, spending limits, approvals, allowance schedules, event-driven notifications
- **Phase 4** — auth abstraction + sandbox sessions, sign-in/create-account, accounts & usernames, memberships & expiring invites, central permissions, repository layer, schema v3 migration
- **Phase 5** — account-owned wallets, append-only double-entry ledger, idempotent operations with references, derived balances and transaction queries, wallet freeze, sandbox refunds, repository-level wallet isolation, schema v4 migration
- **Phase 6 (this)** — Money Spaces: default Save, goals with target/date, custom spaces, ledger-derived Space balances, available vs allocated money, idempotent `SPC-` moves, archive with history, private-by-default Space details, schema v5 migration
- **Later (recommendation only)** — a real auth provider behind `AuthService` and a cloud repository behind the repository contract, then real payment rails with a regulated provider
