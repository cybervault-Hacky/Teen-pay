# TeenPay

A money platform for teenagers and their families — receive pocket money, manage a balance, save toward goals, and pay trusted people. TeenPay is designed for teens first: calm, clear, and safe, without asking a teenager to juggle a traditional bank account.

> **Status: Phase 11 — Money Missions (sandbox).**
> On top of Phase 10 (account-owned wallets, one append-only double-entry ledger, idempotent referenced operations, ledger-derived Money Spaces, recurring pocket money, teen-to-teen transfers and requests, TeenPay QR and favourites, and the read-only Money Coach): teens get **Money Missions** — ten short, optional learning missions about their own money (balances, Spaces, goals, pocket money, sending vs requesting, payment safety, Activity, transactions and the Coach). **Missions are for learning only:** they never move money, never need spending, pay no rewards and have no streaks, timers or reminders. Progress is derived deterministically on the device and saved in the same sandbox database (optional `missionProgress`, storage schema v8 unchanged). It's private to the teen.
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
  app/            # Routes: /, /pay, /send, /request, /requests, /money,
                  # /money/[spaceId], /qr, /qr/scan, /contacts, /coach,
                  # /missions, /missions/[missionId], /activity,
                  # /family, /profile, /parent, /sign-in, /create-account
  auth/           # Auth abstraction: types, AuthProvider/useAuth, sandbox service
  components/
    ui/           # Primitives: Button, Card, Input, Modal, AmountDisplay, …
    layout/       # AppShell, SideNav (desktop), TabBar (mobile), headers
    home/         # Home screen sections (balance, quick actions, spaces, …)
    pay/          # Pay flow: recipient picker, amount input, step machine
    peer/         # TeenPay send/request flow, peer search, Requests center
    qr/           # QR code (SVG), My QR screen, camera scanner, scan screen
    contacts/     # Favourites list + favourites screen
    coach/        # Money Coach screen, Home card, insights, goals, period selector
    missions/     # Money Missions list, mission page + step panel, Home card,
                  # the mission note shown on Activity / Money / Coach
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
                  # safety, approval, events, notification, allowance, peer,
                  # qr (payload format + validator), contact,
                  # coach (periods, definitions, insight rules — pure),
                  # mission (catalog, statuses, step rules — pure)
  sandbox/        # The sandbox: engine, operations, rules, transitions,
                  # space-transitions, allowance-transitions,
                  # peer (directory), peer-transitions,
                  # qr (QR identity + resolution), contacts (favourites),
                  # coach (read-only Money Coach analytics),
                  # missions (mission progress engine — no money),
                  # family-transitions, events,
                  # identity, seed, scope,
                  # authorization, accounts, selectors, persistence,
                  # repository, and the React store
  lib/            # Small shared helpers (cn, currency, format, ids, nav,
                  # qr-matrix, qr-camera)
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
- **`src/sandbox/transitions.ts`** — pure state transitions: `pay`, approvals, `createRequest`, `respondRequest` (only "paid" touches the ledger), `sendAllowance`, sandbox refunds, wallet freeze, notifications. Money Space transitions live in `space-transitions.ts` (Phase 6); recurring pocket money in `allowance-transitions.ts` (Phase 7); TeenPay-to-TeenPay transfers and money requests in `peer-transitions.ts` (Phase 8).
- **`src/sandbox/store.tsx`** — the single client-side boundary. Components never touch localStorage or the ledger directly; they consume typed state and actions from `useSandbox()`. A future real backend can implement exactly this contract over an API.
- **Derived, never stored** — the available balance, every Money Space balance, goal progress, activity, the pending-requests list, and notification counts are all computed from ledger entries on render. There is no "current balance" field anywhere.
- **Money Spaces** — available = what can be spent; Spaces (Save, goals, custom) hold money set aside inside the same wallet; total = available + Spaces. Upcoming = pending requests (expecting money never increases the balance). See Phase 6.
- **Idempotency** — the Pay, Send and Request flows generate one idempotency key when you reach review; double-confirming replays it and can never create a second payment, transfer or request.
- **Persistence** — one versioned localStorage key (`teenpay-sandbox-v1`, schema v7 since Phase 8), validated and migrated on load. Unreadable data is backed up, never silently dropped (see Phase 4).
- **Reset** — **Profile → Reset sandbox data** (with confirmation) restores the initial state: ledger, requests, notifications, and balances. Your theme preference is kept.
- **Fictional family** — teen Aarav Sharma (`@aarav`), parent Priya Sharma (`@priya`). See Phase 3 below. Since Phase 8 the seed also has Meera Kapoor (`@meera`), a teen in her own, separate family, to send to and request from.

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

## Phase 8 — Send & Request Money

**Status.** Complete (sandbox). Teens can send (fictional) money to another TeenPay teen and ask one for money. **Sandbox only — no real UPI, bank, card, payment gateway, settlement or real money.** A "TeenPay transfer" is two entries in this browser's ledger.

**Architecture.** One domain module, a directory, one transition module — all on the existing engine.
- `domain/peer.ts` — the `PeerRequest` model and status, `PeerProfile` (the display-safe face of an account: `@handle`, name, initials), the 7-day expiry (`peerRequestExpiresAt`, `effectivePeerRequestStatus`) and labels.
- `sandbox/peer.ts` — the directory: `parseTeenPayId` (accepts `@meera`, `meera`, `sandbox:meera`; never an internal id), `resolvePeer`, `searchPeers` (from 2 characters, at most 5 results, never yourself) and `lookupPeer`. Eligible = an **active teen account with a non-closed primary wallet**. Anything else reads "No TeenPay user found."; malformed input "Enter a TeenPay ID like @meera."; yourself is `self_transfer`.
- `sandbox/peer-transitions.ts` — `sendMoney`, `createMoneyRequest`, `acceptMoneyRequest`, `declineMoneyRequest`, `cancelMoneyRequest`, `expireMoneyRequests` and `approveTransfer`. Every money movement goes through one private `executePeerTransfer`, which calls `postOperation` once. There is no second ledger and no second engine.
- `sandbox/rules.ts` — the guardian decision is shared: `evaluatePayment` (contacts) and `evaluateTransfer` (TeenPay) are one `decideSpend` core, so limits and thresholds can't drift apart.
- `sandbox/selectors.ts` — `selectSendableBalance`, `selectPeerRequests`, `selectIncomingRequests`, `selectOutgoingRequests`, `selectPendingPeerRequests`, `selectRequestHistory`, `selectPeerRequest`, `selectRequestStatus`, `selectRelatedPayment`, `selectPeerTransfers`, `selectRecipientDisplay`. Request views are memoized per requests array, viewer and minute. Screens never scan raw state.
- Store (`useSandbox()`): the six actions above return typed `SandboxResult`s; `peers.search` / `peers.lookup` expose only `PeerProfile`s. Transfers cross families, so they can't run inside one family scope: the store's `dispatchDb` runs them at database level as the signed-in account (same guarantees as `dispatch` — signed in, active account, all-or-nothing), and the engine authorizes the actor itself. Approving a transfer approval is routed to `approveTransfer`; the family-scoped approval path refuses to execute one.

**Send model.** A send is one `transfer` operation: `id` = the idempotency key, `reference` `TRF-XXXXXXXX`, `amount` (whole rupees), `currency` INR, `status` completed, `actorId` (who initiated: the sender, or the approving guardian), `createdAt` (= completed at: posting is atomic). Its two legs are the ledger entries: `transfer_out` (debit) on the sender's account + wallet and `transfer_in` (credit) on the recipient's, both with the same reference and the other side's `@handle`.

**Atomic transfer.** `postOperation` validates the amount, currency, both wallets and the sender's **available** balance and appends both legs — or nothing. Money is conserved; there's never a single leg, a negative balance or a partial transaction. Money in Spaces isn't available: with ₹1,850 total and ₹800 in a Space, sending ₹1,200 fails with "Not enough available money. You have ₹1,050 available." and the Space is untouched. Amounts are validated centrally (zero, negative, decimal, malformed, above the ₹10,000 sandbox cap). Self-transfers are refused in the domain.

**Wallet states.** A frozen or closed sender can't send. A closed recipient (or closed account) is "No TeenPay user found.". **Policy for a frozen recipient: refuse** — "@meera can't receive money right now. Nothing was sent." (frozen teens still appear in search, so the reason is clear). Accepting a request re-checks both wallets the same way.

**Idempotency.** The key is created once per action, when review opens (the Requests center's Pay is keyed by the request itself). Same key + same details → the original result (`replayed: true`) and nothing written; same key + different details → `duplicate`. This covers double clicks, retries, refreshes and stale screens. Request payments use the fixed operation id `p2p_<requestId>`, so a request can be paid at most once. Guardian approval ids derive from the same key. Notifications are keyed by event id, so replays never notify twice.

**Request model & lifecycle.** `requestId` (`prq_<key>`), requester and payer account + wallet ids (plus display snapshots: handle, name), `amount`, `currency`, `note?` (≤ 60 characters), `status` pending | accepted | declined | cancelled | expired, `idempotencyKey`, `createdAt`, `updatedAt`, `expiresAt`, `respondedAt?`, `resultingPaymentReference?`. A request **is not a ledger transaction**: it never touches balances, Spaces or daily totals.
- **Create** (requester) — moves no money; visible to both.
- **Accept** (payer only) — re-validates the request (pending, not expired), both accounts and wallets, the amount, the available balance and the guardian rules; then one transfer moves the money and the request becomes accepted with the transfer's reference, in the same step. Double accept → exactly one transfer.
- **Decline** (payer only) — no ledger entry.
- **Cancel** (requester only, pending only) — no ledger entry.
- Declining, cancelling or expiring also closes any pending guardian approval for it, so it can never execute later.

**Expiry.** 7 days (`PEER_REQUEST_TTL_DAYS`), computed from timestamps — no timer. A pending request past `expiresAt` reads as expired everywhere and can't be paid, declined or cancelled. `expireMoneyRequests` (run when the Requests center opens) writes it down, with `respondedAt` = the moment it expired. It moves no money and sends no notices.

**Insufficient funds on accept.** Nothing moves and the request **stays pending** ("Not enough available money. You have ₹X available."), so the payer can top up or free money from a Space and try again. Spaces are protected: with ₹500 available and ₹1,000 in Save, a ₹700 request fails.

**Guardian controls.** Pocket money stays a separate feature. For a teen with a linked guardian, sends and request payments go through the same decision as payments: the per-payment limit and daily limit are hard stops, and anything above the approval threshold uses the existing approval flow (`kind: "transfer"`). Nothing moves until the guardian approves; approval re-checks everything and executes through the same atomic path, exactly once. A declined approval moves nothing; a request whose payment was declined stays pending but the teen can't pay it (they can decline it). **Incoming money is not spending** — it never uses up the daily limit. A disconnected guardian can't approve.

**Authorization & privacy.** Decided in the engine, never by the UI.
- Only active teens send, request and pay; parents can't send or receive TeenPay transfers.
- Only the payer accepts or declines; only the requester cancels. Everyone else — including parents, unrelated accounts and forged ids — gets "This request isn't available."
- A signed-out or closed-account stale screen is refused (`not_signed_in` / `account_unavailable`).
- Each account's view holds only its own wallet, its own leg of each transfer and requests it's a party to. The other side appears as `@handle` + name; its account and wallet ids are redacted from the viewer's ledger and operations, and no family details cross over. The directory never returns ids.

**Notifications.** Recipient "You received ₹250."; sender "₹250 sent to @meera." (for an approved send, the approval notice carries that title); requester "Money request sent."; payer "@aarav requested ₹300."; requester "₹300 request was paid." / "Money request declined."; payer "Money request cancelled.". A linked guardian with payment notifications on hears about sends. None repeat on retry.

**Activity & screens.**
- **Activity**: "Money sent −₹250" (To @meera), "Money received +₹250" (From @aarav), "Money request paid +₹300" (From @meera · Request). Open requests sit in their own "Money requests" block, apart from ledger rows. The transaction detail shows type, direction, status, `@handle · name`, the related request (who asked, status, note), reference and time — no internal ids.
- **Send** (`/send`) / **Request** (`/request`): search → amount (with live guidance from `evaluateTransfer`) → review ("Send ₹250 / To @meera / From your available balance") → confirm → "Money sent" with amount, recipient, reference and time — shown only after the engine succeeds.
- **Requests** (`/requests`): Incoming ("₹300 requested by @aarav" — Decline / Pay, with a confirmation), Sent ("₹500 requested from @meera" — Cancel request) and History.
- **Home**: Send and Request quick actions (Pay stays for sandbox contacts) and a pointer to open requests. **Money**: available → Send / Request / Requests → Spaces → recent activity.

**Persistence.** Schema **v7** adds `peerRequests`. On load v1 → … → v6 → v7 runs automatically, with the original payload backed up first; nothing is dropped or duplicated. The v7 validator also refuses:
- a malformed request (fields, parties, wallets, currency, note, or an expiry that isn't created + 7 days);
- duplicate request ids or keys;
- a pending request with a reference, or a non-pending one without `respondedAt`;
- an accepted request without its matching transfer, or a declined, cancelled or expired one that points at money;
- a request transfer without its request;
- a transfer whose ledger entries don't match its legs.

Such data is backed up and replaced by the seed. **Reset** is deterministic (the v7 seed has Meera and no requests).

**Tests** (`npm test`): 511 in total (38 files). Phase 8 adds 90:
- `peer-transfers.test.ts` — directory, atomic send, idempotency, amounts, Spaces, self, teen-only, wallet states, notifications, privacy, Activity;
- `peer-requests.test.ts` — create, accept, double accept, insufficient funds with Spaces, decline, cancel, authorization, expiry;
- `peer-guardian.test.ts` — per-payment and daily limits, incoming isn't spending, approval, decline, re-checks, request approvals, disconnect;
- `peer-persistence.test.ts` — v6 → v7, reload, reset, 21 tamper cases;
- `peer-ui.test.tsx` — send, request, the center (pay, decline, cancel, expired), Activity, detail, Home, Money, stale signed-out screens;
- `phase8-journey.test.tsx` — a 34-step journey through the real app.

All earlier tests were kept. Tests that pinned schema v6 or the one-family seed now expect v7 and the second seed family. Home's "Request" quick action now opens `/request` (contact requests remain on `/pay`).

**Limitations.** Sandbox only, one device, no sync, no real people: "another teen" means another sandbox account in this browser. There are no contacts/favourites, no QR codes, no split bills, no recurring transfers and no push notifications. Expiry is written down lazily (when the Requests center opens) rather than by a server job. A production version would run transfers on a trusted server with the same idempotency keys.

## Phase 9 — QR Payments, Contacts & Fast Pay

**Status.** Complete (sandbox). Teens can show their TeenPay QR, scan someone else's to pay or request, and keep favourites for one-tap payments. **Sandbox only.** There is no UPI QR, no bank or card QR, no merchant QR and no payment provider, settlement or production QR rail. A TeenPay QR is simply a way to type someone's TeenPay ID without typing.

**Architecture.** QR is a way to *find* someone, not a way to pay. It sits in front of the existing directory and flows, with no second wallet, ledger or engine.
- `domain/qr.ts` — the payload format: `formatQrPayload`, and the one central validator `parseQrPayload`. Both are pure and deterministic, with typed problems.
- `sandbox/qr.ts` — `qrIdentityFor` (my QR: payload + safe profile, teens only) and `resolveQrRecipient`. Resolution goes validate → directory lookup (`resolvePeer`) → eligibility → safe profile.
- `domain/contact.ts` + `sandbox/contacts.ts` — the favourite record and its engine: `addContactTransition`, `removeContactTransition`, `selectContactViews` (memoized), `lookupContact` and `isFavourite`.
- `lib/qr-matrix.ts` — encodes with the maintained **`qrcode`** library (error correction M) into a module matrix, which `components/qr/qr-code.tsx` renders as one SVG path. Nothing is hand-drawn. The tests decode the matrix with **jsQR** to prove it round-trips.
- `lib/qr-camera.ts` — the camera boundary (below). It knows nothing about payments: it returns untrusted text.
- Store (`useSandbox()`) actions:
  - `createQrPayload()`, `resolveQrIdentity(payload)`, `startQrPayment(payload)` and `startQrRequest(payload)`. These are read-only; the last two return the recipient and an `href` into the existing flow.
  - `addContact(teenPayId)` and `removeContact(teenPayId)`.
- Store context values: `qr` (my identity) and `contacts.list` / `isFavourite` / `lookup`. Screens never read raw state.

**Payload format.** `teenpay://user/@<username>?v=1`, for example `teenpay://user/@aarav?v=1`.
- It holds the public TeenPay ID and a version, and nothing else. There is no account, wallet, family or guardian id, and no balance, amount, token, session or timestamp. The same person always gets the same code, and different people get different codes.
- The validator is strict and doesn't use the URL API. It trims the input, then checks:
  - at most 128 characters, printable ASCII only;
  - the exact `teenpay://user/` prefix;
  - no `#` or `%`, and at most one `?`;
  - a path that is exactly `@username`, following the username rules;
  - `v` is the only parameter, it appears once and it equals `1`.
- It refuses internal-id-shaped identities (`usr_…`, `wal_…`, `fam_…` and the rest of `INTERNAL_ID_PREFIXES`); since this phase, those shapes are also reserved as usernames. It also refuses UPI and web links, unexpected or duplicate parameters, and newer versions ("This QR code is from a newer version of TeenPay.").
- Every other failure reads "This isn't a TeenPay QR code."

**Security model.** A QR is public, like a username on a poster. Anyone can print one, so it grants nothing.
- Scanning resolves a recipient and shows their safe profile (name, `@handle`, initials); it never moves money.
- The user confirms the person, chooses Pay or Request, and then goes through the **existing** Send or Request flow: amount → review → confirm.
- At confirm, `sendMoney` / `createMoneyRequest` resolve the TeenPay ID again and re-run every check.
- A spoofed code can at most point at a real, eligible TeenPay user, and the screen shows who that is before anything happens.
- Your own code is refused ("This is your own TeenPay QR…"). Unknown people, parents, closed accounts and closed wallets all read "No TeenPay user found."

**Scanner** (`/qr/scan`).
- The camera starts only when you press **Start camera**, on this screen only. It asks for the rear camera, video only (`audio: false`).
- It stops when a code is read, when you press Stop, when the tab is hidden and when you leave the screen. That includes leaving while the permission prompt is still open.
- Frames go straight from `<video>` to the browser's `BarcodeDetector` (`qr_code`), in memory. They are never drawn to a kept canvas, uploaded, stored or logged.
- The state is announced in words: starting, camera on, permission refused (with "Try camera again"), no camera, or no detector.
- Browsers without `BarcodeDetector` or a camera say so honestly. The labelled **"Use a sandbox QR"** box ("For testing in this sandbox…") accepts pasted QR text through the same validator; nothing pretends to be a scan.
- The scanned text goes through `resolveQrIdentity`. The result card ("Pay or request") offers Pay, Request, Add to favourites and Scan another, and receives focus.

**My QR** (`/qr`). The real QR (`role="img"` with a text description), name, `@handle` and "Scan to pay me".
- **Copy TeenPay ID** uses the Clipboard API. If that is unavailable it says so and shows the ID.
- **Share** appears only when the Web Share API exists and shares the TeenPay ID. Otherwise a note explains that sharing isn't available. There is no fake share.
- Parents have no TeenPay QR.

**Contacts / favourites** (`/contacts`). Owner-scoped convenience, never authority.
- **Record:** `{ contactId (ctc_…), ownerAccountId, teenPayId, createdAt, updatedAt }`. It holds no wallet or account id of the target and no name snapshot. The name shown is always the person's *current* public profile.
- **Adding:** from search on the favourites screen, or from a scan result.
  - Refused: yourself ("You can't add yourself to favourites."), duplicates ("@meera is already in your favourites."), unknown, parent, closed or malformed identities, internal ids, and more than 50 favourites.
  - Adding is idempotent: the same action gives `replayed: true`, and the same key for someone else gives `duplicate`.
  - A frozen teen can be saved, but paying them is still refused at send.
- **Removing:** changes only the owner's list. History, requests, notifications and the other person's favourites are untouched. It works even if that person has since become unavailable.
- **Stale favourites:** if a saved person closes their account, the row reads "Not available right now", with no name and no reason, and Pay or Request is refused ("No TeenPay user found. Nothing was sent").
- **Privacy:** each account's scope contains only its own favourites, and a scoped write can't change them. Only active teens can keep favourites (`contacts.manage`). Adding or removing moves no money and sends no notifications.

**Quick Pay / Quick Request.**
- A favourite's **Pay @meera** / **Request from @meera** links, and a scan's Pay / Request buttons, open `/send?to=meera&via=favourite|qr` or `/request?…`: the same flow, with the recipient preselected.
- `to` is only a TeenPay ID. It is resolved through the live directory, so an edited link can't do more than typing that ID into search. An internal id, your own ID or an unavailable person preselects nobody and shows an alert.
- `via` only changes a caption ("Meera Kapoor · from your favourites" / "· from a TeenPay QR"). **Change** returns to search.
- The amount, review and confirm steps are unchanged.

**Guardian controls, Spaces, wallet states.** These apply unchanged, because the money path is unchanged:
- **Limits:** per-payment and daily limits are hard stops.
- **Approval threshold:** above it, the send asks the guardian. A QR ₹600 with a ₹500 threshold waits for approval, nothing moves until the guardian approves, and approval posts exactly one transfer.
- **Available money only:** with ₹2,000 total and ₹1,200 in Spaces, a QR ₹900 fails ("Not enough available money. You have ₹800 available.") and Spaces are untouched.
- **Wallet states:** a frozen or closed sender can't pay; a frozen recipient is refused and a closed one is not found.

**Idempotency & authorization.** The flows keep their render-captured keys, so a double confirm still posts exactly one transfer. QR actions are read-only and store actions are bound to the signed-in account; a stale screen after sign-out gets `not_signed_in` for every QR and favourite action. Only the owner can see or remove their favourites.

**Notifications & Activity.** These are identical to any send or request, with no QR- or favourite-specific notices or rows. Nothing about the QR or the favourite is stored on the transfer or request.

**Persistence.** Schema **v8** adds `contacts`; QR data is derived and never stored.
- **Migration:** on load, v1 → … → v7 → v8 runs automatically, with the original payload backed up first and every record kept. A stray `contacts` key in v7 data is dropped as foreign.
- **Validation:** the v8 validator refuses contacts that are missing or not an array, have extra or missing fields, or have a bad id. It also refuses:
  - an unknown or parent owner;
  - a target that is unknown, a parent, the owner, or an `@`-prefixed or internal id;
  - bad timestamps, or `updatedAt` before `createdAt`;
  - duplicate ids or duplicate owner–target pairs;
  - more than 50 per owner.
- Such data is backed up and replaced by the seed. **Reset** is deterministic: the v8 seed has no favourites.

**Screens.**
- **Money:** balance → Send / Request / Requests → **Scan & Pay** / **My QR** → **Favourites** (up to a few, with one-tap Pay) → Spaces → activity.
- **Home:** a compact **Scan & Pay** entry.
- **Profile:** a TeenPay ID section linking to My QR and Favourites.
- **Routes:** `/qr`, `/qr/scan` and `/contacts` are teen-only and protected (signed out → sign-in).
- All icons are Lucide, statuses are in words and never colour alone, and motion respects reduced-motion settings.

**Tests** (`npm test`): 658 in total (44 files). Phase 9 adds 147:
- `qr-identity.test.ts` (53) — payload format, jsQR round-trip, 37 rejected payloads, resolution, internal-id refusal;
- `contacts.test.ts` (20) — add, duplicates, replay, refusals, limit, removal, isolation, stale and frozen favourites;
- `qr-contacts-persistence.test.ts` (26) — v7 → v8, reload, reset, 19 tamper cases;
- `qr-ui.test.tsx` (32) — My QR, scanner paste path and mocked camera (start, detect, stop, hidden tab, unmount, denied), favourites, Quick Pay / Request, stale favourite, id injection, Spaces, guardian, frozen, Money, Home and Profile entry points;
- `qr-security.test.tsx` (15) — store actions, spoofed codes, available-only (₹2,000 total / ₹1,200 in Spaces → QR ₹900 refused), cross-account, id injection, stale signed-out screens, protected routes;
- `phase9-journey.test.tsx` — a 43-step journey through the real app.

All earlier tests were kept. Tests that pinned schema v7 now expect v8 with `contacts: []`, and the migration chains in older persistence tests now also run the v7 → v8 step.

**Limitations.**
- The camera path needs a browser with `BarcodeDetector` (Chromium on Android, desktop Chrome/Edge on some platforms). Elsewhere the scanner offers the sandbox paste box. The camera hasn't been exercised on a real device in this project's automated checks, which mock the camera APIs.
- Sandbox only, one device, no sync, and QR codes don't carry amounts.
- There are no printed or offline codes, and favourites can't be reordered or nicknamed.

## Phase 10 — Money Coach

A calm, read-only place where a teen can see how their money is doing. **The Coach is informational only.** It never moves money, approves or declines anything, changes limits, runs payments, gives investment advice or calls an external AI. It can't: the code has no write path.

**Architecture.** The Coach reads in one direction:

```
ledger → existing selectors → coach analytics → deterministic insights → UI
          (sandbox/selectors)  (sandbox/coach.ts)  (domain/coach.ts)   (components/coach)
```

- `domain/coach.ts` is pure. It holds the periods, definitions, insight rules, lessons and copy. Its inputs are plain facts, and the clock is always passed in.
- `sandbox/coach.ts` turns the viewer's scoped state into those facts:
  - Balances come from `selectMoneySummary`, and Space and goal progress from `selectActiveSpaces`. There's no second calculation of either.
  - "What happened in this window" comes from `listWalletEntries` for the viewer's own wallet.
  - `coachReportFor(db, account, period, now)` scopes to the account (`scopeFor`) first, then analyses.
- The store exposes one action, `coachReport(period)`. It goes through the same signed-in gate as every other read (`readDb`), so a signed-out or stale screen gets `not_signed_in`.
- The UI calls only `useCoachReport(period)`, which wraps that action. It never reads the ledger or selectors itself.
- Reports are memoized per database snapshot, account, period and day, in a `WeakMap`. Home and `/coach` share one calculation, and nothing is recalculated until money moves or the day changes.
- Nothing is persisted and no notifications are created. The period choice is local screen state and isn't saved.

**Periods.** All periods use India time (IST, the product timezone) and one date helper (`coachWindows`).

| Period | Covers | Compared with |
| --- | --- | --- |
| Week | Monday → today | The same weekdays last week |
| Month | The 1st → today | The same days last month (capped at that month's last day) |
| 30 days | Today and the 29 days before | The 30 days before that |

- If the wallet didn't exist for the whole comparison window, the Coach says **"Not enough data yet"** instead of comparing. This is the low-data state.

**Definitions.** Ledger entries only exist for completed money movements.

- **Spent** means completed `payment_sent` + `transfer_out` debits in the period. These are the same types the guardian daily limit counts.
  - Pending approvals, declined, cancelled or expired requests, and failed payments are never counted. They never reach the ledger.
  - Money moved into a Space isn't spending.
  - Incoming money and pocket money aren't spending.
- **Received** means pocket money (`allowance_credit`), money from people (`transfer_in` and `payment_received`, including paid requests) and sandbox top-ups (`deposit`). Each part is shown separately.
- **Refunds** are shown on their own. They are never counted as income or as negative spending.
- **Reversals and adjustments** are sandbox corrections. They count as neither spending nor income.
- **Available** and **Set aside** are balances right now, the same figures as the Money screen. Set aside is what's in Money Spaces, and it's still the teen's money.
- **Savings rate** = money moved into Spaces during the period, minus anything moved back, ÷ money received in the same period.
  - If nothing was received, it reads "Not enough data yet".
  - A net move out of Spaces is described as such, never as a negative rate.
- **Spending comparison:** a change within ±10% reads as "similar". If the previous amount was ₹0, the Coach states both amounts without a percentage.

**Insights.**
- Deterministic rules over the facts, in a fixed internal order:
  1. a pending approval (as information);
  2. balance explanation;
  3. goals (reached first; at most two);
  4. spending change or total;
  5. where spending went and how often;
  6. money set aside;
  7. pocket money received and next scheduled;
  8. money from people;
  9. one lesson.
- At most 8 insights.
- Each has a strict category (`spending`, `saving`, `goals`, `pocket_money`, `balance`, `habit`, `education`), a factual title, and an explanation naming the period, the dates and the source.
- Actions are links only: Money Spaces, a goal, Activity, Family (pocket money info), or a Learn anchor. There are no approve, pay or change buttons.
- There's no score, grade or "financial health" number. The priority order is internal only.
- Copy is neutral: no pressure, shame, fear or "you should", and no product or investment recommendations.
- A copy-guard test checks every generated insight and lesson against a list of banned words and topics (investing, crypto, loans, gambling, judgement, urgency, scores) and against emoji.
- The six lessons cover:
  - available vs saved money;
  - why use a Space;
  - an emergency fund, explained simply;
  - how a spending limit works;
  - why a payment can be pending;
  - how the Coach counts spending.

**Goals and pocket money.**
- Goals are Spaces with a target. Progress, remaining amount and target date come from the existing Space progress.
- The default Save Space links to `/money`, because its id embeds the account id. Other Spaces link to their own page.
- Pocket money is read-only information: what was received in the period and the next scheduled payment (amount, date, cadence). The Coach has no parent controls.

**Privacy.**
- Teen-only, own data only. The report is built only for an active teen whose own wallet is in their scope.
- A parent gets `not_permitted`, even though a guardian's scope can include the linked teen's wallet for the parent overview. There's no parent Coach and no new permission model.
- Reports contain no internal, wallet or family ids, guardian settings, notifications or tokens. Tests check this.
- `/coach` is protected (signed out → sign-in) and wrapped in `RoleGate role="teen"`.

**Determinism.** There's no randomness, AI, external API, analytics or network call, and no server-time dependency. The same data on the same IST day gives an identical report. The only clock read happens once, in the store action, and is passed down.

**Screens.**
- **Home:** a compact Money Coach card showing this month's headline and the closest goal ("New Bike is 60% complete"), with **View insights** linking to `/coach`.
- **`/coach`:**
  - Period selector: native radio buttons, keyboard-operable, with a polite live status line.
  - **Your money at a glance:** Available and Set aside (now), Received and Spent (the period's dates), plus a comparison line and a small zero-based comparison chart with text labels.
  - **Insights**, then **Saving goals**, then **How these numbers work** (definitions and the read-only statement), then **Learn**.
  - **Empty state** for a brand-new account: "Your Money Coach is getting to know your money." / "Make a few transactions to see insights here." Also a low-data caption and a safe error fallback that shows no internal details.
- Semantic headings and labelled regions, metric labels that say what and when, a spoken value on every progress bar, statuses in words (never colour alone), Lucide icons, no emoji, reduced-motion aware.

**Tests** (`npm test`): 715 in total (49 files). Phase 10 adds 57:
- `coach-domain.test.ts` (21): periods and IST boundaries, month-end capping, savings rate, comparisons, insight order and caps, goal wording, navigation-only actions, and the copy guard;
- `coach-analytics.test.ts` (19): seed figures (month: ₹4,500 received, ₹350 spent, ₹2,300 set aside, 51%) and the classification of every ledger type. Also covers:
  - completed, pending → declined, and failed payments;
  - incoming and outgoing transfers, Space moves and refunds;
  - privacy: parent, unknown, other teen, new account, no ids;
  - determinism, memoization, and a database that is never changed;
- `coach-ui.test.tsx` (9): structure and accessibility, metric labels, definitions, no money controls, empty state, error fallback, chart text alternative, insight and goal parts;
- `coach-security.test.ts` (7): static audit of every Coach file. It checks for:
  - no write path, network, AI or analytics calls;
  - no raw ledger reads from the UI;
  - no randomness, secrets, debug output or emoji;
  - a protected teen-only route;
- `phase10-journey.test.tsx`: a 29-step journey through the real app. Steps:
  - figures and periods;
  - a completed payment;
  - pending, then declined;
  - money received;
  - a Space move;
  - determinism, no network and no console errors;
  - stale sign-out and signed-out redirect;
  - parent, other teen and new account.

All earlier tests were kept unchanged.

**Limitations.**
- Sandbox only and one device. Periods are fixed (week, month, 30 days), with no custom ranges or history charts.
- "Where money went" is by type (payments vs transfers to friends). Payments carry no merchant categories.
- The Coach isn't in the tab bar yet. It's reached from the Home card.
- Insights are rule-based and deliberately simple. There's no personalization beyond the teen's own figures.

## Phase 11 — Money Missions

Short, optional learning missions about a teen's own money. They look and read like the rest of TeenPay, not like a game. **Missions are for learning only.** They never move money, never need spending, never change limits, and pay no rewards. There are no streaks, points, leaderboards, timers, countdowns or reminder notifications.

**Architecture.** Missions follow the same shape as the Coach, with one addition: a small progress record.

```
ledger / Spaces → existing selectors → mission facts → mission rules → UI
                   (sandbox/selectors)  (sandbox/missions.ts)  (domain/mission.ts)  (components/missions)
```

- `domain/mission.ts` is pure: the catalog, step kinds, statuses, `deriveMissionView` / `deriveMissionBoard` and `checkStep`. It has no clock and no randomness.
- `sandbox/missions.ts` is the engine:
  - It reads three facts from the teen's own scoped state through the existing selectors: a custom Space, a goal with a target, and whether there's any completed transaction.
  - It writes only `db.missionProgress`. It never touches the ledger, operations, wallets, Spaces, requests, approvals or notifications, and it has no path to `postOperation`.
- The store adds four actions:
  - `missionBoard()` and `missionDetail(id)` are read-only, through `readDb`.
  - `startMission(id)` and `advanceMission(id, stepId, answer?)` go through `dispatchDb`, the same signed-in gate and single commit path as every other write. The clock is read once there and passed down.
- The UI calls only those actions (`use-missions.ts`). It never reads the ledger, selectors or scope.
- The board is memoized per database snapshot and account in a `WeakMap`, so Home, Profile and `/missions` share one calculation.
- Coach, Activity and Money don't depend on Missions. They gained only small optional hooks: a `notice` / `banner` slot, `onLessonOpened` and `onOpenTransaction`. The wrappers in `components/missions/mission-screens.tsx` connect them.

**Catalog.** Ten missions in four categories, each with a stable public slug (used in the URL), a purpose, steps, an estimated time and completion copy.

| Mission | Category | Steps | How it completes |
| --- | --- | --- | --- |
| Know Your Balance | Money basics | read, read, check | Right answer to the check |
| Available vs Set Aside | Money basics | read, check | Right answer (a worked ₹ example) |
| Understand Pocket Money | Money basics | read, read, check | Right answer |
| Send vs Request | Money basics | read, read, check | Right answer |
| Payment Safety | Safety | read ×3, check | Right answer (a scam scenario: never pay to unlock a prize) |
| Explore Your Spending | Explore | read, visit Activity | "Mark step done" on Activity |
| Review a Transaction | Explore | read, visit a transaction, check | Opening a transaction's details, then the check. **Locked** until the wallet has a transaction |
| Build a Money Space | Save | read, evidence | The teen really has a custom Space (made in the usual flow; no money needed) |
| Set a Saving Goal | Save | read, evidence | The teen has a goal with a target (an existing goal counts) |
| Learn From Your Coach | Explore | read, visit Coach, check | Opening a Coach lesson, then the check |

**Completion model.**
- Statuses are derived, never stored: `available` (not started), `in_progress` (with "Step N of M"), `completed` or `locked`.
- A **completed mission stays completed**, even if a lock or evidence would fail later (for example, the Space was archived).
- Progress is a step count. There are no percentages or scores.
- No fake progress:
  - Opening a screen completes nothing. A mission has to be started, and steps finish in order.
  - A check needs the right answer. A wrong answer changes nothing and shows a gentle hint, with no penalty and no limit on retries.
  - An evidence step checks real data at that moment.
  - A visit step can only be marked done on the target screen, after the objective (for example, a transaction or lesson was opened).
- Idempotent:
  - Starting a started mission, or repeating a finished step, returns the current view and changes nothing.
  - Every failure leaves the database untouched.
- Stored timestamps never go backwards, even if the device clock does.

**Persistence and schema.**
- Progress lives in the one sandbox database as `missionProgress: { ownerAccountId, missionId, stepsCompleted, startedAt, updatedAt, completedAt? }[]`.
- The field is optional and additive, so the schema stays **v8**. There is no migration and no separate localStorage key. Pre-Phase-11 data loads unchanged, and older schemas migrate as before.
- It survives reload. **Reset Sandbox clears it** (the reset dialog says so).
- `isSandboxDatabase` validates it strictly. It rejects:
  - unknown keys (a smuggled balance, reward or wallet id);
  - an owner who isn't a teen;
  - an unknown mission;
  - a step count that isn't a whole number within range;
  - `completedAt` present when steps are unfinished, or missing when they're finished;
  - bad or out-of-order timestamps;
  - duplicate records.

  Corrupt data goes through the existing backup-and-recover path: the raw data is kept as a backup and the seed loads. It never crashes.

**Auth and privacy.**
- There's a new `missions.use` permission for teens only (`TEEN_SELF_PERMISSIONS`). A parent, even a linked guardian whose scope includes the teen's wallet, gets `not_permitted`. There's no parent view of missions and no parent controls.
- `/missions` and `/missions/[missionId]` are protected (signed out → sign-in) and wrapped in `RoleGate role="teen"`.
- A teen only ever reads or writes their own records. The URL id only selects a public catalog entry.
- Views and screens contain no account, wallet or record ids. Tests check this.

**Money safety.**
- The engine can't write money, and the static audit enforces it.
- A test completes all ten missions and checks that everything except `missionProgress` is byte-for-byte identical.
- The journey checks that the ledger, operations, wallets, requests and approvals are unchanged. The Space mission uses the normal Spaces flow and needs no money.

**Screens and routes.**
- **`/missions`:**
  - A summary: "N of 10 completed" in words (with a decorative progress strip) and a link to continue.
  - Missions grouped by category, each showing title, summary, status (icon + words), time and step count.
  - Four categories, so no filters are needed.
- **`/missions/[missionId]`:**
  - Category, title, purpose, status and time.
  - Then one panel, depending on the status: "Start mission", the current step, "Locked for now" with the reason, or "Mission completed" with the completion copy, date and next mission.
  - Then an ordered step list with states in words. Finished steps can be re-read.
  - Focus moves to the new step heading as you progress. Engine errors show inline (`role="alert"`) and checks announce the result (`role="status"`).
  - An unknown id shows a calm "We couldn't find that mission" and creates nothing.
- **Activity, Money and Coach** show a quiet note when opened from a mission (`?mission=<slug>`). Everything else on those screens works as usual, and an unknown slug shows nothing.
- **Home:** a Money Missions card with "N of 10 completed" and the next mission ("Up next", or "Continue learning" when one is in progress).
- **Profile:** a teen-only **Learn** section with Money Coach and Money Missions.
- No new tab, to avoid crowding the navigation. Accessibility: semantic headings, labelled regions, native radios in a fieldset, statuses never shown by colour alone, reduced-motion aware, no emoji.

**Tests** (`npm test`): 816 in total (55 files). Phase 11 adds 101:
- `missions-domain.test.ts` (22): catalog integrity, stable ids, internal links only, a copy guard (no rewards, streaks, pressure, gambling, crypto, loans or investing), statuses, locks, "completed stays completed", IST completion day, board and next mission, checks and evidence;
- `missions-engine.test.ts` (21): lessons, wrong answers, order, no auto-start, unknown ids, idempotency, clock safety, Space and goal evidence through the real Spaces engine, locks, parent denial, teen-to-teen privacy, no ids, money safety, memoization;
- `missions-persistence.test.ts` (28): schema v8, reload, pre-Phase-11 data, older migrations, reset, 20 kinds of tampered records, and recovery with a backup;
- `missions-ui.test.tsx` (16): the list, locked state, the full lesson flow with focus, not-found, evidence step, the Activity / Coach / Money notes, Home card, Profile, parent gate, signed-out redirect, stale actions after sign-out, and corrupt storage;
- `missions-security.test.ts` (13): static audit of every Missions file. It checks for no money writes, network, AI or analytics calls, randomness, timers, rewards, secrets, emoji, dangerous rendering or ids. It also checks store wiring, teen-only auth, and that Coach, Activity and Money don't depend on Missions;
- `phase11-journey.test.tsx`: a 25-step journey through the real app:
  1. start a mission;
  2. finish a lesson step;
  3. see the progress;
  4. leave and return;
  5. finish with a wrong try on the way;
  6. the Activity mission;
  7. the Space mission via the usual flow;
  8. the Coach mission with a period switch;
  9. confirm no money changed;
  10. parent denied;
  11. teen state intact;
  12. Reset Sandbox clears missions.

All earlier tests were kept unchanged.

**Limitations.**
- Sandbox only, one device, fixed English catalog.
- Visit steps are confirmed on the device ("I looked"). The app checks the teen opened a transaction or lesson, but can't know they read it.
- Evidence reflects data at the moment the step is finished, by design. Later changes don't undo a completed mission.
- Missions aren't in the tab bar. They're reached from Home, Profile and the mission links.

## Phase 12 — Friend Circles

**Status.** Complete (sandbox). Teens can find another teen by TeenPay ID, ask to be friends, accept or decline, and keep a small trusted circle they can pay or request from. **Friend Circles are not a social network.** There are no feeds, followers, comments, likes, profiles with photos, leaderboards or streaks. Friendship is a *relationship* that makes the existing Send and Request flows easier to reach — it never creates a new way to move money.

**Sandbox only.** Everything happens in this browser's sandbox database. There is no server, no network, no real people: "another teen" is another sandbox account on the same device. The QR payload, TeenPay ID format and directory rules are unchanged.

**Architecture.** Friend Circles follow the same layering as every other phase:

```
domain/friend.ts        pure statuses, transitions table, id/format checks, view shapes
sandbox/friends.ts      the engine: lookup, send/accept/decline/cancel/remove, the circle
sandbox/persistence.ts  strict validation of the friendships field
sandbox/store.tsx       six store actions + the friendCircle context
components/friends/     the screens (they call store actions only)
app/friends/            /friends and /friends/[teenPayId] (protected, teen-only)
```

- `domain/friend.ts` is pure: friendship statuses (`pending → accepted | declined | cancelled`, `accepted → removed`), the transition table, the pair key (two account ids in sorted order, never stored), id and note validation, and the view shapes. It has no clock and no randomness.
- `sandbox/friends.ts` is the engine. It authorizes every call against `friends.use` (teen only), resolves the TeenPay ID through the existing directory (`resolvePeer`), and writes **one thing**: `db.friendships` (a single `replace`). It never writes the ledger, wallets, operations, requests, Spaces, allowances, contacts or favourites, and it has no path to `postOperation`. A friendship can never bypass balances, limits, approvals or idempotency — paying a friend goes through the exact same Send flow as paying anyone.
- Notifications are emitted by the shared event projector (`notificationsForEvent`), the same path as transfers. Only two quiet system notifications exist: *request received* (recipient) and *request accepted* (requester). Decline, cancel and remove stay silent — no re-request nudges, no engagement. Friend events are **not** in the family event set, so friendship changes never enter the financial Activity log or the family log.
- The store adds `friendCircle()`, `friendLookup()`, `sendFriendRequest()`, `acceptFriendRequest()`, `declineFriendRequest()`, `cancelFriendRequest()` and `removeFriend()`, all through the same signed-in gate and single commit path. The UI reads the memoized circle from context and never touches selectors or raw collections.

**Discovery and safety.**
- Discovery is **TeenPay ID only** (`@meera`). There is no directory to browse, no "people you may know", no name search and no harvesting of account ids: typing something that looks like an internal id (`usr_…`, `wal_…`, `frd_…`) is rejected by the lookup itself.
- Teen-to-teen only. Parents can't open `/friends` (permission and route gate), and friend requests can't be sent to, accepted by or looked up for a parent.
- A friend sees only what the TeenPay directory already shows: name, @handle and initials. Friend views carry no account ids, wallet ids, balances, history, Spaces, goals, limits or guardian settings.

**Domain rules.**
- One open record per pair of accounts; the pair key makes "A → B" and "B → A" the same pair, so duplicates are impossible.
- Transitions follow the table strictly: a declined or cancelled request can't become accepted — a new request must be sent. Terminal statuses are terminal.
- Idempotent and replay-safe: repeating the same `requestId` returns the first result without creating a second record, a second notification or a clock change. Accept/decline/cancel replay the outcome on an already-decided record.
- Stored timestamps never go backwards, even if the device clock does.
- Up to 50 friends per teen.

**Persistence and schema.**
- Friendships live in the one sandbox database as `friendships?: FriendshipRecord[]` — an **optional, additive field**, so the schema stays **v8**. There is no migration and no separate storage key; pre-Phase-12 data loads unchanged.
- `isSandboxDatabase` validates it strictly (unknown keys rejected; records coherent with their status; both sides must be teen accounts and not the same account; ids unique; at most one open record per pair; the 50-friend cap). Corrupt or tampered data falls through to the existing backup-and-recovery path, exactly like earlier phases.
- Friendships survive reload and the Reset Sandbox flow clears them with everything else.

**Integration.**
- Friend detail offers **Send Money** and **Request Money**, deep-linked into the existing `/send` and `/request` flows (`?to=<teenPayId>&via=friend`). Guardian approval thresholds, daily limits, balances, review steps and idempotency apply unchanged.
- Home gains a small Friend Circle card (counts + next action); Profile gains a teen-only entry. The tab bar keeps its five items.
- QR scanning is friendship-aware without changing the QR: after scanning a teen, the scan screen shows whether you're friends and offers to send a request — or opens their friend page when you are. The QR still holds only the versioned TeenPay ID.
- Favourites remain a separate, private concept; adding or removing a friend never changes them.
- Two new notifications use the existing system notification kind; no new UI category was needed.

**Tests.** New suites: `friends-domain` (statuses, transitions, pair keys, validation), `friends-engine` (lookup, send/accept/decline/cancel/remove, idempotency, clock guard, limits), `friends-persistence` (schema v8 additive field, strict validation, corruption → recovery), `friends-authorization` (teen-only, party checks precede role checks, no parent paths), `friends-privacy` (views carry profiles only, no ids or money), `friends-integration` (friendship never bypasses guardian rules; QR payload unchanged; favourites independent), `friends-ui`, `friends-security` (static audit: engine writes only `friendships`; UI uses store actions only; no network, analytics, AI, randomness or secrets), and the 34-step `phase12-journey` through the real provider stack. All earlier suites remain unchanged and green.

**Limitations.**
- Sandbox only, one device, no sync. "Friends" exist only in this browser's database.
- No blocking, reporting or muting yet; removal is the only safeguard, and it's mutual.
- Friend requests expire only by decision (decline/cancel), not by a timer.
- The circle cap (50) is fixed for the sandbox.

## Phase 13 — TeenPay ID

**Status.** Complete (sandbox). TeenPay ID is now the product's first-class identity layer: one stable, human-facing identifier (`@aarav`, `@meera`, `@rohan`) used consistently for discovery, Send Money, Request Money, Friend Circles, favourites and QR. **Identity is not a social network** — there are no public profiles, feeds, followers, likes or directory browsing. **Sandbox only:** everything lives in this browser's sandbox database; there is no server, no phone number, no KYC, no real payment rail of any kind.

**Identity vs accounting.** Every person has exactly three names with separate jobs:

| Name | Example | Job |
| --- | --- | --- |
| Internal account id | `usr_aarav` | Accounting ownership — stable, private, never shown, never typed, never reused |
| Display name | `Aarav Sharma` | What friends and family see |
| TeenPay ID | `@aarav` | The public alias — discovery, payments, requests, friends, favourites, QR |

Money flows always resolve the TeenPay ID to the internal account id *before* anything is written, so an ID is just an alias: changing it can never move money, re-target a friendship or favourite, or hijack someone's history.

**Architecture.**

```
domain/identity.ts        normalization, alphabet, reserved ids, availability, the safe projection shape
sandbox/teenpay-id.ts     the engine: availability, identityProfileFor/search, changeTeenPayIdTransition
sandbox/accounts.ts       account creation reuses the same centralized rules
components/identity/      identity card, change-ID modal, /id lookup + shared identity surface
app/id/                   /id and /id/[teenPayId] (protected, teen-only)
```

- `domain/identity.ts` centralizes everything Phase 4 used to call "username rules": one normalization (`"@Aarav"`, `" AARAV "` → `aarav` — case can never fork an identity), a conservative alphabet (lowercase letter first, then `a-z 0-9 . _`, 3–20 chars, no repeats/trailing punctuation), the reserved-id list, internal-id refusal, structured availability and the `IdentityProfile` projection shape. `domain/account.ts` keeps its old names, built on this module.
- `sandbox/teenpay-id.ts` is the engine, authorized by the new teen-only `identity.use` permission (same architecture as `friends.use`; parents get the standard refusal). It writes **only** `db.accounts` — and only the one account whose owner asked, alias fields only (`username`, `identifier`, `updatedAt`). There is no path from it to `postOperation`.
- The safe projection is built field-by-field (`peerProfileOf` + the Friend Circle's `relationOf` + favourites' `isFavourite`) — accounts are never spread into views. Unknown, malformed, internal-id-shaped, closed, suspended, parent or walletless lookups all read the same neutral "No TeenPay user found.", so a lookup never confirms that an ineligible account exists.

**Validation rules.** `a-z 0-9 . _` only (lowercase letter first), 3–20 characters; spaces, emoji, uppercase, slashes, query strings, HTML, control characters and Unicode lookalikes are rejected by the alphabet itself; dots/underscores can't repeat or trail. Reserved ids (central list): `admin`, `administrator`, `api`, `family`, `guardian`, `help`, `moderator`, `official`, `parent`, `payments`, `root`, `sandbox`, `security`, `support`, `system`, `teen`, `teenpay`, `wallet`. Anything shaped like an internal record id (`usr_…`, `wal_…`, …) is refused everywhere — lookup, availability, change, QR and routes.

**Availability.** `checkTeenPayIdAvailability` returns structured states — `available`, `taken`, `reserved`, `invalid` — with the normalized id and a human message, and nothing about *who* holds a taken id. Checking your own current id reports available (keeping it is an idempotent no-op).

**Changing your TeenPay ID.** Profile → Change TeenPay ID, with live availability feedback and one atomic engine transition. Deterministic order: gate → normalize → validate → uniqueness → one replace of the alias fields. What is deliberately untouched: the account id, wallets, ledger, friendships (account-id keyed), money requests (account ids + historical handle snapshots), favourites (saved handles), notifications (historical text) and the QR payload format. **Documented limitation:** a freed ID becomes claimable again — exactly like a username anywhere. Old references keep pointing at the account id they always pointed at (money requests still pay the right account; an old favourite shows as unavailable rather than silently re-pointing), and the newcomer inherits nothing: no money, no friends, no history.

**Profile.** Teens get an identity section: their ID large, with Copy (Clipboard API — handle only), Share (Web Share API where the browser offers it, identity text only, honest fallback otherwise) and Change. Parents get no identity card — `identity.use` is teen-only.

**Search & the shared identity surface.** `/id` is the canonical exact-match lookup (normalized input, no fuzzy browsing). Search, the QR scanner and Friend Circles all land on the same `/id/[teenPayId]` surface: public profile, relationship badge, availability and the existing actions — Send Money / Request Money (deep-linked into the unchanged flows, `via=friend` once the friendship exists), favourite toggle, friend request/accept paths. Route params are validated and can never be interpreted as internal ids. Looking up your own ID opens your identity card instead.

**Integrations — unchanged contracts.**
- **Send / Request:** recipients are still shown as `@handle + name`; the engine still resolves to account ids; guardian thresholds, daily limits, balances, review steps and idempotency bind exactly as before.
- **QR:** the payload format is untouched (`teenpay://user/@handle?v=1`) — it carries the current handle and nothing else; scanning still never moves money. After an ID change the code simply shows the new handle.
- **Friend Circles:** reuse the same `relationOf` — one relationship, one place. Circles follow a rename automatically (they're account-id keyed).
- **Favourites:** remain a separate concept (quick-access contacts, stored handles) and are not merged with friendship.
- **Ledger:** never sees a TeenPay ID — ownership stays internal account ids.

**Persistence.** No schema bump: the username already lives on the account record. Persisted usernames are now validated as untrusted input (`isValidTeenPayIdFormat`) — tampered ids fall through to the existing backup-and-recovery path. Reserved names are a claim-time rule, not a storage rule, so existing data is never rejected for claiming a name that later became reserved.

**Tests.** New suites: `identity-domain` (normalization, valid/invalid/reserved ids, availability vocabulary), `identity-engine` (availability states, safe projection, canonical search, change-ID semantics), `identity-privacy` (exact projection shape, faceless availability, parent refusals, historical immutability), `identity-integration` (money through changed IDs with guardian rules intact, freed-ID no-inheritance, request lifecycle by account id, favourites degradation, Friend Circles and QR following the alias), `identity-ui` (profile card, copy/share, change flow, `/id` lookup and surface, route safety), `identity-security` (static audit: one accounts-only write, no account spreads into views, handle-only clipboard/share, URL safety, teen-only permission, centralized reserved list), and the 42-step `phase13-journey`. All earlier suites remain unchanged and green.

**Limitations.**
- Sandbox only, one device, no sync; "availability" is per-device.
- Freed IDs become claimable again; old handle snapshots stay historical by design.
- No ID-change cooldown or history log in the sandbox (a server would add both).
- Exact-match lookup only — deliberately no fuzzy/people search.

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
- **Phase 7** — Pocket Money Autopilot: weekly/monthly schedules from a parent's wallet to a linked teen's, explicit idempotent execution (one `ALW-` operation per transfer day), missed-day and insufficient-funds policies, freeze safety, pause/resume/cancel/end date, parent and teen screens, schema v6 migration
- **Phase 8** — Send & Request Money: teen-to-teen transfers by TeenPay ID (one atomic `TRF-` operation, available money only, idempotent), money requests (pending → accepted / declined / cancelled / expired after 7 days), guardian limits and approvals for transfers, privacy-safe directory, Requests center, schema v7 migration
- **Phase 9** — QR Payments, Contacts & Fast Pay: a versioned TeenPay QR holding only the public TeenPay ID, a strict central validator, a camera scanner (BarcodeDetector) with an honest sandbox paste path, scan → confirm → existing Send/Request flow, owner-scoped favourites with Quick Pay / Quick Request, schema v8 migration
- **Phase 10** — Money Coach: a read-only, teen-only view of your own money (week / month / 30 days) — available, set aside, received, spent — with deterministic factual insights, goal progress, lessons and documented definitions; no writes, no network, no AI, no score
- **Phase 11** — Money Missions: ten short, optional, teen-only learning missions (reading, gentle checks, visiting Activity / Coach, and real evidence such as creating a Space) with deterministic progress saved in the one sandbox database; they never move money, need no spending and have no rewards, streaks, timers or reminders
- **Phase 12** — Friend Circles: teen-only trusted peer circles found by TeenPay ID (request → accept/decline, cancel, remove) saved as an additive field in the one sandbox database (schema stays v8); friends open the existing Send/Request flows with guardian rules fully intact; not a social network — no feeds, no browsing, no money data shared
- **Phase 13 (this)** — TeenPay ID: the stable public identity layer — centralized normalization/validation/reserved ids, structured availability, copy/share/change on Profile, canonical exact-match lookup at `/id` with one shared identity surface, teen-only `identity.use`; identity is an alias over the stable internal account id, so changing it never moves money or re-targets relationships; no schema bump
- **Later (recommendation only)** — a real auth provider behind `AuthService` and a cloud repository behind the repository contract, then real payment rails with a regulated provider
