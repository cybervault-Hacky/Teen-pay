import { coachINR } from "./coach";
import { productDay } from "./space";

/**
 * Domain: Money Missions (Phase 11) — short, optional, educational
 * challenges. Pure: no clock, no randomness, no I/O.
 *
 * A mission is a fixed list of steps. Completing a mission means
 * finishing its steps in order; each step is checked by the engine
 * (`sandbox/missions.ts`) before it counts:
 *
 *   · read     — a short explainer; finished by choosing Continue.
 *   · check    — one question; only the right answer finishes it
 *                (no penalty, try again as often as you like).
 *   · visit    — look at a real screen (Activity, a transaction, the
 *                Coach) and mark the step done *there*.
 *   · evidence — something that must be true in your own sandbox,
 *                read from existing selectors (e.g. you have a Space).
 *
 * Missions never move money, never pay out rewards, have no streaks,
 * timers, scores or leaderboards, and never require spending.
 */

// ── Categories ────────────────────────────────────────────────────

export const MISSION_CATEGORIES = ["basics", "save", "explore", "safety"] as const;
export type MissionCategory = (typeof MISSION_CATEGORIES)[number];

export const MISSION_CATEGORY_LABEL: Record<MissionCategory, string> = {
  basics: "Money basics",
  save: "Save",
  explore: "Explore",
  safety: "Safety",
};

// ── Steps ─────────────────────────────────────────────────────────

/** Screens a visit step can send you to. */
export const MISSION_SURFACES = ["activity", "transaction", "coach"] as const;
export type MissionSurface = (typeof MISSION_SURFACES)[number];

/** Facts an evidence step can require (read from your own data). */
export const MISSION_EVIDENCE = ["custom_space", "goal_target"] as const;
export type MissionEvidenceRule = (typeof MISSION_EVIDENCE)[number];

interface StepBase {
  /** Stable within its mission. */
  id: string;
  title: string;
}

export interface ReadStep extends StepBase {
  kind: "read";
  body: readonly string[];
}

export interface CheckStep extends StepBase {
  kind: "check";
  /** `title` is the question. */
  options: readonly string[];
  /** Index into `options`. */
  answer: number;
  /** Shown once answered correctly. */
  explanation: string;
  /** Shown after a wrong answer — neutral, never a penalty. */
  hint: string;
}

export interface VisitStep extends StepBase {
  kind: "visit";
  surface: MissionSurface;
  body: readonly string[];
  /** What to do on that screen before marking the step done there. */
  instruction: string;
  actionLabel: string;
  href: string;
}

export interface EvidenceStep extends StepBase {
  kind: "evidence";
  rule: MissionEvidenceRule;
  body: readonly string[];
  actionLabel: string;
  href: string;
}

export type MissionStep = ReadStep | CheckStep | VisitStep | EvidenceStep;
export type MissionStepKind = MissionStep["kind"];

// ── Missions ──────────────────────────────────────────────────────

/** Why a mission may be unavailable for now (derived, never stored). */
export type MissionLock = "needs_transaction";

export const MISSION_LOCK_REASON: Record<MissionLock, string> = {
  needs_transaction: "Available after your first transaction.",
};

export interface Mission {
  /** Stable, public slug (used in URLs). Never an account or record id. */
  id: string;
  title: string;
  /** One line for lists. */
  summary: string;
  /** The educational purpose, shown on the mission page. */
  purpose: string;
  category: MissionCategory;
  estimatedMinutes: number;
  steps: readonly MissionStep[];
  lock?: MissionLock;
  completion: { title: string; body: string };
}

export const MISSIONS: readonly Mission[] = [
  {
    id: "know-your-balance",
    title: "Know Your Balance",
    summary: "Where your balance comes from, and what changes it.",
    purpose: "See that your balance is worked out from completed money movements — not typed in.",
    category: "basics",
    estimatedMinutes: 3,
    steps: [
      {
        id: "total",
        kind: "read",
        title: "Your balance is a total",
        body: [
          "Your TeenPay balance isn't a number someone types in. It's added up from every completed money movement in your wallet: money in adds to it, money out takes away.",
          "Each movement is recorded once and never edited. If something is undone, like a refund, it's recorded as a new, separate entry.",
        ],
      },
      {
        id: "available",
        kind: "read",
        title: "Total and available",
        body: [
          "Your total is everything in your wallet. Your available balance is the part you can spend or send right now: the total, minus what's set aside in Money Spaces.",
        ],
      },
      {
        id: "check",
        kind: "check",
        title: "A payment is waiting for a parent's approval. What happens to your available balance?",
        options: ["It goes down straight away", "It stays the same until the payment completes", "It goes up"],
        answer: 1,
        explanation: "Only completed money movements change your balance. A payment waiting for approval hasn't happened yet.",
        hint: "Think about whether the money has actually moved yet.",
      },
    ],
    completion: {
      title: "You know how your balance is worked out.",
      body: "Your balance is the sum of completed money movements — nothing more, nothing less.",
    },
  },
  {
    id: "available-vs-set-aside",
    title: "Available vs Set Aside",
    summary: "How Money Spaces and your available balance fit together.",
    purpose: "Understand that money in a Space is still yours — just not counted as available to spend.",
    category: "basics",
    estimatedMinutes: 2,
    steps: [
      {
        id: "two-parts",
        kind: "read",
        title: "Two parts of one wallet",
        body: [
          "Money in a Money Space is still yours and still in your wallet. It's set aside for something, so it isn't counted as available to spend.",
          "Adding money to a Space lowers your available balance and raises the amount set aside by the same amount. Your total doesn't change, and it isn't spending. You can move it back whenever you like.",
        ],
      },
      {
        id: "check",
        kind: "check",
        title: "You have ₹1,000 available and move ₹300 into a Space. How much is available now?",
        options: ["₹1,000", "₹700", "₹1,300"],
        answer: 1,
        explanation: "₹300 is now set aside, so ₹700 is available. Your total is still ₹1,000.",
        hint: "Moving money into a Space takes it out of available — but it's still in your wallet.",
      },
    ],
    completion: {
      title: "You can tell available money from money set aside.",
      body: "Available is what you can use now; set aside is still yours, kept for something specific.",
    },
  },
  {
    id: "understand-pocket-money",
    title: "Understand Pocket Money",
    summary: "How scheduled pocket money arrives and when it counts.",
    purpose: "Learn how scheduled pocket money works and when it becomes part of your balance.",
    category: "basics",
    estimatedMinutes: 2,
    steps: [
      {
        id: "schedule",
        kind: "read",
        title: "Pocket money on a schedule",
        body: [
          "A parent or guardian can set pocket money to arrive on a schedule, like every week or every month. In the sandbox it moves from their wallet to yours.",
          "Only your parent or guardian can change the schedule. You can see the next payment on Home and in Family.",
        ],
      },
      {
        id: "arrives",
        kind: "read",
        title: "When it counts",
        body: [
          "Pocket money counts once it has arrived. Then it shows in Activity and becomes part of your available balance. A payment that's scheduled but hasn't happened yet isn't money you have.",
        ],
      },
      {
        id: "check",
        kind: "check",
        title: "Your next pocket money is scheduled for Friday. Is it part of your balance today?",
        options: ["Yes, it's already mine", "No, only once it arrives"],
        answer: 1,
        explanation: "Scheduled pocket money becomes part of your balance when it arrives, not before.",
        hint: "A schedule is a plan. What changes your balance is money that has actually arrived.",
      },
    ],
    completion: {
      title: "You know how pocket money works.",
      body: "It arrives on a schedule set by your parent or guardian, and counts once it has arrived.",
    },
  },
  {
    id: "send-vs-request",
    title: "Send vs Request",
    summary: "The difference between sending money and asking for it.",
    purpose: "Understand when money moves if you send it, and when it moves if you request it.",
    category: "basics",
    estimatedMinutes: 3,
    steps: [
      {
        id: "send",
        kind: "read",
        title: "Sending money",
        body: [
          "When you send money, you pick a person by their TeenPay ID, check the amount and confirm. It leaves your available balance when the payment completes.",
        ],
      },
      {
        id: "request",
        kind: "read",
        title: "Requesting money",
        body: [
          "A request asks someone to send you money. Nothing moves until they accept and pay it. They can also decline, and a request that isn't answered expires after 7 days.",
        ],
      },
      {
        id: "check",
        kind: "check",
        title: "You request ₹200 from a friend. When does your balance change?",
        options: ["As soon as you send the request", "When your friend pays the request", "After 7 days"],
        answer: 1,
        explanation: "A request is only a message until your friend pays it. Then the money arrives in your wallet.",
        hint: "A request asks for money — it doesn't move any by itself.",
      },
    ],
    completion: {
      title: "You know the difference between sending and requesting.",
      body: "Sending moves your money when it completes; a request only moves money when the other person pays it.",
    },
  },
  {
    id: "payment-safety",
    title: "Payment Safety",
    summary: "Checking payments, what approvals mean, and staying safe.",
    purpose: "Learn the habits that keep payments safe, and what a payment approval means.",
    category: "safety",
    estimatedMinutes: 3,
    steps: [
      {
        id: "check-first",
        kind: "read",
        title: "Check before you confirm",
        body: [
          "Before any payment, TeenPay shows who it's going to and how much. Check the name and TeenPay ID. Until you confirm, you can always go back.",
        ],
      },
      {
        id: "approvals",
        kind: "read",
        title: "What an approval means",
        body: [
          "Your family can set a rule that some payments need a parent or guardian to approve them. Until they do, the money hasn't moved. If they decline, nothing moves at all.",
        ],
      },
      {
        id: "yours",
        kind: "read",
        title: "Keep your account yours",
        body: [
          "Your TeenPay ID and QR code are safe to share. They only let people find you, and a QR code can never make you pay: you always review and confirm.",
          "Never share sign-in details or one-time codes with anyone, even friends.",
        ],
      },
      {
        id: "check",
        kind: "check",
        title: "Someone you don't know sends you a QR code and asks you to pay it to unlock a prize. What's the safe choice?",
        options: ["Pay a small amount to see if it's real", "Don't pay, and tell a parent or guardian", "Send them your QR code back"],
        answer: 1,
        explanation: "Real prizes never ask you to pay first. It's always fine to stop and ask someone you trust.",
        hint: "Would a real prize ever need you to pay first?",
      },
    ],
    completion: {
      title: "You know how to keep payments safe.",
      body: "Check before you confirm, know what an approval means, and never pay to unlock a prize.",
    },
  },
  {
    id: "explore-spending",
    title: "Explore Your Spending",
    summary: "Find your completed payments and transfers in Activity.",
    purpose: "Learn where to review your spending: completed payments and transfers you've sent.",
    category: "explore",
    estimatedMinutes: 3,
    steps: [
      {
        id: "where",
        kind: "read",
        title: "Where spending shows up",
        body: [
          "Activity lists the completed money movements in your wallet, newest first. Payments and transfers you've sent are your spending.",
          "A payment that's waiting for approval isn't spending yet. It only counts once it completes.",
        ],
      },
      {
        id: "look",
        kind: "visit",
        surface: "activity",
        title: "Look through your Activity",
        body: ["Open Activity and look through your recent money movements: what came in, and what went out."],
        instruction: "When you've looked through your activity, mark this step done.",
        actionLabel: "Review Activity",
        href: "/activity?mission=explore-spending",
      },
    ],
    completion: {
      title: "You know where to review your spending.",
      body: "Activity is the place to look back at completed money movements whenever you want to.",
    },
  },
  {
    id: "review-transaction",
    title: "Review a Transaction",
    summary: "What a transaction's details, reference and status tell you.",
    purpose: "Learn to read a transaction: amount, who it was with, when, its reference and status.",
    category: "explore",
    estimatedMinutes: 2,
    lock: "needs_transaction",
    steps: [
      {
        id: "parts",
        kind: "read",
        title: "What a transaction shows",
        body: [
          "Each completed transaction shows the amount, who it was with, the date and time, and a reference code. The reference is how you'd find that exact transaction again.",
        ],
      },
      {
        id: "open",
        kind: "visit",
        surface: "transaction",
        title: "Open a transaction",
        body: ["Open any completed transaction in Activity and look at its details."],
        instruction: "Open a completed transaction below. After you've looked at its details, mark this step done.",
        actionLabel: "Open Activity",
        href: "/activity?mission=review-transaction",
      },
      {
        id: "check",
        kind: "check",
        title: "A payment is refunded. What happens to the original transaction?",
        options: ["It's edited to show the new amount", "It stays as it was, and the refund is a separate entry", "It's deleted"],
        answer: 1,
        explanation: "Transactions are never edited or deleted. A refund is a new entry linked to the original.",
        hint: "Remember: completed money movements are recorded once and never changed.",
      },
    ],
    completion: {
      title: "You can read a transaction's details.",
      body: "Amount, who, when, reference and status — everything you need to recognise a transaction.",
    },
  },
  {
    id: "build-a-space",
    title: "Build a Money Space",
    summary: "Create a Space to set money aside for something.",
    purpose: "Learn how setting money aside works by creating a Space of your own.",
    category: "save",
    estimatedMinutes: 3,
    steps: [
      {
        id: "job",
        kind: "read",
        title: "Give money a job",
        body: [
          "A Money Space sets money aside for something, like a gift or a trip. The money stays in your wallet; it just isn't counted as available.",
          "You decide whether to add money, and you can move it back to available whenever you like.",
        ],
      },
      {
        id: "create",
        kind: "evidence",
        rule: "custom_space",
        title: "Create a Space",
        body: [
          "On the Money screen, choose New space and give it a name. You don't need to add any money to finish this mission.",
        ],
        actionLabel: "Open Money Spaces",
        href: "/money?mission=build-a-space",
      },
    ],
    completion: {
      title: "You built a Money Space.",
      body: "You can use it to set money aside whenever you want — or leave it empty. It's up to you.",
    },
  },
  {
    id: "set-saving-goal",
    title: "Set a Saving Goal",
    summary: "Give a goal a target so you can see your progress.",
    purpose: "Learn how a target amount helps you see progress toward something you want.",
    category: "save",
    estimatedMinutes: 3,
    steps: [
      {
        id: "target",
        kind: "read",
        title: "Why a target helps",
        body: [
          "A goal is a Space with a target amount. It shows how far along you are and how much is left, so you can see progress at a glance.",
          "Pick an amount that makes sense for you. A target date is optional, and you can change the goal any time.",
        ],
      },
      {
        id: "goal",
        kind: "evidence",
        rule: "goal_target",
        title: "Have a goal with a target",
        body: ["Create a goal on the Money screen, or use one you already have."],
        actionLabel: "Open Money Spaces",
        href: "/money?mission=set-saving-goal",
      },
    ],
    completion: {
      title: "You have a saving goal.",
      body: "Your goal's progress shows on the Money screen and in Money Coach. There's no rush.",
    },
  },
  {
    id: "learn-from-coach",
    title: "Learn From Your Coach",
    summary: "See what Money Coach shows and read one of its lessons.",
    purpose: "Connect Money Coach's summary of your money with what each number means.",
    category: "explore",
    estimatedMinutes: 3,
    steps: [
      {
        id: "what",
        kind: "read",
        title: "What the Coach shows",
        body: [
          "Money Coach sums up your own money for a week, a month or the last 30 days: what came in, what went out and what's set aside. It only reads your data. It never moves money.",
        ],
      },
      {
        id: "lesson",
        kind: "visit",
        surface: "coach",
        title: "Read a Coach lesson",
        body: ["Open Money Coach and read one of the lessons in its Learn section."],
        instruction: "Open a lesson in Learn below. After you've read it, mark this step done.",
        actionLabel: "Open Money Coach",
        href: "/coach?mission=learn-from-coach",
      },
      {
        id: "check",
        kind: "check",
        title: "Which of these does Money Coach count as spending?",
        options: ["Money moved into a Space", "A completed payment you sent", "A payment waiting for approval"],
        answer: 1,
        explanation: "Only completed payments and transfers you've sent count as spending. Space moves and pending payments don't.",
        hint: "Spending means money that has actually left your wallet.",
      },
    ],
    completion: {
      title: "You know how to learn from your Coach.",
      body: "Money Coach explains every number it shows. Its Learn section is there whenever you need it.",
    },
  },
];

export type MissionId = (typeof MISSIONS)[number]["id"];

export function missionById(id: unknown): Mission | undefined {
  return typeof id === "string" ? MISSIONS.find((m) => m.id === id) : undefined;
}

export function isMissionId(id: unknown): id is string {
  return missionById(id) !== undefined;
}

// ── Stored progress ───────────────────────────────────────────────

/**
 * One teen's progress on one mission — the only mission data that is
 * stored. Minimal: which mission, how many steps are done, when.
 * No answers, transaction details, wallet ids or anything else.
 * A completed mission stays completed (only Reset Sandbox clears it).
 */
export interface MissionProgress {
  ownerAccountId: string;
  missionId: string;
  /** 0..steps.length. Equal to steps.length iff completed. */
  stepsCompleted: number;
  startedAt: string;
  updatedAt: string;
  /** Set when the last step is finished; never cleared. */
  completedAt?: string;
}

/** The exact keys a stored progress record may have (`completedAt` optional). */
export const MISSION_PROGRESS_KEYS = ["ownerAccountId", "missionId", "stepsCompleted", "startedAt", "updatedAt", "completedAt"] as const;

// ── Derived views ─────────────────────────────────────────────────

export const MISSION_STATUSES = ["available", "in_progress", "completed", "locked"] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

/** Facts from the teen's own data that steps and locks depend on. */
export interface MissionFacts {
  /** Name of the teen's first active custom Space, if any. */
  customSpace: string | null;
  /** The teen's first active goal with a target, if any. */
  goalWithTarget: { name: string; target: number } | null;
  /** The teen's wallet has at least one completed transaction. */
  hasTransactions: boolean;
}

export type MissionStepState = "done" | "current" | "upcoming";

export type MissionStepView = MissionStep & {
  state: MissionStepState;
  /** 1-based position, for "Step 2 of 3". */
  number: number;
  /** Evidence steps: is it true right now, and in words. */
  evidence?: { met: boolean; text: string };
};

export interface MissionView {
  id: string;
  href: string;
  title: string;
  summary: string;
  purpose: string;
  category: MissionCategory;
  categoryLabel: string;
  estimatedMinutes: number;
  status: MissionStatus;
  /** Status in words — never colour alone. */
  statusLabel: string;
  progress: { completedSteps: number; totalSteps: number };
  steps: MissionStepView[];
  /** The step to do next (in progress only). */
  currentStep: MissionStepView | null;
  lockedReason: string | null;
  completion: { title: string; body: string };
  /** The day it was completed (YYYY-MM-DD), when completed. */
  completedOn: string | null;
}

export interface MissionBoard {
  missions: MissionView[];
  completed: number;
  total: number;
  /** In progress first, then the first available — or null when all done. */
  next: MissionView | null;
}

export function evidenceMet(rule: MissionEvidenceRule, facts: MissionFacts): boolean {
  return rule === "custom_space" ? facts.customSpace !== null : facts.goalWithTarget !== null;
}

export function evidenceText(rule: MissionEvidenceRule, facts: MissionFacts): string {
  if (rule === "custom_space") {
    return facts.customSpace ? `You have a Space: ${facts.customSpace}.` : "You don't have a Space of your own yet.";
  }
  return facts.goalWithTarget
    ? `Your goal ${facts.goalWithTarget.name} has a ${coachINR(facts.goalWithTarget.target)} target.`
    : "You don't have a goal with a target yet.";
}

function isLocked(mission: Mission, facts: MissionFacts): boolean {
  return mission.lock === "needs_transaction" && !facts.hasTransactions;
}

/** Clamp a stored count to the mission (defensive; storage is validated). */
function doneCount(mission: Mission, record: MissionProgress | undefined): number {
  if (!record) return 0;
  const n = Math.trunc(record.stepsCompleted);
  return Math.max(0, Math.min(mission.steps.length, Number.isFinite(n) ? n : 0));
}

export function deriveMissionView(
  mission: Mission,
  record: MissionProgress | undefined,
  facts: MissionFacts,
): MissionView {
  const total = mission.steps.length;
  const done = doneCount(mission, record);
  const completed = !!record?.completedAt && done === total;
  // A completed mission stays completed even if a lock would now apply.
  const locked = !completed && isLocked(mission, facts);
  const status: MissionStatus = completed ? "completed" : locked ? "locked" : record ? "in_progress" : "available";

  const steps: MissionStepView[] = mission.steps.map((step, i) => {
    const state: MissionStepState = completed || i < done ? "done" : i === done && status === "in_progress" ? "current" : "upcoming";
    return {
      ...step,
      state,
      number: i + 1,
      ...(step.kind === "evidence"
        ? { evidence: { met: evidenceMet(step.rule, facts), text: evidenceText(step.rule, facts) } }
        : {}),
    };
  });

  const statusLabel =
    status === "completed"
      ? "Completed"
      : status === "locked"
        ? "Locked"
        : status === "in_progress"
          ? `In progress · Step ${done + 1} of ${total}`
          : "Not started";

  return {
    id: mission.id,
    href: `/missions/${mission.id}`,
    title: mission.title,
    summary: mission.summary,
    purpose: mission.purpose,
    category: mission.category,
    categoryLabel: MISSION_CATEGORY_LABEL[mission.category],
    estimatedMinutes: mission.estimatedMinutes,
    status,
    statusLabel,
    progress: { completedSteps: completed ? total : done, totalSteps: total },
    steps,
    currentStep: status === "in_progress" ? (steps[done] ?? null) : null,
    lockedReason: locked && mission.lock ? MISSION_LOCK_REASON[mission.lock] : null,
    completion: mission.completion,
    completedOn: completed && record?.completedAt ? productDay(record.completedAt) : null,
  };
}

export function deriveMissionBoard(records: readonly MissionProgress[], facts: MissionFacts): MissionBoard {
  const missions = MISSIONS.map((m) =>
    deriveMissionView(
      m,
      records.find((r) => r.missionId === m.id),
      facts,
    ),
  );
  const completed = missions.filter((m) => m.status === "completed").length;
  const next =
    missions.find((m) => m.status === "in_progress") ?? missions.find((m) => m.status === "available") ?? null;
  return { missions, completed, total: missions.length, next };
}

/** Why a step can't be finished right now, or null if it can. */
export type StepProblem = "wrong_order" | "wrong_answer" | "evidence_missing";

export function checkStep(
  step: MissionStep,
  input: { answer?: number },
  facts: MissionFacts,
): Exclude<StepProblem, "wrong_order"> | null {
  switch (step.kind) {
    case "check":
      return input.answer === step.answer ? null : "wrong_answer";
    case "evidence":
      return evidenceMet(step.rule, facts) ? null : "evidence_missing";
    case "read":
    case "visit":
      return null;
  }
}
