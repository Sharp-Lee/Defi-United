import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, isAddress, JsonRpcProvider, parseUnits } from "ethers";
import {
  buildRawCalldataDraft,
  normalizeRawCalldata,
  type RawCalldataDraft,
  type RawCalldataInferenceInput,
  type RawCalldataRpcIdentityInput,
  type RawCalldataStatus,
  type RawCalldataWarningCode,
} from "../../core/rawCalldata/draft";
import { getRawHistoryErrorDisplay } from "../../core/history/errors";
import { nextNonceWithLocalPending } from "../../core/history/reconciler";
import { HistoryErrorCard } from "../history/HistoryErrorCard";
import {
  submitRawCalldata,
  type AbiFunctionCatalogResult,
  type AbiFunctionSchema,
  type AbiManagedEntryInput,
  type AbiRegistryState,
  type AbiCacheEntryRecord,
  type AccountRecord,
  type HistoryRecord,
  type RawCalldataSubmitInput,
} from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";

export interface RawCalldataViewProps {
  accounts: Array<AccountRecord & AccountChainState>;
  chainId: bigint;
  chainName: string;
  rpcUrl: string;
  history?: HistoryRecord[];
  historyStorageIssue?: string | null;
  abiRegistryState?: AbiRegistryState | null;
  onSubmitFailed?: (error: unknown) => Promise<void> | void;
  onListAbiFunctions?: (input: AbiManagedEntryInput) => Promise<AbiFunctionCatalogResult>;
  onSubmitRawCalldata?: (input: RawCalldataSubmitInput) => Promise<HistoryRecord>;
}

interface RawCalldataFeeReference {
  selectedRpc: RawCalldataRpcIdentityInput;
  estimatedGasLimit: bigint | null;
  manualGas: boolean;
  latestBaseFeePerGas: bigint | null;
  liveMaxFeePerGas: bigint | null;
  liveMaxPriorityFeePerGas: bigint | null;
  estimateFailure: string | null;
  inference: RawCalldataInferenceInput;
}

interface RawCalldataBuildSnapshot {
  account: AccountRecord & AccountChainState;
  chainId: bigint;
  rpcUrl: string;
  to: string;
  valueWei: string;
  calldata: string;
  nonce: string;
  gasLimit: string;
  autoGasLimit: string | null;
  baseFeeGwei: string;
  baseFeeMultiplier: string;
  priorityFeeGwei: string;
  maxFeeOverrideGwei: string;
  history: HistoryRecord[];
}

type BuildStage = "build" | "submit";

function formatGwei(value: bigint) {
  return formatUnits(value, "gwei");
}

function toWeiFromGwei(value: string) {
  return parseUnits(value.trim() || "0", "gwei");
}

function parseUintText(value: string, label: string, options: { allowEmptyAsZero?: boolean } = {}) {
  const trimmed = value.trim();
  if (!trimmed && options.allowEmptyAsZero) return 0n;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a decimal integer.`);
  }
  return BigInt(trimmed);
}

function parseOptionalNonce(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) throw new Error("Nonce must be a non-negative safe integer.");
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Nonce must be a non-negative safe integer.");
  }
  return parsed;
}

function parseMultiplier(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error("Base fee multiplier must be a non-negative decimal.");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}` || "0");
  return { numerator, denominator, text: trimmed };
}

function ceilMultiply(value: bigint, numerator: bigint, denominator: bigint) {
  return (value * numerator + denominator - 1n) / denominator;
}

function short(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function compactErrorMessage(err: unknown) {
  return (err instanceof Error ? err.message : String(err))
    .replace(/https?:\/\/\S+/gi, "[redacted_url]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[redacted_auth]")
    .replace(
      /\b(rawCalldata|fullCalldata|canonicalCalldata|calldata)\s*[:=]\s*["']?0x[a-f0-9]+["']?/gi,
      "$1=[redacted_calldata]",
    )
    .replace(
      /(["'])(data|input|transactionData|transaction_data)\1\s*:\s*(["'])0x[a-f0-9]{9,}\3/gi,
      "$1$2$1:$3[redacted_calldata]$3",
    )
    .replace(
      /\b(data|input|transaction(?:\s+|_)?data)\s*[:=]\s*["']?0x[a-f0-9]{9,}["']?/gi,
      "$1=[redacted_calldata]",
    )
    .replace(/\b0x[a-f0-9]{64,}\b/gi, (value) =>
      value.length === 66 ? value : "[redacted_hex_payload]",
    )
    .replace(/\b(api[_-]?key|apikey|token|auth|authorization|password|secret)=\S+/gi, "$1=[redacted]");
}

function warningLabel(code: string) {
  switch (code) {
    case "emptyCalldata":
      return "Acknowledge empty calldata";
    case "unknownSelector":
      return "Acknowledge unknown selector";
    case "selectorConflict":
      return "Acknowledge selector conflict";
    case "staleInference":
      return "Acknowledge stale inference";
    case "inferenceUnavailable":
      return "Acknowledge unavailable inference";
    case "nonzeroValue":
      return "Acknowledge nonzero native value";
    case "manualGas":
      return "Acknowledge manual gas";
    case "highFee":
      return "Acknowledge high fee";
    case "largeCalldata":
      return "Acknowledge large calldata";
    default:
      return `Acknowledge ${code}`;
  }
}

function statusTone(status: RawCalldataStatus) {
  return status.level === "blocking" ? "inline-error" : "inline-warning";
}

export function summarizeRawCalldataRpcEndpoint(rpcUrl: string) {
  const trimmed = rpcUrl.trim();
  const splitAt = trimmed.indexOf("://");
  if (splitAt < 0) return "[redacted_endpoint]";
  const scheme = trimmed.slice(0, splitAt).toLowerCase();
  const rest = trimmed.slice(splitAt + 3);
  if (
    scheme.length === 0 ||
    ![...scheme].every((ch) => /[a-z0-9+.-]/.test(ch))
  ) {
    return "[redacted_endpoint]";
  }
  const authority = rest
    .split(/[/?#]/, 1)[0]
    .split("@")
    .at(-1) ?? "";
  if (!authority || /\s/.test(authority)) return "[redacted_endpoint]";
  return `${scheme}://${canonicalRpcAuthority(scheme, authority)}`;
}

export function rawCalldataRpcEndpointFingerprint(rpcUrl: string) {
  return compactHashKeyWithPrefix("rpc-endpoint", normalizedSecretSafeRpcIdentity(rpcUrl));
}

function normalizedSecretSafeRpcIdentity(rpcUrl: string) {
  const trimmed = rpcUrl.trim();
  const splitAt = trimmed.indexOf("://");
  if (splitAt < 0) return "[redacted_url]";
  const scheme = trimmed.slice(0, splitAt).toLowerCase();
  const restWithoutFragment = trimmed.slice(splitAt + 3).split("#", 1)[0];
  const authorityEndMatch = restWithoutFragment.search(/[/?]/);
  const authorityEnd = authorityEndMatch === -1 ? restWithoutFragment.length : authorityEndMatch;
  const authority = (restWithoutFragment.slice(0, authorityEnd).split("@").at(-1) ?? "").toLowerCase();
  if (!authority) return "[redacted_url]";
  const canonicalAuthority = canonicalRpcAuthority(scheme, authority);
  const remainder = restWithoutFragment.slice(authorityEnd);
  const queryAt = remainder.indexOf("?");
  const path = queryAt >= 0 ? remainder.slice(0, queryAt) || "/" : remainder || "/";
  const query = queryAt >= 0 ? remainder.slice(queryAt + 1) : "";
  const redactedQuery = query
    .split("&")
    .filter(Boolean)
    .map((part) => `${decodeRpcQueryKey(part.split("=", 1)[0])}=[redacted]`)
    .join("&");
  return `${scheme}://${canonicalAuthority}${path}${redactedQuery ? `?${redactedQuery}` : ""}`;
}

function canonicalRpcAuthority(scheme: string, authority: string) {
  const lower = authority.toLowerCase();
  if (lower.startsWith("[")) {
    const end = lower.indexOf("]");
    if (end >= 0) {
      const bracketedHost = lower.slice(0, end + 1);
      const suffix = lower.slice(end + 1);
      const port = suffix.startsWith(":") ? suffix.slice(1) : null;
      return port && isDefaultRpcPort(scheme, port) ? bracketedHost : lower;
    }
  }
  const colon = lower.lastIndexOf(":");
  if (colon > -1) {
    const host = lower.slice(0, colon);
    const port = lower.slice(colon + 1);
    if (!host.includes(":") && isDefaultRpcPort(scheme, port)) return host;
  }
  return lower;
}

function isDefaultRpcPort(scheme: string, port: string) {
  return (scheme === "https" && port === "443") || (scheme === "http" && port === "80");
}

function decodeRpcQueryKey(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value.replace(/\+/g, " ");
  }
}

function compactHashKeyWithPrefix(prefix: string, value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function cacheEntryInput(entry: AbiCacheEntryRecord): AbiManagedEntryInput {
  return {
    chainId: entry.chainId,
    contractAddress: entry.contractAddress,
    sourceKind: entry.sourceKind,
    providerConfigId: entry.providerConfigId ?? null,
    userSourceId: entry.userSourceId ?? null,
    versionId: entry.versionId,
    abiHash: entry.abiHash,
    sourceFingerprint: entry.sourceFingerprint,
  };
}

function normalizeSelector(value: string | null | undefined) {
  return /^0x[0-9a-f]{8}$/i.test(value ?? "") ? value!.toLowerCase() : null;
}

function matchedSource(entry: AbiCacheEntryRecord, fn?: AbiFunctionSchema | null) {
  return {
    identity: entry.sourceKind,
    version: entry.versionId,
    fingerprint: entry.sourceFingerprint,
    abiHash: entry.abiHash,
    functionSignature: fn?.signature ?? null,
  };
}

async function inferSelector(
  state: AbiRegistryState | null | undefined,
  chainId: number,
  to: string,
  selector: string | null,
  onListAbiFunctions: RawCalldataViewProps["onListAbiFunctions"],
): Promise<RawCalldataInferenceInput> {
  if (!state) {
    return { status: "unavailable", sourceStatus: "abiRegistryUnavailable" };
  }
  const entries = state.cacheEntries.filter(
    (entry) =>
      entry.chainId === chainId &&
      entry.contractAddress.toLowerCase() === to.toLowerCase(),
  );
  if (entries.length === 0) {
    return { status: "unknown", selectorMatchCount: 0, sourceStatus: "noAbiForContract" };
  }
  const selected = entries.filter((entry) => entry.selected || entry.selectionStatus === "selected");
  if (selected.length === 0) {
    return { status: "unknown", selectorMatchCount: 0, sourceStatus: "noSelectedAbi" };
  }
  const selectedFresh = selected.filter(
    (entry) => entry.fetchSourceStatus === "ok" && entry.cacheStatus === "cacheFresh",
  );
  if (selectedFresh.length === 0) {
    return {
      status: "stale",
      selectorMatchCount: selected.length,
      staleSummary: selected.map((entry) => entry.cacheStatus).join(", "),
      sourceStatus: "selectedAbiStale",
    };
  }
  const conflicted = selectedFresh.filter(
    (entry) =>
      entry.validationStatus === "selectorConflict" ||
      entry.selectionStatus === "sourceConflict" ||
      entry.selectionStatus === "needsUserChoice" ||
      (entry.selectorSummary?.conflictCount ?? 0) > 0 ||
      (entry.selectorSummary?.duplicateSelectorCount ?? 0) > 0,
  );
  if (conflicted.length > 0 || selectedFresh.length > 1) {
    return {
      status: "conflict",
      selectorMatchCount: selectedFresh.length,
      conflictSummary: `selected ABI entries ${selectedFresh.length}; conflict entries ${conflicted.length}`,
      sourceStatus: "selectorConflict",
    };
  }

  const entry = selectedFresh[0];
  if (!selector || !onListAbiFunctions) {
    return {
      status: "unknown",
      matchedSource: matchedSource(entry),
      selectorMatchCount: entry.selectorSummary?.functionSelectorCount ?? null,
      sourceStatus: "selectorMapUnavailable",
    };
  }

  let catalog: AbiFunctionCatalogResult;
  try {
    catalog = await onListAbiFunctions(cacheEntryInput(entry));
  } catch {
    return {
      status: "unknown",
      matchedSource: matchedSource(entry),
      selectorMatchCount: null,
      sourceStatus: "functionCatalogUnavailable",
    };
  }

  if (catalog.status !== "success") {
    return {
      status: "unknown",
      matchedSource: matchedSource(entry),
      selectorMatchCount: null,
      sourceStatus: catalog.status || "functionCatalogUnavailable",
    };
  }

  const matches = catalog.functions.filter((fn) => normalizeSelector(fn.selector) === selector);
  const signatures = Array.from(new Set(matches.map((fn) => fn.signature))).sort();
  if (signatures.length > 1) {
    return {
      status: "conflict",
      matchedSource: matchedSource(entry),
      selectorMatchCount: matches.length,
      conflictSummary: `selector ${selector} matches ${signatures.length} functions in the selected ABI`,
      sourceStatus: "selectorConflict",
    };
  }
  if (matches.length === 1 || signatures.length === 1) {
    return {
      status: "matched",
      matchedSource: matchedSource(entry, matches[0]),
      selectorMatchCount: matches.length,
      sourceStatus: "selectedAbiFunctionSelector",
    };
  }

  return {
    status: "unknown",
    matchedSource: matchedSource(entry),
    selectorMatchCount: 0,
    sourceStatus: "selectorNotFound",
  };
}

function buildWarningAcknowledgements(warnings: RawCalldataStatus[]) {
  return warnings
    .filter((warning) => warning.requiresAcknowledgement)
    .map((warning) => ({ code: warning.code, acknowledged: warning.acknowledged === true }));
}

function draftSubmitInput(
  draft: RawCalldataDraft,
  reference: RawCalldataFeeReference,
  rpcUrl: string,
): RawCalldataSubmitInput | null {
  const submission = draft.submission;
  if (!submission) return null;
  return {
    rpcUrl,
    draftId: draft.draftId,
    frozenKey: draft.frozenKey,
    createdAt: draft.createdAt,
    chainId: submission.chainId,
    selectedRpc: submission.selectedRpc,
    from: submission.from,
    accountIndex: submission.fromAccountIndex,
    fromAccountIndex: submission.fromAccountIndex,
    to: submission.to,
    valueWei: submission.valueWei,
    calldata: submission.calldata,
    calldataHashVersion: submission.calldataHashVersion,
    calldataHash: submission.calldataHash,
    calldataByteLength: submission.calldataByteLength,
    selector: submission.selector,
    selectorStatus: submission.selectorStatus,
    nonce: submission.nonce,
    gasLimit: submission.gasLimit,
    estimatedGasLimit: submission.estimatedGasLimit,
    manualGas: reference.manualGas,
    latestBaseFeePerGas: submission.latestBaseFeePerGas,
    baseFeePerGas: submission.baseFeePerGas,
    baseFeeMultiplier: submission.baseFeeMultiplier,
    maxFeePerGas: submission.maxFeePerGas,
    maxFeeOverridePerGas: submission.maxFeeOverridePerGas,
    maxPriorityFeePerGas: submission.maxPriorityFeePerGas,
    liveMaxFeePerGas: reference.liveMaxFeePerGas?.toString() ?? null,
    liveMaxPriorityFeePerGas: reference.liveMaxPriorityFeePerGas?.toString() ?? null,
    warnings: draft.warnings,
    warningAcknowledgements: buildWarningAcknowledgements(draft.warnings),
    blockingStatuses: draft.blockingStatuses,
    inference: draft.inference,
    humanPreview: draft.preview.human,
  };
}

export function RawCalldataView({
  accounts,
  chainId,
  chainName,
  rpcUrl,
  history = [],
  historyStorageIssue = null,
  abiRegistryState = null,
  onSubmitFailed,
  onListAbiFunctions,
  onSubmitRawCalldata = submitRawCalldata,
}: RawCalldataViewProps) {
  const [selectedIndex, setSelectedIndex] = useState("");
  const [to, setTo] = useState("");
  const [valueWei, setValueWei] = useState("0");
  const [calldata, setCalldata] = useState("0x");
  const [nonce, setNonce] = useState("");
  const [gasLimit, setGasLimit] = useState("");
  const [autoGasLimit, setAutoGasLimit] = useState<string | null>(null);
  const [baseFeeGwei, setBaseFeeGwei] = useState("");
  const [baseFeeMultiplier, setBaseFeeMultiplier] = useState("2");
  const [priorityFeeGwei, setPriorityFeeGwei] = useState("");
  const [maxFeeOverrideGwei, setMaxFeeOverrideGwei] = useState("");
  const [acknowledgements, setAcknowledgements] = useState<Partial<Record<RawCalldataWarningCode, boolean>>>({});
  const [draft, setDraft] = useState<RawCalldataDraft | null>(null);
  const [feeReference, setFeeReference] = useState<RawCalldataFeeReference | null>(null);
  const [draftCreatedAt, setDraftCreatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ stage: BuildStage; message: string } | null>(null);
  const [submitResult, setSubmitResult] = useState<HistoryRecord | null>(null);
  const [draftSnapshot, setDraftSnapshot] = useState<RawCalldataBuildSnapshot | null>(null);
  const buildRequestRef = useRef(0);
  const activeBuildRequestRef = useRef<number | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.index.toString() === selectedIndex) ?? null,
    [accounts, selectedIndex],
  );
  const errorDisplay = useMemo(
    () =>
      error
        ? getRawHistoryErrorDisplay({
            message: error.message,
            source: error.stage === "submit" ? "raw calldata submit" : "raw calldata draft",
            category: error.stage === "submit" ? "submit" : "validation",
          })
        : null,
    [error],
  );

  useEffect(() => {
    if (!selectedIndex && accounts.length > 0) {
      setSelectedIndex(accounts[0].index.toString());
    }
  }, [accounts, selectedIndex]);

  function clearDraft() {
    buildRequestRef.current += 1;
    if (activeBuildRequestRef.current !== null) {
      activeBuildRequestRef.current = null;
      setBusy(false);
    }
    setDraft(null);
    setFeeReference(null);
    setDraftSnapshot(null);
    setDraftCreatedAt(null);
    setAcknowledgements({});
    setSubmitResult(null);
  }

  function fieldChange(setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      clearDraft();
    };
  }

  function setStageError(stage: BuildStage, err: unknown) {
    setError({ stage, message: compactErrorMessage(err) });
  }

  function buildDraftFromReference(
    reference: RawCalldataFeeReference,
    snapshot: RawCalldataBuildSnapshot,
    nextAcknowledgements: Partial<Record<RawCalldataWarningCode, boolean>>,
    createdAt: string,
    values: {
      nonceText?: string;
      gasLimitText?: string;
      baseFeeGweiText?: string;
      priorityFeeGweiText?: string;
    } = {},
  ) {
    const nonceText = values.nonceText ?? snapshot.nonce;
    const gasLimitText = values.gasLimitText ?? snapshot.gasLimit;
    const baseFeeGweiText = values.baseFeeGweiText ?? snapshot.baseFeeGwei;
    const priorityFeeGweiText = values.priorityFeeGweiText ?? snapshot.priorityFeeGwei;
    const normalized = normalizeRawCalldata(snapshot.calldata);
    if (!normalized.ok) {
      throw new Error(normalized.error.message);
    }
    const parsedValueWei = parseUintText(snapshot.valueWei, "Native value", { allowEmptyAsZero: true });
    const parsedGasLimit = gasLimitText.trim()
      ? parseUintText(gasLimitText, "Gas limit")
      : reference.estimatedGasLimit ?? 0n;
    const parsedNonce = parseOptionalNonce(nonceText);
    const parsedPriorityFee = priorityFeeGweiText.trim()
      ? toWeiFromGwei(priorityFeeGweiText)
      : reference.liveMaxPriorityFeePerGas ?? 1_500_000_000n;
    const parsedBaseFee = baseFeeGweiText.trim()
      ? toWeiFromGwei(baseFeeGweiText)
      : reference.latestBaseFeePerGas;
    if (parsedBaseFee === null) {
      throw new Error("Latest base fee is unavailable. Enter Base fee (gwei) before building.");
    }
    const parsedMultiplier = parseMultiplier(snapshot.baseFeeMultiplier || "2");
    const parsedMaxFeeOverride = snapshot.maxFeeOverrideGwei.trim()
      ? toWeiFromGwei(snapshot.maxFeeOverrideGwei)
      : null;
    const parsedMaxFee =
      parsedMaxFeeOverride ??
      ceilMultiply(parsedBaseFee, parsedMultiplier.numerator, parsedMultiplier.denominator) +
        parsedPriorityFee;
    return buildRawCalldataDraft({
      chainId: snapshot.chainId,
      selectedRpc: reference.selectedRpc,
      from: snapshot.account.address,
      fromAccountIndex: snapshot.account.index,
      to: snapshot.to,
      valueWei: parsedValueWei,
      calldata: snapshot.calldata,
      nonce: parsedNonce,
      fee: {
        gasLimit: parsedGasLimit,
        estimatedGasLimit: reference.estimatedGasLimit,
        manualGas: reference.manualGas,
        latestBaseFeePerGas: reference.latestBaseFeePerGas,
        baseFeePerGas: parsedBaseFee,
        baseFeeMultiplier: parsedMultiplier.text,
        maxFeePerGas: parsedMaxFee,
        maxFeeOverridePerGas: parsedMaxFeeOverride,
        maxPriorityFeePerGas: parsedPriorityFee,
        liveMaxFeePerGas: reference.liveMaxFeePerGas,
        liveMaxPriorityFeePerGas: reference.liveMaxPriorityFeePerGas,
      },
      inference: reference.inference,
      warningAcknowledgements: nextAcknowledgements,
      humanPreviewRows: [
        { label: "To", value: snapshot.to },
        { label: "Native value wei", value: parsedValueWei.toString() },
        { label: "RPC", value: reference.selectedRpc.endpointSummary ?? "unknown" },
        { label: "Gas limit", value: parsedGasLimit.toString() },
        { label: "Nonce", value: parsedNonce === null ? "unknown" : parsedNonce.toString() },
      ],
      createdAt,
    });
  }

  async function buildDraft() {
    setError(null);
    setSubmitResult(null);
    if (historyStorageIssue) {
      setStageError("build", historyStorageIssue);
      return;
    }
    const requestId = buildRequestRef.current + 1;
    buildRequestRef.current = requestId;
    activeBuildRequestRef.current = requestId;
    setBusy(true);
    try {
      const trimmedRpcUrl = rpcUrl.trim();
      if (!trimmedRpcUrl) throw new Error("RPC URL is required.");
      if (!selectedAccount) throw new Error("Select a sender account.");
      const snapshot: RawCalldataBuildSnapshot = {
        account: selectedAccount,
        chainId,
        rpcUrl: trimmedRpcUrl,
        to,
        valueWei,
        calldata,
        nonce,
        gasLimit,
        autoGasLimit,
        baseFeeGwei,
        baseFeeMultiplier,
        priorityFeeGwei,
        maxFeeOverrideGwei,
        history,
      };
      if (!isAddress(snapshot.to)) throw new Error("Target address is invalid.");
      const normalized = normalizeRawCalldata(snapshot.calldata);
      if (!normalized.ok) throw new Error(normalized.error.message);

      const parsedValueWei = parseUintText(snapshot.valueWei, "Native value", { allowEmptyAsZero: true });
      const provider = new JsonRpcProvider(snapshot.rpcUrl);
      const [network, feeData, latestBlock, onChainNonce] = await Promise.all([
        provider.getNetwork(),
        provider.getFeeData(),
        provider.getBlock("latest"),
        provider.getTransactionCount(snapshot.account.address, "pending"),
      ]);
      if (network.chainId !== snapshot.chainId) {
        throw new Error(`RPC returned chainId ${network.chainId}; expected ${snapshot.chainId}.`);
      }

      const gasLimitInput = snapshot.gasLimit.trim();
      const manualGas = gasLimitInput.length > 0 && gasLimitInput !== snapshot.autoGasLimit;
      let estimatedGasLimit: bigint | null = null;
      let estimateFailure: string | null = null;
      try {
        estimatedGasLimit = await provider.estimateGas({
          from: snapshot.account.address,
          to: snapshot.to,
          value: parsedValueWei,
          data: normalized.canonical,
        });
      } catch (err) {
        estimateFailure = compactErrorMessage(err);
      }

      const latestBaseFeePerGas = latestBlock?.baseFeePerGas ?? null;
      const liveMaxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? null;
      const livePriorityFee = feeData.maxPriorityFeePerGas ?? 1_500_000_000n;
      const nextNonce =
        parseOptionalNonce(snapshot.nonce) ??
        nextNonceWithLocalPending(
          onChainNonce,
          snapshot.history,
          snapshot.account.index,
          Number(snapshot.chainId),
          snapshot.account.address,
        );
      const nextGasLimit = manualGas
        ? parseUintText(snapshot.gasLimit, "Gas limit")
        : estimatedGasLimit;
      const nextGasLimitText = nextGasLimit?.toString() ?? "";
      const nextNonceText = nextNonce.toString();
      const nextBaseFeeGweiText =
        snapshot.baseFeeGwei.trim() || latestBaseFeePerGas === null
          ? snapshot.baseFeeGwei
          : formatGwei(latestBaseFeePerGas);
      const nextPriorityFeeGweiText = snapshot.priorityFeeGwei.trim()
        ? snapshot.priorityFeeGwei
        : formatGwei(livePriorityFee);
      const selectedRpc: RawCalldataRpcIdentityInput = {
        chainId: Number(network.chainId),
        providerConfigId: `chain-${Number(snapshot.chainId)}`,
        endpointId: "active",
        endpointName: "Selected RPC",
        endpointSummary: summarizeRawCalldataRpcEndpoint(snapshot.rpcUrl),
        endpointFingerprint: rawCalldataRpcEndpointFingerprint(snapshot.rpcUrl),
      };
      const inference = await inferSelector(
        abiRegistryState,
        Number(snapshot.chainId),
        snapshot.to,
        normalized.byteLength >= 4 ? normalized.canonical.slice(0, 10) : null,
        onListAbiFunctions,
      );
      if (
        activeBuildRequestRef.current !== requestId ||
        buildRequestRef.current !== requestId
      ) {
        return;
      }
      if (nextGasLimit !== null && !manualGas) {
        setGasLimit(nextGasLimitText);
        setAutoGasLimit(nextGasLimitText);
      } else if (!manualGas && snapshot.autoGasLimit !== null && gasLimitInput === snapshot.autoGasLimit) {
        setGasLimit("");
        setAutoGasLimit(null);
      }
      if (!snapshot.nonce.trim()) setNonce(nextNonceText);
      if (!snapshot.baseFeeGwei.trim() && latestBaseFeePerGas !== null) {
        setBaseFeeGwei(nextBaseFeeGweiText);
      }
      if (!snapshot.priorityFeeGwei.trim()) {
        setPriorityFeeGwei(nextPriorityFeeGweiText);
      }

      const reference: RawCalldataFeeReference = {
        selectedRpc,
        estimatedGasLimit,
        manualGas,
        latestBaseFeePerGas,
        liveMaxFeePerGas,
        liveMaxPriorityFeePerGas: livePriorityFee,
        estimateFailure,
        inference,
      };
      const createdAt = new Date().toISOString();
      const nextAcknowledgements: Partial<Record<RawCalldataWarningCode, boolean>> = {};
      const appliedSnapshot: RawCalldataBuildSnapshot = {
        ...snapshot,
        nonce: nextNonceText,
        gasLimit: nextGasLimitText,
        baseFeeGwei: nextBaseFeeGweiText,
        priorityFeeGwei: nextPriorityFeeGweiText,
      };
      const nextDraft = buildDraftFromReference(
        reference,
        appliedSnapshot,
        nextAcknowledgements,
        createdAt,
      );
      setAcknowledgements(nextAcknowledgements);
      setFeeReference(reference);
      setDraftSnapshot(appliedSnapshot);
      setDraftCreatedAt(createdAt);
      setDraft(nextDraft);
    } catch (err) {
      if (
        activeBuildRequestRef.current === requestId &&
        buildRequestRef.current === requestId
      ) {
        setStageError("build", err);
        setDraft(null);
        setFeeReference(null);
        setDraftSnapshot(null);
        setDraftCreatedAt(null);
      }
    } finally {
      if (activeBuildRequestRef.current === requestId) {
        activeBuildRequestRef.current = null;
        setBusy(false);
      }
    }
  }

  function updateAcknowledgement(code: RawCalldataWarningCode, acknowledged: boolean) {
    if (!feeReference || !draftSnapshot || !draftCreatedAt) return;
    const nextAcknowledgements = { ...acknowledgements, [code]: acknowledged };
    try {
      setError(null);
      setAcknowledgements(nextAcknowledgements);
      setDraft(buildDraftFromReference(feeReference, draftSnapshot, nextAcknowledgements, draftCreatedAt));
    } catch (err) {
      setStageError("build", err);
    }
  }

  async function submitDraft() {
    setError(null);
    if (!draft || !feeReference) return;
    if (historyStorageIssue) {
      setStageError("submit", historyStorageIssue);
      return;
    }
    const input = draftSubmitInput(draft, feeReference, rpcUrl.trim());
    if (!input) return;
    setBusy(true);
    try {
      const record = await onSubmitRawCalldata(input);
      setSubmitResult(record);
      setDraft(null);
    } catch (err) {
      setStageError("submit", err);
      try {
        await onSubmitFailed?.(err);
      } catch {
        // Keep the submit error visible; parent recovery state can be refreshed separately.
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-section raw-calldata-grid">
      <header className="section-header">
        <h2>Raw Calldata</h2>
        <span className="pill">{chainName}</span>
      </header>
      <label>
        From
        <select
          disabled={accounts.length === 0}
          onChange={(event) => {
            setSelectedIndex(event.target.value);
            clearDraft();
          }}
          value={selectedIndex}
        >
          {accounts.map((account) => (
            <option key={account.index} value={account.index.toString()}>
              {account.label} · {short(account.address)}
            </option>
          ))}
        </select>
      </label>
      <label>
        To
        <input onChange={(event) => fieldChange(setTo)(event.target.value)} value={to} />
      </label>
      <label>
        Native value (wei)
        <input
          inputMode="numeric"
          onChange={(event) => fieldChange(setValueWei)(event.target.value)}
          value={valueWei}
        />
      </label>
      <label>
        Calldata
        <textarea
          className="raw-calldata-textarea mono"
          onChange={(event) => fieldChange(setCalldata)(event.target.value)}
          rows={8}
          spellCheck={false}
          value={calldata}
        />
      </label>
      <div className="field-row">
        <label>
          Nonce
          <input
            inputMode="numeric"
            onChange={(event) => fieldChange(setNonce)(event.target.value)}
            value={nonce}
          />
        </label>
        <label>
        Gas limit
          <input
            inputMode="numeric"
            onChange={(event) => {
              setAutoGasLimit(null);
              fieldChange(setGasLimit)(event.target.value);
            }}
            value={gasLimit}
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          Base fee (gwei)
          <input
            inputMode="decimal"
            onChange={(event) => fieldChange(setBaseFeeGwei)(event.target.value)}
            value={baseFeeGwei}
          />
        </label>
        <label>
          Base fee multiplier
          <input
            inputMode="decimal"
            onChange={(event) => fieldChange(setBaseFeeMultiplier)(event.target.value)}
            value={baseFeeMultiplier}
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          Priority fee (gwei)
          <input
            inputMode="decimal"
            onChange={(event) => fieldChange(setPriorityFeeGwei)(event.target.value)}
            value={priorityFeeGwei}
          />
        </label>
        <label>
          Max fee override (gwei)
          <input
            inputMode="decimal"
            onChange={(event) => fieldChange(setMaxFeeOverrideGwei)(event.target.value)}
            value={maxFeeOverrideGwei}
          />
        </label>
      </div>
      <div className="button-row">
        <button
          disabled={busy || accounts.length === 0 || historyStorageIssue !== null}
          onClick={() => void buildDraft()}
          title={historyStorageIssue ?? undefined}
          type="button"
        >
          Build Draft
        </button>
      </div>
      {historyStorageIssue && (
        <div className="inline-warning" role="alert">
          {historyStorageIssue}
        </div>
      )}
      {errorDisplay && (
        <HistoryErrorCard error={errorDisplay} meta={error?.stage ?? "build"} role="alert" />
      )}
      {submitResult && (
        <div className="inline-success" role="status">
          Raw calldata submitted: <span className="mono">{submitResult.submission.tx_hash}</span>
        </div>
      )}
      {draft && (
        <section aria-label="Raw calldata confirmation" className="confirmation-panel">
          <header className="section-header">
            <h3>Confirm Raw Calldata</h3>
            <span className={draft.canSubmit ? "pill" : "pill danger-pill"}>
              {draft.canSubmit ? "Ready" : "Needs acknowledgement"}
            </span>
          </header>
          {feeReference?.estimateFailure && (
            <div className="inline-warning" role="alert">
              Gas estimate failed: {feeReference.estimateFailure}
            </div>
          )}
          {draft.blockingStatuses.map((status) => (
            <div className={statusTone(status)} key={`${status.level}-${status.code}`} role="alert">
              {status.code}: {status.message}
            </div>
          ))}
          <div className="confirmation-grid raw-calldata-confirmation-grid">
            <div>Chain</div>
            <div className="mono">{chainName} (chainId {chainId.toString()})</div>
            <div>From</div>
            <div className="mono">{draft.submission?.from ?? selectedAccount?.address ?? "unknown"}</div>
            <div>To</div>
            <div className="mono">{draft.submission?.to ?? to}</div>
            <div>Native value</div>
            <div className="mono">{draft.submission?.valueWei ?? (valueWei || "0")} wei</div>
            <div>Selector</div>
            <div className="mono">{draft.preview.selector ?? "none"} ({draft.preview.selectorStatus})</div>
            <div>Calldata bytes</div>
            <div className="mono">{draft.preview.byteLength}</div>
            <div>Calldata hash</div>
            <div className="mono">{draft.preview.hashVersion} · {draft.preview.hash}</div>
            <div>Bounded preview</div>
            <div className="mono">
              {draft.preview.display}
              {draft.preview.truncated ? ` · omitted ${draft.preview.omittedBytes} bytes` : ""}
            </div>
            <div>Inference</div>
            <div className="mono">
              {draft.inference.status}
              {draft.inference.sourceStatus ? ` · ${draft.inference.sourceStatus}` : ""}
              {draft.inference.selectorMatchCount !== null && draft.inference.selectorMatchCount !== undefined
                ? ` · matches ${draft.inference.selectorMatchCount}`
                : ""}
            </div>
            <div>Nonce</div>
            <div className="mono">{draft.submission?.nonce ?? (nonce || "unknown")}</div>
            <div>Gas limit</div>
            <div className="mono">{draft.submission?.gasLimit ?? (gasLimit || "missing")}</div>
            <div>Estimated gas</div>
            <div className="mono">{draft.submission?.estimatedGasLimit ?? "Unavailable"}</div>
            <div>Base fee used</div>
            <div className="mono">{draft.submission ? formatGwei(BigInt(draft.submission.baseFeePerGas)) : baseFeeGwei} gwei</div>
            <div>Max fee</div>
            <div className="mono">{draft.submission ? formatGwei(BigInt(draft.submission.maxFeePerGas)) : "Unknown"} gwei</div>
            <div>Priority fee</div>
            <div className="mono">{draft.submission ? formatGwei(BigInt(draft.submission.maxPriorityFeePerGas)) : priorityFeeGwei} gwei</div>
            <div>Selected RPC</div>
            <div className="mono">{draft.submission?.selectedRpc?.endpointSummary ?? "unknown"}</div>
            <div>Frozen key</div>
            <div className="mono">{draft.frozenKey}</div>
          </div>
          {draft.warnings.length > 0 && (
            <div className="raw-calldata-warning-list" aria-label="Raw calldata warnings">
              {draft.warnings.map((warning) => (
                <label className="check-row" key={`${warning.code}-${warning.source}`}>
                  <input
                    checked={warning.acknowledged === true}
                    disabled={!warning.requiresAcknowledgement}
                    onChange={(event) =>
                      updateAcknowledgement(
                        warning.code as RawCalldataWarningCode,
                        event.target.checked,
                      )
                    }
                    type="checkbox"
                  />
                  <span>
                    {warningLabel(warning.code)} · {warning.message}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="button-row">
            <button
              disabled={busy || !draft.canSubmit || historyStorageIssue !== null}
              onClick={() => void submitDraft()}
              title={historyStorageIssue ?? undefined}
              type="button"
            >
              Submit
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
