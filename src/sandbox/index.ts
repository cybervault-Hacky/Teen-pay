/**
 * Sandbox barrel — the local financial engine.
 * UI imports state + actions from here; tests import engine + seed too.
 */

export { MAX_SANDBOX_TX_PAISE, MIN_TX_PAISE, parseAmountInput, validateTransferPaise } from "./amounts";
export type { AmountParseResult } from "./amounts";
export { newOperationKey, uid } from "./ids";
export {
  deriveBalance,
  deriveSpaceBalances,
  hasIdempotencyKey,
  postAllowance,
  postGoalContribution,
  postPayment,
  postSpaceMove,
} from "./ledger";
export type {
  AllowanceInput,
  GoalContributionInput,
  LedgerError,
  LedgerErrorCode,
  LedgerEvent,
  PaymentInput,
  PostOutcome,
  SpaceMoveInput,
} from "./ledger";
export {
  deriveGoals,
  deriveWallet,
  projectTransactions,
  reasonLabel,
  SPACE_LABELS,
} from "./projection";
export { SANDBOX_WALLET_ID, createSeedState } from "./seed";
export {
  clearPersistedState,
  createMemoryStorage,
  isSandboxState,
  loadPersistedState,
  SANDBOX_STORAGE_KEY,
  SANDBOX_VERSION,
  savePersistedState,
} from "./storage";
export type { LoadResult, SandboxState, StorageIssue, StorageLike } from "./storage";
export { SandboxProvider, useSandbox } from "./store";
export type {
  ActionResult,
  AllowanceInput as AllowanceActionInput,
  CreateRequestInput,
  GoalContributionActionInput,
  SandboxContextValue,
  SandboxProviderProps,
  SendPaymentInput,
  SpaceMoveActionInput,
} from "./store";
