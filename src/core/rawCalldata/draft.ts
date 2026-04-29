import { id as ethersId, keccak256 } from "ethers";

export const RAW_CALLDATA_MAX_BYTES = 128 * 1024;
export const RAW_CALLDATA_HASH_VERSION = "keccak256-v1";
export const RAW_CALLDATA_PREVIEW_PREFIX_BYTES = 32;
export const RAW_CALLDATA_PREVIEW_SUFFIX_BYTES = 32;
export const RAW_CALLDATA_HUMAN_PREVIEW_MAX_ROWS = 12;
export const RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS = 160;

export type RawCalldataNormalizeErrorCode =
  | "missing0xPrefix"
  | "oddLength"
  | "nonHex"
  | "calldataTooLarge";

export type RawCalldataSelectorStatus = "none" | "short" | "present";

export type RawCalldataInferenceStatus =
  | "unknown"
  | "matched"
  | "conflict"
  | "stale"
  | "unavailable";

export type RawCalldataWarningCode =
  | "emptyCalldata"
  | "unknownSelector"
  | "selectorConflict"
  | "staleInference"
  | "inferenceUnavailable"
  | "nonzeroValue"
  | "manualGas"
  | "highFee"
  | "largeCalldata";

export interface RawCalldataStatus {
  level: "warning" | "blocking";
  code: RawCalldataWarningCode | RawCalldataNormalizeErrorCode | string;
  message: string;
  source: "calldata" | "selector" | "value" | "fee" | "nonce" | "account" | "rpc" | "contract";
  requiresAcknowledgement?: boolean;
  acknowledged?: boolean;
}

export interface RawCalldataNormalizeSuccess {
  ok: true;
  canonical: string;
  byteLength: number;
}

export interface RawCalldataNormalizeFailure {
  ok: false;
  error: RawCalldataStatus & { code: RawCalldataNormalizeErrorCode };
}

export type RawCalldataNormalizeResult =
  | RawCalldataNormalizeSuccess
  | RawCalldataNormalizeFailure;

export interface RawCalldataHumanPreviewRowInput {
  label: string;
  value: string;
}

export interface RawCalldataHumanPreviewRow {
  label: string;
  value: string;
  displayText: string;
  truncated: boolean;
  originalCharLength: number;
}

export interface RawCalldataHumanPreview {
  rows: RawCalldataHumanPreviewRow[];
  truncatedRows: boolean;
  omittedRows: number;
}

export interface RawCalldataPreview {
  canonical: string;
  selector: string | null;
  selectorStatus: RawCalldataSelectorStatus;
  byteLength: number;
  hashVersion: typeof RAW_CALLDATA_HASH_VERSION;
  hash: string;
  display: string;
  prefix: string;
  suffix: string;
  truncated: boolean;
  omittedBytes: number;
  human: RawCalldataHumanPreview;
}

export interface RawCalldataInferenceMatchedSource {
  identity: string;
  version?: string | null;
  fingerprint?: string | null;
  abiHash?: string | null;
  functionSignature?: string | null;
}

export interface RawCalldataInferenceInput {
  status: RawCalldataInferenceStatus;
  matchedSource?: RawCalldataInferenceMatchedSource | null;
  selectorMatchCount?: number | null;
  conflictSummary?: string | null;
  staleSummary?: string | null;
  sourceStatus?: string | null;
}

export interface RawCalldataRpcIdentity {
  chainId: number | null;
  providerConfigId?: string | null;
  endpointId?: string | null;
  endpointName?: string | null;
  endpointSummary?: string | null;
  endpointFingerprint?: string | null;
}

export interface RawCalldataRpcIdentityInput {
  chainId?: bigint | number | null;
  providerConfigId?: string | null;
  endpointId?: string | null;
  endpointName?: string | null;
  endpointSummary?: string | null;
  endpointFingerprint?: string | null;
}

export interface RawCalldataFeeInput {
  gasLimit: bigint;
  estimatedGasLimit?: bigint | null;
  manualGas?: boolean;
  latestBaseFeePerGas?: bigint | null;
  baseFeePerGas: bigint;
  baseFeeMultiplier?: string;
  maxFeePerGas: bigint;
  maxFeeOverridePerGas?: bigint | null;
  maxPriorityFeePerGas: bigint;
  liveMaxFeePerGas?: bigint | null;
  liveMaxPriorityFeePerGas?: bigint | null;
}

export interface BuildRawCalldataDraftInput {
  chainId: bigint | number;
  selectedRpc: RawCalldataRpcIdentityInput | null;
  from: string | null;
  fromAccountIndex?: number | null;
  to: string | null;
  valueWei: bigint;
  calldata: string;
  nonce: number | null;
  fee: RawCalldataFeeInput;
  inference?: RawCalldataInferenceInput | null;
  warningAcknowledgements?: Partial<Record<RawCalldataWarningCode, boolean>>;
  humanPreviewRows?: RawCalldataHumanPreviewRowInput[];
  createdAt?: string;
}

export interface RawCalldataSubmission {
  transactionType: "rawCalldata";
  chainId: number;
  selectedRpc: RawCalldataRpcIdentity | null;
  from: string;
  fromAccountIndex: number | null;
  to: string;
  valueWei: string;
  calldata: string;
  calldataHashVersion: typeof RAW_CALLDATA_HASH_VERSION;
  calldataHash: string;
  calldataByteLength: number;
  selector: string | null;
  selectorStatus: RawCalldataSelectorStatus;
  nonce: number;
  gasLimit: string;
  estimatedGasLimit: string | null;
  latestBaseFeePerGas: string | null;
  baseFeePerGas: string;
  baseFeeMultiplier: string | null;
  maxFeePerGas: string;
  maxFeeOverridePerGas: string | null;
  maxPriorityFeePerGas: string;
}

export interface RawCalldataDraft {
  draftId: string;
  frozenKey: string;
  createdAt: string | null;
  preview: RawCalldataPreview;
  inference: RawCalldataInferenceInput;
  warnings: RawCalldataStatus[];
  blockingStatuses: RawCalldataStatus[];
  canSubmit: boolean;
  submission: RawCalldataSubmission | null;
}

const hexPattern = /^[0-9a-f]*$/;

export function normalizeRawCalldata(input: string): RawCalldataNormalizeResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith("0x")) {
    return normalizeFailure("missing0xPrefix", "Raw calldata must start with 0x.");
  }
  const hex = trimmed.slice(2);
  if (hex.length % 2 !== 0) {
    return normalizeFailure("oddLength", "Raw calldata hex must contain complete bytes.");
  }
  const lowercaseHex = hex.toLowerCase();
  if (!hexPattern.test(lowercaseHex)) {
    return normalizeFailure("nonHex", "Raw calldata can only contain hexadecimal characters.");
  }
  const byteLength = lowercaseHex.length / 2;
  if (byteLength > RAW_CALLDATA_MAX_BYTES) {
    return normalizeFailure(
      "calldataTooLarge",
      `Raw calldata exceeds the ${RAW_CALLDATA_MAX_BYTES} byte limit.`,
    );
  }
  return {
    ok: true,
    canonical: `0x${lowercaseHex}`,
    byteLength,
  };
}

export function buildRawCalldataPreview(
  normalized: RawCalldataNormalizeSuccess | string,
  rows: RawCalldataHumanPreviewRowInput[] = [],
): RawCalldataPreview {
  const normalizedCalldata =
    typeof normalized === "string" ? requireNormalized(normalized) : normalized;
  const hex = normalizedCalldata.canonical.slice(2);
  const selector = normalizedCalldata.byteLength >= 4 ? `0x${hex.slice(0, 8)}` : null;
  const prefixHex = hex.slice(0, RAW_CALLDATA_PREVIEW_PREFIX_BYTES * 2);
  const suffixHex =
    normalizedCalldata.byteLength > RAW_CALLDATA_PREVIEW_PREFIX_BYTES + RAW_CALLDATA_PREVIEW_SUFFIX_BYTES
      ? hex.slice(-RAW_CALLDATA_PREVIEW_SUFFIX_BYTES * 2)
      : "";
  const truncated =
    normalizedCalldata.byteLength > RAW_CALLDATA_PREVIEW_PREFIX_BYTES + RAW_CALLDATA_PREVIEW_SUFFIX_BYTES;
  const omittedBytes = truncated
    ? normalizedCalldata.byteLength -
      RAW_CALLDATA_PREVIEW_PREFIX_BYTES -
      RAW_CALLDATA_PREVIEW_SUFFIX_BYTES
    : 0;

  return {
    canonical: normalizedCalldata.canonical,
    selector,
    selectorStatus:
      normalizedCalldata.byteLength === 0
        ? "none"
        : normalizedCalldata.byteLength < 4
          ? "short"
          : "present",
    byteLength: normalizedCalldata.byteLength,
    hashVersion: RAW_CALLDATA_HASH_VERSION,
    hash: keccak256(normalizedCalldata.canonical),
    display: truncated
      ? `0x${prefixHex}...${suffixHex}`
      : normalizedCalldata.canonical,
    prefix: `0x${prefixHex}`,
    suffix: truncated ? `0x${suffixHex}` : "",
    truncated,
    omittedBytes,
    human: boundHumanPreviewRows(rows),
  };
}

export function buildRawCalldataDraft(input: BuildRawCalldataDraftInput): RawCalldataDraft {
  const blockingStatuses: RawCalldataStatus[] = [];
  const normalizeResult = normalizeRawCalldata(input.calldata);
  if (!normalizeResult.ok) {
    blockingStatuses.push(normalizeResult.error);
  }
  if (!input.selectedRpc) {
    blockingStatuses.push(blocking("missingRpc", "Select and validate an RPC before drafting.", "rpc"));
  } else if (input.selectedRpc.chainId === null || input.selectedRpc.chainId === undefined) {
    blockingStatuses.push(
      blocking("unvalidatedRpcChain", "Validate the selected RPC chain identity before drafting.", "rpc"),
    );
  } else if (
    numericChainId(input.selectedRpc.chainId) !== numericChainId(input.chainId)
  ) {
    blockingStatuses.push(
      blocking(
        "chainMismatch",
        `RPC returned chainId ${numericChainId(input.selectedRpc.chainId)}; expected ${numericChainId(input.chainId)}.`,
        "rpc",
      ),
    );
  }
  if (!input.from) {
    blockingStatuses.push(blocking("missingFrom", "Select a sender account.", "account"));
  }
  if (!input.to) {
    blockingStatuses.push(blocking("missingTo", "Enter a target contract address.", "contract"));
  }
  if (input.nonce === null || !Number.isSafeInteger(input.nonce) || input.nonce < 0) {
    blockingStatuses.push(blocking("nonce", "Nonce must be a non-negative safe integer.", "nonce"));
  }
  if (input.fee.gasLimit <= 0n) {
    blockingStatuses.push(blocking("gasLimit", "Gas limit must be greater than zero.", "fee"));
  }
  if (input.fee.maxFeePerGas < input.fee.maxPriorityFeePerGas) {
    blockingStatuses.push(
      blocking("maxFeeBelowPriorityFee", "Max fee must be greater than or equal to priority fee.", "fee"),
    );
  }

  const inputInference = sanitizeInference(input.inference);
  const preview = normalizeResult.ok
    ? buildRawCalldataPreview(normalizeResult, input.humanPreviewRows)
    : null;
  const inference = preview ? effectiveInference(inputInference, preview) : inputInference;
  const warnings = preview
    ? warningStatuses(preview, input.valueWei, input.fee, inference, input.warningAcknowledgements ?? {})
    : [];
  const uniqueBlocking = uniqueStatuses(blockingStatuses);
  const uniqueWarnings = uniqueStatuses(warnings);
  const canSubmit =
    uniqueBlocking.length === 0 &&
    uniqueWarnings.every((warning) => !warning.requiresAcknowledgement || warning.acknowledged);

  const createdAt = input.createdAt ?? null;
  if (
    !preview ||
    uniqueBlocking.length > 0 ||
    !input.selectedRpc ||
    !input.from ||
    !input.to ||
    input.nonce === null
  ) {
    return {
      draftId: compactHashKey({ kind: "rawCalldataDraftBlocked", createdAt, blockingStatuses: uniqueBlocking }),
      frozenKey: compactHashKey(frozenPayload(input, preview, inference, uniqueWarnings)),
      createdAt,
      preview: preview ?? emptyBlockedPreview(),
      inference,
      warnings: uniqueWarnings,
      blockingStatuses: uniqueBlocking,
      canSubmit: false,
      submission: null,
    };
  }

  const submission: RawCalldataSubmission = {
    transactionType: "rawCalldata",
    chainId: numericChainId(input.chainId),
    selectedRpc: sanitizeRpcIdentity(input.selectedRpc),
    from: input.from,
    fromAccountIndex: input.fromAccountIndex ?? null,
    to: input.to,
    valueWei: input.valueWei.toString(),
    calldata: preview.canonical,
    calldataHashVersion: preview.hashVersion,
    calldataHash: preview.hash,
    calldataByteLength: preview.byteLength,
    selector: preview.selector,
    selectorStatus: preview.selectorStatus,
    nonce: input.nonce,
    gasLimit: input.fee.gasLimit.toString(),
    estimatedGasLimit: input.fee.estimatedGasLimit?.toString() ?? null,
    latestBaseFeePerGas: input.fee.latestBaseFeePerGas?.toString() ?? null,
    baseFeePerGas: input.fee.baseFeePerGas.toString(),
    baseFeeMultiplier: input.fee.baseFeeMultiplier ?? null,
    maxFeePerGas: input.fee.maxFeePerGas.toString(),
    maxFeeOverridePerGas: input.fee.maxFeeOverridePerGas?.toString() ?? null,
    maxPriorityFeePerGas: input.fee.maxPriorityFeePerGas.toString(),
  };
  const frozen = frozenPayload(input, preview, inference, uniqueWarnings);

  return {
    draftId: compactHashKey({ ...frozen, createdAt }),
    frozenKey: compactHashKey(frozen),
    createdAt,
    preview,
    inference,
    warnings: uniqueWarnings,
    blockingStatuses: [],
    canSubmit,
    submission,
  };
}

function requireNormalized(value: string): RawCalldataNormalizeSuccess {
  const normalized = normalizeRawCalldata(value);
  if (!normalized.ok) {
    throw new Error(normalized.error.message);
  }
  return normalized;
}

function normalizeFailure(
  code: RawCalldataNormalizeErrorCode,
  message: string,
): RawCalldataNormalizeFailure {
  return { ok: false, error: blocking(code, message, "calldata") as RawCalldataNormalizeFailure["error"] };
}

function warningStatuses(
  preview: RawCalldataPreview,
  valueWei: bigint,
  fee: RawCalldataFeeInput,
  inference: RawCalldataInferenceInput,
  acknowledgements: Partial<Record<RawCalldataWarningCode, boolean>>,
) {
  const warnings: RawCalldataStatus[] = [];
  const pushAck = (code: RawCalldataWarningCode, message: string, source: RawCalldataStatus["source"]) => {
    warnings.push({
      level: "warning",
      code,
      message,
      source,
      requiresAcknowledgement: true,
      acknowledged: acknowledgements[code] === true,
    });
  };

  if (preview.byteLength === 0) {
    pushAck("emptyCalldata", "Raw calldata is empty.", "calldata");
  }
  if (preview.byteLength > RAW_CALLDATA_MAX_BYTES / 2) {
    pushAck("largeCalldata", "Raw calldata is large; review the bounded preview carefully.", "calldata");
  }
  if (valueWei > 0n) {
    pushAck("nonzeroValue", "This raw call sends native value.", "value");
  }
  if (fee.manualGas || (fee.estimatedGasLimit !== null && fee.estimatedGasLimit !== undefined && fee.gasLimit !== fee.estimatedGasLimit)) {
    pushAck("manualGas", "Manual gas limit is set.", "fee");
  }
  if (isHighFee(fee)) {
    pushAck("highFee", "Fee settings are high relative to live fee references.", "fee");
  }
  if (inference.status === "unknown") {
    pushAck("unknownSelector", "No ABI selector match is selected for this calldata.", "selector");
  }
  if (inference.status === "conflict") {
    pushAck("selectorConflict", "ABI selector inference has conflicts.", "selector");
  }
  if (inference.status === "stale") {
    pushAck("staleInference", "ABI selector inference is stale.", "selector");
  }
  if (inference.status === "unavailable") {
    pushAck("inferenceUnavailable", "ABI selector inference is unavailable.", "selector");
  }
  return warnings;
}

function isHighFee(fee: RawCalldataFeeInput) {
  const highFee =
    fee.liveMaxFeePerGas !== null &&
    fee.liveMaxFeePerGas !== undefined &&
    fee.liveMaxFeePerGas > 0n &&
    fee.maxFeePerGas > fee.liveMaxFeePerGas * 3n;
  const highBaseFee =
    fee.latestBaseFeePerGas !== null &&
    fee.latestBaseFeePerGas !== undefined &&
    fee.latestBaseFeePerGas > 0n &&
    fee.baseFeePerGas > fee.latestBaseFeePerGas * 3n;
  const highTip =
    fee.liveMaxPriorityFeePerGas !== null &&
    fee.liveMaxPriorityFeePerGas !== undefined &&
    fee.liveMaxPriorityFeePerGas > 0n &&
    fee.maxPriorityFeePerGas > fee.liveMaxPriorityFeePerGas * 3n;
  const highGasLimit =
    fee.estimatedGasLimit !== null &&
    fee.estimatedGasLimit !== undefined &&
    fee.gasLimit > fee.estimatedGasLimit * 2n;
  return highFee || highBaseFee || highTip || highGasLimit;
}

function boundHumanPreviewRows(rows: RawCalldataHumanPreviewRowInput[]): RawCalldataHumanPreview {
  const boundedRows = rows.slice(0, RAW_CALLDATA_HUMAN_PREVIEW_MAX_ROWS).map((row) => {
    const label = compactText(row.label);
    const value = compactText(row.value);
    const displayText = boundText(formatHumanPreviewDisplayText(label, value), RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS);
    const labelText = boundText(label, RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS);
    const valueText = boundText(value, RAW_CALLDATA_HUMAN_PREVIEW_MAX_CHARS);
    return {
      label: labelText.text,
      value: valueText.text,
      displayText: displayText.text,
      truncated: displayText.truncated || labelText.truncated || valueText.truncated,
      originalCharLength: row.label.length + row.value.length,
    };
  });
  return {
    rows: boundedRows,
    truncatedRows: rows.length > RAW_CALLDATA_HUMAN_PREVIEW_MAX_ROWS,
    omittedRows: Math.max(0, rows.length - RAW_CALLDATA_HUMAN_PREVIEW_MAX_ROWS),
  };
}

function formatHumanPreviewDisplayText(label: string, value: string) {
  if (!label) return value;
  if (!value) return label;
  return `${label}: ${value}`;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function boundText(value: string, maxLength: number) {
  const compact = compactText(value);
  if (compact.length <= maxLength) {
    return { text: compact, truncated: false };
  }
  return { text: compact.slice(0, maxLength), truncated: true };
}

function frozenPayload(
  input: BuildRawCalldataDraftInput,
  preview: RawCalldataPreview | null,
  inference: RawCalldataInferenceInput,
  warnings: RawCalldataStatus[],
) {
  return {
    kind: "rawCalldataDraft",
    version: 1,
    chainId: numericChainId(input.chainId),
    rpc: sanitizeRpcIdentity(input.selectedRpc),
    fromAccountIndex: input.fromAccountIndex ?? null,
    from: input.from ?? null,
    to: input.to ?? null,
    valueWei: input.valueWei.toString(),
    calldata:
      preview === null
        ? null
        : {
            hashVersion: preview.hashVersion,
            hash: preview.hash,
            byteLength: preview.byteLength,
            selector: preview.selector,
            selectorStatus: preview.selectorStatus,
            display: preview.display,
            prefix: preview.prefix,
            suffix: preview.suffix,
            truncated: preview.truncated,
            omittedBytes: preview.omittedBytes,
            human: preview.human,
          },
    gas: {
      gasLimit: input.fee.gasLimit.toString(),
      estimatedGasLimit: input.fee.estimatedGasLimit?.toString() ?? null,
      manualGas: input.fee.manualGas === true,
      latestBaseFeePerGas: input.fee.latestBaseFeePerGas?.toString() ?? null,
      baseFeePerGas: input.fee.baseFeePerGas.toString(),
      baseFeeMultiplier: input.fee.baseFeeMultiplier ?? null,
      maxFeePerGas: input.fee.maxFeePerGas.toString(),
      maxFeeOverridePerGas: input.fee.maxFeeOverridePerGas?.toString() ?? null,
      maxPriorityFeePerGas: input.fee.maxPriorityFeePerGas.toString(),
      liveMaxFeePerGas: input.fee.liveMaxFeePerGas?.toString() ?? null,
      liveMaxPriorityFeePerGas: input.fee.liveMaxPriorityFeePerGas?.toString() ?? null,
    },
    nonce: input.nonce,
    warningAcknowledgements: warnings
      .filter((warning) => warning.requiresAcknowledgement)
      .map((warning) => ({ code: warning.code, acknowledged: warning.acknowledged === true })),
    inference,
  };
}

function sanitizeInference(input: RawCalldataInferenceInput | null | undefined): RawCalldataInferenceInput {
  const status = input?.status ?? "unknown";
  return {
    status,
    matchedSource: input?.matchedSource
      ? {
          identity: input.matchedSource.identity,
          version: input.matchedSource.version ?? null,
          fingerprint: input.matchedSource.fingerprint ?? null,
          abiHash: input.matchedSource.abiHash ?? null,
          functionSignature: input.matchedSource.functionSignature ?? null,
        }
      : null,
    selectorMatchCount: input?.selectorMatchCount ?? null,
    conflictSummary: input?.conflictSummary ?? null,
    staleSummary: input?.staleSummary ?? null,
    sourceStatus: input?.sourceStatus ?? null,
  };
}

function effectiveInference(
  inference: RawCalldataInferenceInput,
  preview: RawCalldataPreview,
): RawCalldataInferenceInput {
  if (preview.selectorStatus === "present") {
    return inference;
  }
  return {
    status: "unknown",
    matchedSource: null,
    selectorMatchCount: 0,
    conflictSummary: null,
    staleSummary: null,
    sourceStatus: preview.selectorStatus === "none" ? "selectorMissing" : "selectorTooShort",
  };
}

function sanitizeRpcIdentity(input: RawCalldataRpcIdentityInput | null): RawCalldataRpcIdentity | null {
  if (!input) return null;
  return {
    chainId:
      input.chainId === null || input.chainId === undefined ? null : numericChainId(input.chainId),
    providerConfigId: input.providerConfigId ?? null,
    endpointId: input.endpointId ?? null,
    endpointName: input.endpointName ?? null,
    endpointSummary: input.endpointSummary ?? null,
    endpointFingerprint: input.endpointFingerprint ?? null,
  };
}

function emptyBlockedPreview(): RawCalldataPreview {
  return {
    canonical: "0x",
    selector: null,
    selectorStatus: "none",
    byteLength: 0,
    hashVersion: RAW_CALLDATA_HASH_VERSION,
    hash: keccak256("0x"),
    display: "0x",
    prefix: "0x",
    suffix: "",
    truncated: false,
    omittedBytes: 0,
    human: { rows: [], truncatedRows: false, omittedRows: 0 },
  };
}

function blocking(
  code: RawCalldataStatus["code"],
  message: string,
  source: RawCalldataStatus["source"],
): RawCalldataStatus {
  return { level: "blocking", code, message, source };
}

function uniqueStatuses(statuses: RawCalldataStatus[]) {
  const seen = new Set<string>();
  return statuses.filter((status) => {
    const key = `${status.level}:${status.code}:${status.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function numericChainId(chainId: bigint | number) {
  return typeof chainId === "bigint" ? Number(chainId) : chainId;
}

function stableStringify(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compactHashKey(value: unknown) {
  return `raw-calldata-${ethersId(stableStringify(value)).slice(2, 18)}`;
}
