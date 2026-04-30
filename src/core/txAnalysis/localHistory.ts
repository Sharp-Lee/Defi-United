import type { HistoryRecord, TransactionType } from "../history/schema";

export type TxAnalysisLocalHistoryStatus =
  | "noMatch"
  | "matched"
  | "duplicateTxHash"
  | "chainConflict"
  | "fromMismatch"
  | "nonceMismatch"
  | "toMismatch"
  | "valueMismatch"
  | "localOnlyConflict";

export interface TxAnalysisLocalHistoryInput {
  txHash: string;
  chainId: number;
  from?: string | null;
  nonce?: string | number | null;
  to?: string | null;
  valueWei?: string | null;
  history: HistoryRecord[];
}

export interface TxAnalysisLocalHistoryRow {
  label: string;
  value: string;
}

export interface TxAnalysisLocalHistoryRecordSummary {
  status: Exclude<TxAnalysisLocalHistoryStatus, "noMatch">;
  txHash: string;
  localChainId: number | null;
  from: string | null;
  nonce: number | null;
  to: string | null;
  valueWei: string | null;
  outcome: string;
  transactionType: TransactionType;
  submissionKind: string;
  conflicts: Array<Exclude<TxAnalysisLocalHistoryStatus, "noMatch" | "matched" | "duplicateTxHash">>;
  typedRows: TxAnalysisLocalHistoryRow[];
}

export interface TxAnalysisLocalHistoryModel {
  status: TxAnalysisLocalHistoryStatus;
  disclaimer: string;
  records: TxAnalysisLocalHistoryRecordSummary[];
}

const DISCLAIMER = "Local history is shown beside RPC facts and does not override RPC facts.";
const SAFE_TEXT_MAX = 96;
const LONG_HEX_PAYLOAD_RE = /^0x[a-fA-F0-9]{72,}$/;
const CREDENTIAL_URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/i;
const AUTH_SCHEME_RE = /(?:^|\s)(?:bearer|basic)\s+\S+/i;
const SENSITIVE_QUERY_RE =
  /\b[a-z][a-z0-9+.-]*:\/\/\S*[?&](?:api_?key|access_?token|query_?token|token|auth|authorization|key|secret|password|passphrase|signature)=/i;
const SENSITIVE_KEY_VALUE_RE =
  /\b(?:api_?key|access_?token|query_?token|token|auth|authorization|key|secret|password|passphrase|signature|private_?key|mnemonic|seed|raw_?tx|raw_?transaction|signed_?tx|signed_?transaction|raw_?abi|raw_?calldata|full_?calldata|canonical_?calldata|canonical_?params|payload)\b\s*[:=]/i;

export function buildTxAnalysisLocalHistoryModel(
  input: TxAnalysisLocalHistoryInput,
): TxAnalysisLocalHistoryModel {
  const txHash = input.txHash.trim().toLowerCase();
  const matches = input.history.filter(
    (record) => record.submission?.tx_hash?.toLowerCase() === txHash,
  );

  if (matches.length === 0) {
    return { status: "noMatch", disclaimer: DISCLAIMER, records: [] };
  }

  const records = matches.map((record) => summarizeRecord(record, input));
  return {
    status: matches.length > 1 ? "duplicateTxHash" : records[0]?.status ?? "matched",
    disclaimer: DISCLAIMER,
    records,
  };
}

function summarizeRecord(
  record: HistoryRecord,
  input: TxAnalysisLocalHistoryInput,
): TxAnalysisLocalHistoryRecordSummary {
  const conflicts = recordConflicts(record, input);
  return {
    status: conflicts[0] ?? "matched",
    txHash: record.submission.tx_hash,
    localChainId: record.submission.chain_id,
    from: record.submission.from,
    nonce: record.submission.nonce,
    to: record.submission.to,
    valueWei: record.submission.value_wei,
    outcome: record.outcome?.state ?? "Unknown",
    transactionType: record.submission.transaction_type,
    submissionKind: record.submission.kind,
    conflicts,
    typedRows: typedRows(record),
  };
}

function recordConflicts(
  record: HistoryRecord,
  input: TxAnalysisLocalHistoryInput,
): TxAnalysisLocalHistoryRecordSummary["conflicts"] {
  const conflicts: TxAnalysisLocalHistoryRecordSummary["conflicts"] = [];
  if (record.submission.chain_id !== null && record.submission.chain_id !== input.chainId) {
    conflicts.push("chainConflict");
  }
  if (
    input.from &&
    record.submission.from &&
    record.submission.from.toLowerCase() !== input.from.toLowerCase()
  ) {
    conflicts.push("fromMismatch");
  }
  const rpcNonce = numberFrom(input.nonce);
  if (rpcNonce !== null && record.submission.nonce !== null && record.submission.nonce !== rpcNonce) {
    conflicts.push("nonceMismatch");
  }
  if (
    input.to &&
    record.submission.to &&
    record.submission.to.toLowerCase() !== input.to.toLowerCase()
  ) {
    conflicts.push("toMismatch");
  }
  if (
    input.valueWei &&
    record.submission.value_wei &&
    record.submission.value_wei !== input.valueWei
  ) {
    conflicts.push("valueMismatch");
  }
  return conflicts;
}

function numberFrom(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function typedRows(record: HistoryRecord): TxAnalysisLocalHistoryRow[] {
  const rows: TxAnalysisLocalHistoryRow[] = [
    row("Type", displayTransactionType(record.submission.transaction_type)),
    row("Submission kind", record.submission.kind),
  ];

  appendCommonRows(rows, record);
  appendBatchRows(rows, record);

  switch (record.submission.transaction_type) {
    case "nativeTransfer":
    case "legacy":
      appendRows(rows, [
        ["To", record.submission.to],
        ["Value", wei(record.submission.value_wei)],
        ["Native value", wei(record.submission.native_value_wei ?? record.submission.value_wei)],
      ]);
      break;
    case "erc20Transfer":
      appendRows(rows, [
        ["Token contract", record.submission.token_contract ?? record.submission.to],
        ["Recipient", record.submission.recipient],
        ["Amount raw", record.submission.amount_raw],
        ["Decimals", record.submission.decimals],
        ["Token symbol", record.submission.token_symbol],
        ["Token name", record.submission.token_name],
        ["Metadata source", record.submission.token_metadata_source],
        ["Selector", record.submission.selector],
        ["Method", record.submission.method_name],
        ["Native value", wei(record.submission.native_value_wei)],
      ]);
      break;
    case "contractCall":
      appendRows(rows, [
        ["Contract", record.submission.to],
        ["Selector", record.submission.selector],
        ["Method", record.submission.method_name],
        ["Native value", wei(record.submission.native_value_wei ?? record.submission.value_wei)],
      ]);
      appendAbiRows(rows, record);
      break;
    case "rawCalldata":
      appendRows(rows, [
        ["To", record.submission.to],
        ["Selector", record.raw_calldata_metadata?.selector ?? record.submission.selector],
        ["Selector status", record.raw_calldata_metadata?.selector_status],
        ["Calldata hash", record.raw_calldata_metadata?.calldata_hash],
        ["Calldata bytes", record.raw_calldata_metadata?.calldata_byte_length],
        ["Calldata hash version", record.raw_calldata_metadata?.calldata_hash_version],
        ["Inference", record.raw_calldata_metadata?.inference?.inference_status],
        ["Inference source", record.raw_calldata_metadata?.inference?.source_status],
        ["Matched source", record.raw_calldata_metadata?.inference?.matched_source_kind],
        ["Selector matches", record.raw_calldata_metadata?.inference?.selector_match_count],
        ["Native value", wei(record.submission.native_value_wei ?? record.submission.value_wei)],
      ]);
      break;
    case "assetApprovalRevoke":
      appendRows(rows, [
        [
          "Token approval contract",
          record.asset_approval_revoke_metadata?.token_approval_contract ??
            record.submission.token_contract,
        ],
        ["Approval kind", record.asset_approval_revoke_metadata?.approval_kind],
        ["Spender", record.asset_approval_revoke_metadata?.spender],
        ["Operator", record.asset_approval_revoke_metadata?.operator],
        ["Token ID", record.asset_approval_revoke_metadata?.token_id],
        ["Method", record.asset_approval_revoke_metadata?.method ?? record.submission.method_name],
        ["Selector", record.asset_approval_revoke_metadata?.selector ?? record.submission.selector],
        ["Calldata hash", record.asset_approval_revoke_metadata?.calldata_hash],
        ["Calldata bytes", record.asset_approval_revoke_metadata?.calldata_byte_length],
      ]);
      break;
    case "unknown":
      appendRows(rows, [["Typed display", "Unsupported/unknown transaction type"]]);
      break;
  }

  return rows.filter((entry) => entry.value !== "");
}

function appendCommonRows(rows: TxAnalysisLocalHistoryRow[], record: HistoryRecord) {
  appendRows(rows, [
    ["Local chainId", record.submission.chain_id],
    ["From", record.submission.from],
    ["Nonce", record.submission.nonce],
    ["Broadcasted at", record.submission.broadcasted_at],
  ]);
}

function appendBatchRows(rows: TxAnalysisLocalHistoryRow[], record: HistoryRecord) {
  const batch = record.batch_metadata;
  if (!batch) return;
  appendRows(rows, [
    ["Batch id", batch.batch_id],
    ["Batch child", batch.child_id],
    ["Batch kind", batch.batch_kind],
    ["Batch asset", batch.asset_kind],
    ["Batch child index", batch.child_index],
    ["Batch child count", batch.child_count],
    ["Batch contract", batch.contract_address],
    ["Batch selector", batch.selector],
    ["Batch method", batch.method_name],
    ["Batch total value", wei(batch.total_value_wei)],
    ["Batch token contract", batch.token_contract],
    ["Batch token symbol", batch.token_symbol],
    ["Batch token name", batch.token_name],
    ["Batch metadata source", batch.token_metadata_source],
    ["Batch total amount raw", batch.total_amount_raw],
  ]);
}

function appendAbiRows(rows: TxAnalysisLocalHistoryRow[], record: HistoryRecord) {
  const metadata = record.abi_call_metadata;
  if (!metadata) return;
  appendRows(rows, [
    ["ABI source", metadata.source_kind],
    ["Function", metadata.function_signature],
    ["Selector", metadata.selector],
    ["ABI hash", metadata.abi_hash],
    ["Source fingerprint", metadata.source_fingerprint],
    ["Argument hash", metadata.argument_hash],
    ["Calldata hash", metadata.calldata?.hash],
    ["Calldata bytes", metadata.calldata?.byte_length],
    ["Native value", wei(metadata.native_value_wei)],
  ]);
}

function appendRows(
  rows: TxAnalysisLocalHistoryRow[],
  entries: Array<[string, string | number | null | undefined]>,
) {
  for (const [label, value] of entries) {
    const entry = row(label, value);
    if (entry.value) rows.push(entry);
  }
}

function row(label: string, value: string | number | null | undefined): TxAnalysisLocalHistoryRow {
  return { label, value: safeDisplay(value) };
}

function wei(value: string | number | null | undefined) {
  const display = safeDisplay(value);
  return display ? `${display} wei` : "";
}

function safeDisplay(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (isUnsafeText(trimmed)) return "[redacted]";
  if (trimmed.length <= SAFE_TEXT_MAX) return trimmed;
  return `${trimmed.slice(0, 48)}...${trimmed.slice(-16)} [truncated]`;
}

function isUnsafeText(value: string) {
  const keyName = normalizeKeyName(value);
  const normalized = value.toLowerCase();
  if (
    CREDENTIAL_URL_RE.test(value) ||
    SENSITIVE_QUERY_RE.test(value) ||
    AUTH_SCHEME_RE.test(value) ||
    SENSITIVE_KEY_VALUE_RE.test(value) ||
    normalized.includes("mnemonic") ||
    normalized.includes("seed phrase") ||
    normalized.includes("recovery phrase") ||
    keyName.includes("privatekey") ||
    keyName.includes("accesstoken") ||
    keyName.includes("querytoken") ||
    keyName.includes("signedtx") ||
    keyName.includes("signedtransaction") ||
    keyName.includes("rawtx") ||
    keyName.includes("rawtransaction")
  ) {
    return true;
  }
  return LONG_HEX_PAYLOAD_RE.test(value);
}

function normalizeKeyName(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function displayTransactionType(type: TransactionType) {
  switch (type) {
    case "nativeTransfer":
      return "Native transfer";
    case "erc20Transfer":
      return "ERC-20 transfer";
    case "contractCall":
      return "Contract call";
    case "rawCalldata":
      return "Raw calldata";
    case "assetApprovalRevoke":
      return "Asset approval revoke";
    case "legacy":
      return "Legacy";
    case "unknown":
      return "Unknown";
  }
}
