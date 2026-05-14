import { getAddress } from "ethers/address";
import { createDefaultQueuePolicy } from "./queueHistory";
import { sanitizeQueueMessage, summarizeCalldata } from "./queueRedaction";
import type {
  PreparedQueueTransactionDraft,
  QueueActionType,
  QueueErrorCategory,
  QueueExecutionError,
  QueueExecutionPolicy,
  QueueFeeDraft,
  QueueJobRecord,
  QueueJobStatus,
  QueueJobSummary,
  QueueSourceModule,
  QueueTransactionRecord,
} from "./queueTypes";

export interface QueueUnsignedTransactionRequest {
  chainId: number;
  from: string;
  to: string | null;
  valueWei: string;
  data: string;
  gasLimit: string;
  nonce: number;
  fee: QueueFeeDraft;
}

export interface QueueSigner {
  signTransaction(accountId: string, request: QueueUnsignedTransactionRequest): Promise<string>;
}

export interface QueueBroadcaster {
  validateChainId(expectedChainId: number): Promise<number>;
  getPendingNonce(accountAddress: string): Promise<number>;
  broadcastSignedTransaction(rawSignedTransaction: string): Promise<string>;
}

export interface QueueClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RunQueueJobInput {
  chainId: number;
  title: string;
  sourceModule: QueueSourceModule;
  drafts: PreparedQueueTransactionDraft[];
  policy?: QueueExecutionPolicy;
  signer: QueueSigner;
  broadcaster: QueueBroadcaster;
  clock?: QueueClock;
  shouldStop?: () => boolean;
  pendingNonceByAccountId?: Map<string, number>;
}

export interface RunQueueJobResult {
  job: QueueJobRecord;
  transactions: QueueTransactionRecord[];
  historyUpdates: QueueTransactionRecord[];
}

export interface QueueRecoveryInput {
  chainId: number;
  title: string;
  historyTransactions: QueueTransactionRecord[];
  sessionDraftsByTransactionId: Map<string, PreparedQueueTransactionDraft>;
  targetTransactionId?: string;
  targetAccountId?: string;
  policy?: QueueExecutionPolicy;
  signer: QueueSigner;
  broadcaster: QueueBroadcaster;
  clock?: QueueClock;
  shouldStop?: () => boolean;
}

interface QueueExecutionRuntime {
  tokenBucket: RpcTokenBucket;
  skipChainValidation: boolean;
}

interface PreparedLaneEntry {
  draft: PreparedQueueTransactionDraft;
  inputIndex: number;
}

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const systemClock: QueueClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
};

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function createQueueError(
  category: QueueErrorCategory,
  message: unknown,
  retryable: boolean,
): QueueExecutionError {
  return {
    category,
    message: sanitizeQueueMessage(message),
    retryable,
  };
}

function stoppedError(message: string) {
  return createQueueError("user-stopped", message, true);
}

function normalizePolicy(policy: QueueExecutionPolicy | undefined): QueueExecutionPolicy {
  const resolvedPolicy = policy ?? createDefaultQueuePolicy();
  if (
    !Number.isInteger(resolvedPolicy.concurrency) ||
    resolvedPolicy.concurrency < 1 ||
    resolvedPolicy.concurrency > 100 ||
    !Number.isInteger(resolvedPolicy.walletIntervalMs) ||
    resolvedPolicy.walletIntervalMs < 0 ||
    resolvedPolicy.walletIntervalMs > 60_000 ||
    !Number.isInteger(resolvedPolicy.rpcRequestsPerSecond) ||
    resolvedPolicy.rpcRequestsPerSecond < 1 ||
    resolvedPolicy.rpcRequestsPerSecond > 500 ||
    typeof resolvedPolicy.continueOnFailure !== "boolean" ||
    typeof resolvedPolicy.rerunFromFailedNonce !== "boolean"
  ) {
    throw new Error("Invalid queue policy.");
  }
  return resolvedPolicy;
}

function normalizeAddress(value: string) {
  return getAddress(value);
}

function normalizeAddressOrNull(value: string | null) {
  return value === null ? null : normalizeAddress(value);
}

function safeTxHash(value: string) {
  return TX_HASH_PATTERN.test(value) ? value.toLowerCase() : null;
}

function feeSummary(draft: PreparedQueueTransactionDraft): QueueTransactionRecord["feeSummary"] {
  if (draft.fee.mode === "legacy") {
    return {
      mode: "legacy",
      gasLimit: draft.gasLimit,
      gasPriceGwei: draft.fee.gasPriceGwei ?? "0",
    };
  }

  return {
    mode: "eip1559",
    gasLimit: draft.gasLimit,
    maxFeePerGasGwei: draft.fee.maxFeePerGasGwei ?? "0",
    maxPriorityFeePerGasGwei: draft.fee.maxPriorityFeePerGasGwei ?? "0",
  };
}

function createTransactionRecord(
  jobId: string,
  draft: PreparedQueueTransactionDraft,
  nonce: number | null,
): QueueTransactionRecord {
  const timestamp = nowIso();
  return {
    id: createId("queue-tx"),
    jobId,
    chainId: draft.chainId,
    accountId: draft.accountId,
    accountAddress: normalizeAddress(draft.accountAddress),
    nonce,
    status: "queued",
    actionType: draft.actionType as QueueActionType,
    target: normalizeAddressOrNull(draft.to),
    valueWei: draft.valueWei,
    calldataSummary: summarizeCalldata(draft.data),
    feeSummary: feeSummary(draft),
    txHash: null,
    error: null,
    retryOfTransactionId: draft.retryOfTransactionId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function updateTransaction(
  transaction: QueueTransactionRecord,
  update: Pick<Partial<QueueTransactionRecord>, "status" | "txHash" | "error">,
): QueueTransactionRecord {
  return {
    ...transaction,
    ...update,
    updatedAt: nowIso(),
  };
}

function summarizeTransactions(transactions: QueueTransactionRecord[]): QueueJobSummary {
  return {
    total: transactions.length,
    pending: transactions.filter((transaction) => transaction.status === "pending").length,
    failed: transactions.filter((transaction) => transaction.status === "failed").length,
    stopped: transactions.filter((transaction) => transaction.status === "stopped").length,
    completed: transactions.filter((transaction) => transaction.status === "pending").length,
  };
}

function deriveJobStatus(transactions: QueueTransactionRecord[]): QueueJobStatus {
  if (transactions.length === 0) return "completed";
  if (transactions.every((transaction) => transaction.status === "pending")) return "completed";
  if (transactions.some((transaction) => transaction.status === "pending")) return "partial";
  if (transactions.some((transaction) => transaction.status === "stopped")) return "stopped";
  return "failed";
}

class RpcTokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly requestsPerSecond: number,
    private readonly clock: QueueClock,
  ) {
    this.tokens = Math.max(1, Math.floor(requestsPerSecond));
    this.lastRefillMs = clock.now();
  }

  async take() {
    const limit = Math.max(1, Math.floor(this.requestsPerSecond));
    this.refill(limit);
    if (this.tokens <= 0) {
      await this.clock.sleep(1000);
      this.tokens = limit;
      this.lastRefillMs = this.clock.now();
    }
    this.tokens -= 1;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previousOperation = this.queue;
    let releaseOperation: () => void;
    this.queue = new Promise((resolve) => {
      releaseOperation = resolve;
    });
    await previousOperation;
    try {
      await this.take();
    } finally {
      releaseOperation!();
    }
    return operation();
  }

  private refill(limit: number) {
    const elapsedMs = this.clock.now() - this.lastRefillMs;
    if (elapsedMs < 1000) return;

    const periods = Math.floor(elapsedMs / 1000);
    this.tokens = Math.min(limit, this.tokens + periods * limit);
    this.lastRefillMs += periods * 1000;
  }
}

function groupDraftsByAccount(drafts: PreparedQueueTransactionDraft[]) {
  const lanes = new Map<string, PreparedLaneEntry[]>();
  drafts.forEach((draft, inputIndex) => {
    const accountAddress = normalizeAddress(draft.accountAddress);
    const lane = lanes.get(accountAddress) ?? [];
    lane.push({ draft, inputIndex });
    lanes.set(accountAddress, lane);
  });
  return [...lanes.entries()];
}

function createFailureTransactions(
  jobId: string,
  drafts: PreparedQueueTransactionDraft[],
  error: QueueExecutionError,
) {
  return drafts.map((draft) => updateTransaction(createTransactionRecord(jobId, draft, null), { status: "failed", error }));
}

async function validateQueueChain(input: RunQueueJobInput, tokenBucket: RpcTokenBucket) {
  const actualChainId = await tokenBucket.run(() => input.broadcaster.validateChainId(input.chainId));
  if (actualChainId !== input.chainId) {
    throw new Error(`expected chain ${input.chainId}, got ${actualChainId}`);
  }
}

function stopRemainingLane(
  jobId: string,
  entries: PreparedLaneEntry[],
  transactionSlots: QueueTransactionRecord[],
  message: string,
  startingNonce: number | null,
) {
  let nextNonce = startingNonce;
  for (const { draft, inputIndex } of entries) {
    const transaction = createTransactionRecord(jobId, draft, nextNonce);
    if (nextNonce !== null) nextNonce += 1;
    transactionSlots[inputIndex] = updateTransaction(transaction, {
      status: "stopped",
      error: stoppedError(message),
    });
  }
}

function shouldStopQueue(input: RunQueueJobInput, stopAll: boolean) {
  return stopAll || input.shouldStop?.() === true;
}

function createUnsignedRequest(draft: PreparedQueueTransactionDraft, chainId: number, nonce: number) {
  return {
    chainId,
    from: normalizeAddress(draft.accountAddress),
    to: normalizeAddressOrNull(draft.to),
    valueWei: draft.valueWei,
    data: draft.data,
    gasLimit: draft.gasLimit,
    nonce,
    fee: draft.fee,
  };
}

export async function runQueueJob(input: RunQueueJobInput): Promise<RunQueueJobResult> {
  return runQueueJobWithRuntime(input);
}

async function runQueueJobWithRuntime(
  input: RunQueueJobInput,
  runtime?: QueueExecutionRuntime,
): Promise<RunQueueJobResult> {
  const policy = normalizePolicy(input.policy);
  const clock = input.clock ?? systemClock;
  const tokenBucket = runtime?.tokenBucket ?? new RpcTokenBucket(policy.rpcRequestsPerSecond, clock);
  const jobId = createId("queue-job");
  const createdAt = nowIso();
  const transactionSlots: QueueTransactionRecord[] = [];
  let stopAll = false;

  if (!runtime?.skipChainValidation) {
    try {
      await validateQueueChain(input, tokenBucket);
    } catch (error) {
      const transactions = createFailureTransactions(jobId, input.drafts, createQueueError("chain-mismatch", error, true));
      return {
        historyUpdates: [],
        job: createJobRecord(jobId, input, policy, createdAt, transactions),
        transactions,
      };
    }
  }

  const lanes = groupDraftsByAccount(input.drafts);
  let nextLaneIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(policy.concurrency)), lanes.length);

  async function runLane(accountAddress: string, entries: PreparedLaneEntry[]) {
    let nextNonce: number;
    try {
      const accountId = entries[0]?.draft.accountId;
      nextNonce =
        (accountId ? input.pendingNonceByAccountId?.get(accountId) : undefined) ??
        (await tokenBucket.run(() => input.broadcaster.getPendingNonce(accountAddress)));
    } catch (error) {
      const nonceError = createQueueError("nonce-load-failed", error, true);
      for (const { draft, inputIndex } of entries) {
        transactionSlots[inputIndex] = updateTransaction(createTransactionRecord(jobId, draft, null), {
          status: "failed",
          error: nonceError,
        });
      }
      if (!policy.continueOnFailure) stopAll = true;
      return;
    }

    for (let laneIndex = 0; laneIndex < entries.length; laneIndex += 1) {
      const { draft, inputIndex } = entries[laneIndex];
      const transaction = createTransactionRecord(jobId, draft, nextNonce);
      nextNonce += 1;

      if (laneIndex > 0 && policy.walletIntervalMs > 0) {
        await clock.sleep(policy.walletIntervalMs);
      }

      if (shouldStopQueue(input, stopAll)) {
        transactionSlots[inputIndex] = updateTransaction(transaction, {
          status: "stopped",
          error: stoppedError("stopped before transaction started"),
        });
        continue;
      }

      let rawSignedTransaction: string;
      try {
        rawSignedTransaction = await input.signer.signTransaction(
          draft.accountId,
          createUnsignedRequest(draft, input.chainId, transaction.nonce ?? 0),
        );
      } catch (error) {
        transactionSlots[inputIndex] = updateTransaction(transaction, {
          status: "failed",
          error: createQueueError("signing-failed", error, true),
        });
        stopRemainingLane(
          jobId,
          entries.slice(laneIndex + 1),
          transactionSlots,
          "stopped after earlier lane nonce failed",
          nextNonce,
        );
        if (!policy.continueOnFailure) stopAll = true;
        return;
      }

      if (shouldStopQueue(input, stopAll)) {
        transactionSlots[inputIndex] = updateTransaction(transaction, {
          status: "stopped",
          error: stoppedError("stopped after transaction signed before broadcast"),
        });
        stopRemainingLane(
          jobId,
          entries.slice(laneIndex + 1),
          transactionSlots,
          "stopped after earlier lane transaction was stopped",
          nextNonce,
        );
        stopAll = true;
        return;
      }

      try {
        const broadcastHash = await tokenBucket.run(() =>
          input.broadcaster.broadcastSignedTransaction(rawSignedTransaction),
        );
        transactionSlots[inputIndex] = updateTransaction(transaction, {
          status: "pending",
          txHash: safeTxHash(broadcastHash),
        });
      } catch (error) {
        transactionSlots[inputIndex] = updateTransaction(transaction, {
          status: "failed",
          error: createQueueError("broadcast-failed", error, true),
        });
        stopRemainingLane(
          jobId,
          entries.slice(laneIndex + 1),
          transactionSlots,
          "stopped after earlier lane nonce failed",
          nextNonce,
        );
        if (!policy.continueOnFailure) stopAll = true;
        return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextLaneIndex < lanes.length) {
        const lane = lanes[nextLaneIndex];
        nextLaneIndex += 1;
        if (!lane) continue;
        const [accountAddress, entries] = lane;
        if (stopAll) {
          stopRemainingLane(jobId, entries, transactionSlots, "stopped before account lane started", null);
          continue;
        }
        await runLane(accountAddress, entries);
      }
    }),
  );

  const transactions = transactionSlots.filter((transaction): transaction is QueueTransactionRecord => Boolean(transaction));
  return {
    historyUpdates: [],
    job: createJobRecord(jobId, input, policy, createdAt, transactions),
    transactions,
  };
}

function createJobRecord(
  jobId: string,
  input: Pick<RunQueueJobInput, "chainId" | "title" | "sourceModule">,
  policy: QueueExecutionPolicy,
  createdAt: string,
  transactions: QueueTransactionRecord[],
): QueueJobRecord {
  return {
    id: jobId,
    chainId: input.chainId,
    title: sanitizeQueueMessage(input.title),
    sourceModule: input.sourceModule,
    status: deriveJobStatus(transactions),
    createdAt,
    updatedAt: nowIso(),
    executionPolicy: policy,
    transactionIds: transactions.map((transaction) => transaction.id),
    summary: summarizeTransactions(transactions),
  };
}

function requireSessionDrafts(
  transactions: QueueTransactionRecord[],
  sessionDraftsByTransactionId: Map<string, PreparedQueueTransactionDraft>,
) {
  const drafts = transactions.map((transaction) => {
    const draft = sessionDraftsByTransactionId.get(transaction.id);
    if (!draft) {
      throw new Error("current-tab prepared drafts are required for queue recovery");
    }
    assertDraftMatchesTransaction(draft, transaction);
    return draft;
  });
  return drafts;
}

function assertDraftMatchesTransaction(draft: PreparedQueueTransactionDraft, transaction: QueueTransactionRecord) {
  if (
    draft.chainId !== transaction.chainId ||
    draft.accountId !== transaction.accountId ||
    normalizeAddress(draft.accountAddress) !== normalizeAddress(transaction.accountAddress) ||
    normalizeAddressOrNull(draft.to) !== normalizeAddressOrNull(transaction.target) ||
    draft.valueWei !== transaction.valueWei ||
    draft.actionType !== transaction.actionType ||
    draft.gasLimit !== transaction.feeSummary.gasLimit ||
    summarizeCalldata(draft.data).selector !== transaction.calldataSummary.selector ||
    summarizeCalldata(draft.data).byteLength !== transaction.calldataSummary.byteLength ||
    !draftFeeMatchesTransaction(draft.fee, transaction)
  ) {
    throw new Error("current-tab prepared draft does not match queue history record");
  }
}

function draftFeeMatchesTransaction(fee: QueueFeeDraft, transaction: QueueTransactionRecord) {
  const summary = transaction.feeSummary;
  if (fee.mode !== summary.mode || fee.gasLimit !== summary.gasLimit) return false;
  if (summary.mode === "legacy") return fee.gasPriceGwei === summary.gasPriceGwei;
  return (
    fee.maxFeePerGasGwei === summary.maxFeePerGasGwei &&
    fee.maxPriorityFeePerGasGwei === summary.maxPriorityFeePerGasGwei
  );
}

function retryDraft(draft: PreparedQueueTransactionDraft, retryOfTransactionId: string): PreparedQueueTransactionDraft {
  return {
    ...draft,
    id: createId("queue-retry-draft"),
    retryOfTransactionId,
  };
}

function markNonceConsumed(record: QueueTransactionRecord): QueueTransactionRecord {
  return updateTransaction(record, {
    status: "skipped",
    error: createQueueError("nonce-consumed", "stale transaction skipped because account nonce was already consumed", true),
  });
}

function markQueued(record: QueueTransactionRecord): QueueTransactionRecord {
  return updateTransaction(record, {
    status: "queued",
    error: null,
  });
}

function firstNonce(records: QueueTransactionRecord[]) {
  return (
    records
      .map((record) => record.nonce)
      .filter((nonce): nonce is number => nonce !== null)
      .sort((left, right) => left - right)[0] ?? null
  );
}

async function readPendingNoncesByAccount(
  input: QueueRecoveryInput,
  transactions: QueueTransactionRecord[],
  tokenBucket: RpcTokenBucket,
  draftsByTransactionId: Map<string, PreparedQueueTransactionDraft>,
): Promise<{ pendingNonces: Map<string, number>; failures: QueueTransactionRecord[] }> {
  const accountAddresses = new Map<string, string>();
  for (const transaction of transactions) {
    accountAddresses.set(transaction.accountId, transaction.accountAddress);
  }

  const pendingNonces = new Map<string, number>();
  const failuresByAccount = new Map<string, QueueExecutionError>();
  const nonceReads = await Promise.all(
    [...accountAddresses.entries()].map(async ([accountId, accountAddress]) => {
      try {
        pendingNonces.set(accountId, await tokenBucket.run(() => input.broadcaster.getPendingNonce(accountAddress)));
      } catch (error) {
        failuresByAccount.set(accountId, createQueueError("nonce-load-failed", error, true));
      }
    }),
  );
  void nonceReads;

  return {
    failures: transactions
      .filter((transaction) => failuresByAccount.has(transaction.accountId))
      .map((transaction) =>
        updateTransaction(createTransactionRecord(createId("queue-job"), retryDraft(draftsByTransactionId.get(transaction.id)!, transaction.id), null), {
          status: "failed",
          error: failuresByAccount.get(transaction.accountId)!,
        }),
      ),
    pendingNonces,
  };
}

async function runRecoveryQueue(
  input: QueueRecoveryInput,
  drafts: PreparedQueueTransactionDraft[],
  pendingNonceByAccountId?: Map<string, number>,
  tokenBucket?: RpcTokenBucket,
) {
  return runQueueJobWithRuntime(
    {
      chainId: input.chainId,
      title: input.title,
      sourceModule: "queue",
      drafts,
      policy: input.policy,
      signer: input.signer,
      broadcaster: input.broadcaster,
      clock: input.clock,
      shouldStop: input.shouldStop,
      pendingNonceByAccountId,
    },
    tokenBucket ? { skipChainValidation: true, tokenBucket } : undefined,
  );
}

export async function resumeStoppedQueueJob(input: QueueRecoveryInput): Promise<RunQueueJobResult> {
  const stoppedTransactions = input.historyTransactions.filter((transaction) => transaction.status === "stopped");
  const retryDrafts = requireSessionDrafts(stoppedTransactions, input.sessionDraftsByTransactionId).map((draft, index) =>
    retryDraft(draft, stoppedTransactions[index].id),
  );
  const result = await runRecoveryQueue(input, retryDrafts);
  const successIds = successfulRetryIds(result);
  return { ...result, historyUpdates: stoppedTransactions.filter((record) => successIds.has(record.id)).map(markQueued) };
}

export async function retryFailedQueueJob(input: QueueRecoveryInput): Promise<RunQueueJobResult> {
  const policy = normalizePolicy(input.policy);
  const clock = input.clock ?? systemClock;
  const tokenBucket = new RpcTokenBucket(policy.rpcRequestsPerSecond, clock);
  const failedTransactions = input.historyTransactions.filter(
    (transaction) => transaction.status === "failed" && transaction.error?.retryable !== false,
  );
  const failedDrafts = requireSessionDrafts(failedTransactions, input.sessionDraftsByTransactionId);
  const failedDraftsByTransactionId = new Map(
    failedTransactions.map((transaction, index) => [transaction.id, failedDrafts[index]]),
  );
  const allRetryDrafts = failedTransactions.map((transaction) =>
    retryDraft(failedDraftsByTransactionId.get(transaction.id)!, transaction.id),
  );
  try {
    await validateQueueChain(
      {
        chainId: input.chainId,
        title: input.title,
        sourceModule: "queue",
        drafts: allRetryDrafts,
        policy,
        signer: input.signer,
        broadcaster: input.broadcaster,
        clock,
        shouldStop: input.shouldStop,
      },
      tokenBucket,
    );
  } catch (error) {
    const jobId = createId("queue-job");
    const createdAt = nowIso();
    const transactions = createFailureTransactions(jobId, allRetryDrafts, createQueueError("chain-mismatch", error, true));
    return {
      historyUpdates: [],
      job: createJobRecord(
        jobId,
        { chainId: input.chainId, title: input.title, sourceModule: "queue" },
        policy,
        createdAt,
        transactions,
      ),
      transactions,
    };
  }
  const { failures: nonceLoadFailures, pendingNonces: pendingNoncesByAccount } = await readPendingNoncesByAccount(
    input,
    failedTransactions,
    tokenBucket,
    failedDraftsByTransactionId,
  );
  const retryableTransactions = failedTransactions.filter((transaction) => {
    const pendingNonce = pendingNoncesByAccount.get(transaction.accountId);
    return transaction.nonce !== null && pendingNonce === transaction.nonce;
  });
  const seenRetryNonceByAccount = new Set<string>();
  const safeRetryableTransactions = retryableTransactions.filter((transaction) => {
    const key = `${transaction.accountId}:${transaction.nonce}`;
    if (seenRetryNonceByAccount.has(key)) return false;
    seenRetryNonceByAccount.add(key);
    return true;
  });
  const retryDrafts = safeRetryableTransactions.map((transaction) =>
    retryDraft(failedDraftsByTransactionId.get(transaction.id)!, transaction.id),
  );
  const result = await runRecoveryQueue(input, retryDrafts, pendingNoncesByAccount, tokenBucket);
  const historyUpdates = failedTransactions
    .filter((transaction) => {
      const pendingNonce = pendingNoncesByAccount.get(transaction.accountId);
      return transaction.nonce !== null && pendingNonce !== undefined && pendingNonce > transaction.nonce;
    })
    .map(markNonceConsumed);

  return {
    ...result,
    job: createJobRecord(result.job.id, result.job, policy, result.job.createdAt, [...nonceLoadFailures, ...result.transactions]),
    transactions: [...nonceLoadFailures, ...result.transactions],
    historyUpdates,
  };
}

function successfulRetryIds(result: RunQueueJobResult) {
  return new Set(
    result.transactions
      .filter((transaction) => transaction.status === "pending" && transaction.retryOfTransactionId)
      .map((transaction) => transaction.retryOfTransactionId),
  );
}

function selectRerunFailedTransaction(input: QueueRecoveryInput, failedTransactions: QueueTransactionRecord[]) {
  if (input.targetTransactionId) {
    return failedTransactions.find((transaction) => transaction.id === input.targetTransactionId) ?? null;
  }

  if (input.targetAccountId) {
    const accountFailures = failedTransactions.filter((transaction) => transaction.accountId === input.targetAccountId);
    const failedNonce = firstNonce(accountFailures);
    return failedNonce === null
      ? null
      : (accountFailures.find((transaction) => transaction.nonce === failedNonce) ?? null);
  }

  const accountIds = new Set(failedTransactions.map((transaction) => transaction.accountId));
  if (accountIds.size !== 1) return null;

  const failedNonce = firstNonce(failedTransactions);
  return failedNonce === null
    ? null
    : (failedTransactions.find((transaction) => transaction.nonce === failedNonce) ?? null);
}

export async function rerunQueueFromFailedNonce(input: QueueRecoveryInput): Promise<RunQueueJobResult> {
  const failedTransactions = input.historyTransactions.filter(
    (transaction) => transaction.status === "failed" && transaction.nonce !== null,
  );
  const firstFailed = selectRerunFailedTransaction(input, failedTransactions);
  if (!firstFailed || firstFailed.nonce === null) return runRecoveryQueue(input, []);

  const accountId = firstFailed.accountId;
  const failedNonce = firstFailed.nonce;
  const accountRecords = input.historyTransactions
    .filter(
      (transaction) =>
        transaction.accountId === accountId &&
        transaction.nonce !== null &&
        transaction.nonce >= failedNonce &&
        ["failed", "queued", "stopped"].includes(transaction.status),
    )
    .sort((left, right) => (left.nonce ?? 0) - (right.nonce ?? 0));
  const drafts = requireSessionDrafts(accountRecords, input.sessionDraftsByTransactionId).map((draft, index) =>
    retryDraft(draft, accountRecords[index].id),
  );
  const result = await runRecoveryQueue(input, drafts);
  const successIds = successfulRetryIds(result);

  return {
    ...result,
    historyUpdates: accountRecords.filter((record) => successIds.has(record.id)).map(markNonceConsumed),
  };
}
