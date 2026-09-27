# TeenPay

A money platform for teenagers and their families — receive pocket money, manage a balance, save toward goals, and pay trusted people. TeenPay is designed for teens first: calm, clear, and safe, without asking a teenager to juggle a traditional bank account.

> **Status: Phase 7 — Pocket Money Autopilot (sandbox).**
> On top of Phase 6 (account-owned wallets, one append-only double-entry ledger, idempotent referenced operations, ledger-derived Money Spaces): a linked parent can schedule **recurring pocket money** — weekly or monthly, with a start and optional end date — that pays from the parent's wallet to the teen's through the same `postOperation` engine, one atomic `ALW-` operation per transfer day. Execution is explicit (no timers); each occurrence pays **at most once, ever**; low balances or frozen wallets fail an occurrence safely without moving money; pause, resume, cancel and end dates are first-class. Storage schema v6, migrated from every earlier phase.
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
    parent/       # Parent dashboard, rules form, one-off pocket money
    pocket-money/ # Pocket money schedules: parent section + form, teen card
    family/       # Family views, approval cards, rules summary, disconnect
    auth/         # Sign-in, create-account, auth gate + frame, sandbox notice
    sandbox/      # Sandbox role switcher + role gate
    profile/      # Profile sections (account, family, security, sandbox)
    notifications/# Notification bell + grouped notification center
    motion/       # Shared motion primitives
  domain/         # Domain types: user/account, family, permissions,
                  # security, money (validation), wallet, space,
                  # transaction, recipient, request, ledger,
                  # safety, approval, events, notification, allowance
  sandbox/        # The sandbox: engine, operations, rules, transitions,
                  # space-transitions, allowance-transitions,
                  # family-transitions, events,
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
- **`src/sandbox/transitions.ts`** — pure state transitions: `pay`, approvals, `createRequest`, `respondRequest` (only "paid" touches the ledger), `sendAllowance`, sandbox refunds, wallet freeze, notifications. Money Space transitions live in `space-transitions.ts` (Phase 6); recurring pocket money in `allowance-transitions.ts` (Phase 7).
- **`src/sandbox/store.tsx`** — the single client-side boundary. Components never touch localStorage or the ledger directly; they consume typed state and actions from `useSandbox()`. A future real backend can implement exactly this contract over an API.
- **Derived, never stored** — the available balance, every Money Space balance, goal progress, activity, the pending-requests list, and notification counts are all computed from ledger entries on render. There is no "current balance" field anywhere.
- **Money Spaces** — available = what can be spent; Spaces (Save, goals, custom) hold money set aside inside the same wallet; total = available + Spaces. Upcoming = pending requests (expecting money never increases the balance). See Phase 6.
- **Idempotency** — the Pay flow generates one idempotency key when you reach review; double-confirming replays it and can never create a second payment.
- **Persistence** — one versioned localStorage key (`teenpay-sandbox-v1`, schema v6 since Phase 7), validated and migrated on load. Unreadable data is backed up, never silently dropped (see Phase 4).
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

## Phase 7 — Pocket Money Autopilot

**Status.** Complete (sandbox). A linked parent can set up recurring pocket money that really moves (fictional) money on the sandbox ledger. There is still no bank, UPI, card, payment provider, recurring debit mandate, external scheduler or real money.

**Architecture.** One domain module and one transition module, on the existing engine.
- `domain/allowance.ts` — the schedule and run types, calendar maths on `YYYY-MM-DD` keys (Asia/Kolkata), the only plan validation (`validatePocketMoneyInput`), copy (`describePocketMoneyCadence`, status labels) and derived facts (`upcomingOccurrence`, `nextOccurrenceOf`).
- `sandbox/allowance-transitions.ts` — `createPocketMoneySchedule`, `updatePocketMoneySchedule`, `pause…`, `resume…`, `cancel…` and `executeDuePocketMoney`. Every transfer is an `allowanceRunDraft` posted through `postOperation`. There is no second ledger and no second engine.
- `sandbox/selectors.ts` — `selectSchedulesForParent`, `selectSchedulesForTeen`, `selectActiveSchedules`, `selectPausedSchedules`, `selectOpenSchedule`, `selectUpcomingPocketMoney`, `selectNextPocketMoney`, `selectScheduleSummary` (cadence, status, next date, total paid, successes, failures, last run), `selectScheduleHistory`, `selectPocketMoneyExecutions`, `selectPocketMoneyTotals` (received / sent, from ledger entries).
- Store actions (`useSandbox().actions`): `createPocketMoneySchedule`, `updatePocketMoneySchedule`, `pausePocketMoneySchedule`, `resumePocketMoneySchedule`, `cancelPocketMoneySchedule`, `executeDuePocketMoney`. Each returns a typed `SandboxResult`.

**Schedule model.** `id, familyId, parentAccountId, teenAccountId, sourceWalletId, destinationWalletId, amount` (whole rupees), `currency` (INR), `frequency weekly | monthly, dayOfWeek` (0–6), `dayOfMonth` (1–28, so every month has the day), `startDate, endDate?, nextRunAt` (00:00 IST of the next transfer day; null unless active), `status active | paused | completed | cancelled, endedReason?` (cancelled / family_disconnected / end_date_reached), `createdAt, updatedAt, lastRunAt?, createdBy, version, linkedAt` (the family link it was created under) and an append-only `runs[]`. A run is `{ id, occurrence, status completed | failed, amount, at, operationId?, reference?, reason?, message?, missed? }`. Money is never stored on the schedule: balances and totals come from the ledger.

**Execution.** Nothing runs on a timer. `executeDuePocketMoney({ asOf })` is called explicitly (the parent's "Process next transfer" sandbox control passes the next transfer day). For each active schedule of the acting parent that is due by `asOf`, it:
1. re-authorizes the parent;
2. picks the occurrence (see the missed policy);
3. checks both wallets and the parent's available balance;
4. posts one `allowance` operation, id `<scheduleId>:<YYYY-MM-DD>`, with a debit of the parent's wallet and a credit of the teen's, a stable `ALW-XXXXXXXX` reference, and the schedule id and occurrence on both legs;
5. records the run and advances `nextRunAt`;
6. notifies.

A run is "completed" only when `postOperation` accepted both legs. A scheduled credit reads **"Pocket money received"** ("Scheduled · From Priya") in Activity, and the parent's debit reads "Scheduled pocket money to Aarav". The transaction detail shows the reference, status and a **"Scheduled for"** row. Manual one-off pocket money is unchanged.

**Idempotency.** The execution id *is* the operation id, so one occurrence can only ever produce one operation: `postOperation` treats a same-fingerprint replay as a no-op and refuses anything else. A second call for a processed day finds the recorded run (or the operation) and reports `already_processed` without posting. This holds for a repeated call, a retry after success or failure, a refresh, a stale parent screen, a stale copy of the schedule and two attempts from the same snapshot. The create form generates one id per intent, so a double submit creates one schedule. Edits and lifecycle actions carry the version the screen loaded. A change made meanwhile is refused as `stale_schedule`, while repeating an action that is already in effect is a harmless no-op.

**Missed-schedule policy.** When several transfer days have passed without execution (the app was closed), only the **latest** due occurrence (on or before `asOf`, never past the end date) is paid, once. The skipped days are counted on that run (`missed`) and shown in the parent's history ("2 earlier days were missed and not paid"). They are never back-paid, which keeps a long absence from draining the parent's wallet in one go.

**Insufficient funds.** If the parent's available balance is below the amount, nothing is posted: no partial payment, no negative balance. The occurrence is recorded as **failed** with "Pocket money couldn't be sent because the parent's available balance was too low." It is **not retried**; the schedule stays active and moves on to the next transfer day. The parent is notified with that message. The teen gets a neutral "didn't arrive" and never sees the parent's balance reason (runs are redacted in the teen's view). A failed run is shown as "Not sent", never as received.

**Frozen wallets.** A frozen (or closed) **source** fails the occurrence the same way. For a frozen or closed **destination** the policy is also to fail that occurrence: nothing leaves the parent's wallet, there is never a single leg, and the money isn't parked anywhere. After unfreezing, the next transfer day pays normally.

**Pause, resume, cancel, edit, end date.**
- Pause stops execution (`nextRunAt` cleared); the schedule stays visible to both.
- Resume schedules the next valid occurrence from today and never back-pays paused days. If none remains before the end date, the schedule completes.
- Cancel ends it for good; its runs and ledger entries stay.
- Edits change future transfers only. The start date is fixed once a transfer has run.
- With an end date, the final eligible occurrence is paid, then the status becomes **"Schedule completed"**. Nothing is ever deleted.
- Disconnecting the family ends open schedules (`family_disconnected`), without a notification storm.

**Authorization.** Checked in the engine and again at the repository boundary; the UI role and client-sent ids are never trusted.
- Only an active parent, actively linked to the teen, may create a schedule. The payer comes from the session, and both wallets are derived: the source is the parent's own primary wallet, the destination the teen's. Any client-sent `parentAccountId`, `sourceWalletId`, `destinationWalletId` or other teen is rejected (`not_permitted`).
- Only the paying parent may edit, pause, resume, cancel or execute, and only under the same link it was created with.
- A teen can never create or modify a parent-funded schedule.
- Unrelated parents, other teens, a disconnected parent, unknown accounts and a signed-out stale screen are denied.
- The merge refuses writes to schedules the viewer doesn't pay, deleting a schedule, changing its parties or wallets, reopening an ended one, versions that don't move forward, and rewriting run history. The one teen write it accepts is the cancellation their own disconnect performs.

**Balances and rules.** Pocket money lands in the teen's **available** balance and is never auto-allocated to a Space. It is income, so it doesn't count toward the daily spending limit. Moving part of it into a Space is a separate `SPC-` operation.

**Screens.**
- **Parent → Pocket money** (on the parent page):
  - the schedule card shows amount, cadence, status, the next transfer, sent so far, "Your wallet · ₹X available" and the end date;
  - Edit / Pause or Resume / Cancel schedule (with confirmation);
  - a clearly labelled sandbox "Process next transfer" control;
  - a history of scheduled transfers (amount, teen, date, reference, Completed / Not sent) and past schedules;
  - "Create pocket money" opens a dialog with Amount, How often, Day, Start date and End date (optional), plus a preview (amount, frequency, From, To, first and next transfer). The preview says nothing moves now.
  - The one-off "Send once" form stays below.
- **Teen → Family**: a read-only card with amount, cadence, "from Priya", status, next date (or paused), recent receipts (Received / Not sent) and total received.
- **Teen → Home**: a compact "Next pocket money" line, shown only when one is scheduled.

**Notifications.**
- The parent: sent, not sent (with the reason), paused, resumed, completed.
- The teen: scheduled / updated / stopped, paused, resumed, received, didn't arrive, completed.
- Each is keyed to its event id, so a replay adds nothing.

**Persistence.** Schema **v6** adds `pocketMoneySchedules`. On load v1 → … → v5 → v6 runs automatically, with the original payload backed up first. Each Phase 3–6 "recurring pocket money preview" saved on a teen's controls becomes a **paused** schedule (`pms_legacy_<teen>`): same amount and day, starting on the migration day, and never paid until the parent resumes it. It is skipped if the family is unlinked or the values are invalid. The old field is removed; the backup keeps it. The v6 validator refuses malformed or inconsistent data: bad fields, duplicate ids, two open schedules for one pair, completed runs without their ledger operation (or disagreeing with it), failed runs that point at money, and scheduled ledger entries without a recorded run. Such data is backed up and replaced by the seed. The seed has no schedules (the family starts unlinked). **Reset** is deterministic.

**Tests** (`npm test`): 421 in total (32 files). Phase 7 adds 72:
- `pocket-money-engine.test.ts` — domain calendar and validation, create, execution, idempotency, missed policy, insufficient funds, frozen source and destination, end date, pause/resume/cancel/edit, disconnect, balances, daily limit, Activity, notifications and selectors;
- `pocket-money-security.test.tsx` — the repository boundary, forged records, teen redaction, and stale signed-out or switched-account screens;
- `pocket-money-persistence.test.ts` — v5 → v6, reload, tampering, reset;
- `pocket-money-ui.test.tsx` — create, validation, process, stale calls, pause/resume, edit, stale edit, cancel, failure display, the teen card and Home;
- `phase7-journey.test.tsx` — a 28-step journey through the real app.

All earlier tests were kept. The ones built on the old schedule preview now assert the same guarantees on the real schedule: "Every Monday" / "On the 1st of every month" copy, next dates, "Pocket money scheduled", day 31 rejected, teen denied, preview with no money moved, "No schedule set" and the parent's create button. Tests that pinned schema v5 now expect v6.

**Limitations.** Sandbox only, one device, no sync. There is no background execution: occurrences run when the parent triggers them. A production system would run `executeDue` from a trusted server scheduler with the same idempotency key. Only weekly and monthly (days 1–28) are supported, with one open schedule per parent and teen and a fixed ₹10,000 per-transfer sandbox cap. There are no split allocations into Spaces and no teen-initiated requests to change pocket money.

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
- **Phase 6** — Money Spaces: default Save, goals with target/date, custom spaces, ledger-derived Space balances, available vs allocated money, idempotent `SPC-` moves, archive with history, private-by-default Space details, schema v5 migration
- **Phase 7 (this)** — Pocket Money Autopilot: weekly/monthly schedules from a parent's wallet to a linked teen's, explicit idempotent execution (one `ALW-` operation per transfer day), missed-day and insufficient-funds policies, freeze safety, pause/resume/cancel/end date, parent and teen screens, schema v6 migration
- **Later (recommendation only)** — a real auth provider behind `AuthService` and a cloud repository behind the repository contract, then real payment rails with a regulated provider
