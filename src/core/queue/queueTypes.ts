export type QueueJobStatus = "draft" | "queued" | "running" | "stopping" | "stopped" | "completed" | "partial" | "failed";

export type QueueTransactionStatus =
  | "draft"
  | "queued"
  | "nonce-ready"
  | "signing"
  | "broadcasting"
  | "pending"
  | "failed"
  | "skipped"
  | "stopped";

export type QueueSourceModule = "queue" | "distribution" | "inscription" | "contract-call" | "reverse-parse";

export type QueueActionType = "native-transfer" | "erc20-transfer" | "contract-call" | "raw-calldata" | "approval" | "unknown";

export type QueueErrorCategory =
  | "chain-mismatch"
  | "no-rpc"
  | "vault-locked"
  | "account-not-found"
  | "nonce-load-failed"
  | "session-drafts-unavailable"
  | "signing-failed"
  | "broadcast-failed"
  | "rpc-rate-limited"
  | "user-stopped"
  | "nonce-consumed"
  | "unknown";

export interface QueueExecutionPolicy {
  concurrency: number;
  walletIntervalMs: number;
  rpcRequestsPerSecond: number;
  continueOnFailure: boolean;
  rerunFromFailedNonce: boolean;
}

export interface QueueJobSummary {
  total: number;
  pending: number;
  failed: number;
  stopped: number;
  completed: number;
}

export interface QueueJobRecord {
  id: string;
  chainId: number;
  title: string;
  sourceModule: QueueSourceModule;
  status: QueueJobStatus;
  createdAt: string;
  updatedAt: string;
  executionPolicy: QueueExecutionPolicy;
  transactionIds: string[];
  summary: QueueJobSummary;
}

export interface RedactedCalldataSummary {
  selector: string | null;
  byteLength: number;
  summary: string;
}

export type QueueFeeSummary =
  | {
      mode: "eip1559";
      gasLimit: string;
      maxFeePerGasGwei: string;
      maxPriorityFeePerGasGwei: string;
    }
  | {
      mode: "legacy";
      gasLimit: string;
      gasPriceGwei: string;
    };

export interface QueueExecutionError {
  category: QueueErrorCategory;
  message: string;
  retryable: boolean;
}

export interface QueueTransactionRecord {
  id: string;
  jobId: string;
  chainId: number;
  accountId: string;
  accountAddress: string;
  nonce: number | null;
  status: QueueTransactionStatus;
  actionType: QueueActionType;
  target: string | null;
  valueWei: string;
  calldataSummary: RedactedCalldataSummary;
  feeSummary: QueueFeeSummary;
  txHash: string | null;
  error: QueueExecutionError | null;
  retryOfTransactionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueHistoryState {
  schemaVersion: 1;
  updatedAt: string;
  jobs: QueueJobRecord[];
  transactions: QueueTransactionRecord[];
}

export interface QueueFeeDraft {
  mode: "eip1559" | "legacy";
  gasLimit: string;
  gasPriceGwei?: string;
  maxFeePerGasGwei?: string;
  maxPriorityFeePerGasGwei?: string;
}

export interface QueueTransactionPreview {
  title: string;
  description: string;
  calldata: RedactedCalldataSummary;
}

export interface PreparedQueueTransactionDraft {
  id: string;
  chainId: number;
  accountId: string;
  accountAddress: string;
  to: string | null;
  valueWei: string;
  data: string;
  gasLimit: string;
  fee: QueueFeeDraft;
  actionType: QueueActionType;
  preview: QueueTransactionPreview;
  retryOfTransactionId?: string | null;
}
