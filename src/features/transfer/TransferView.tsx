import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  formatEther,
  formatUnits,
  isAddress,
  JsonRpcProvider,
  parseEther,
  parseUnits,
} from "ethers";
import type { TransferDraft } from "../../core/transactions/draft";
import { createTransferDraft } from "../../core/transactions/draft";
import type { Erc20TransferDraft } from "../../core/transactions/erc20Draft";
import { buildErc20TransferDraft } from "../../core/transactions/erc20Draft";
import { getRawHistoryErrorDisplay } from "../../core/history/errors";
import { nextNonceWithLocalPending } from "../../core/history/reconciler";
import { HistoryErrorCard } from "../history/HistoryErrorCard";
import type {
  AccountRecord,
  Erc20TransferIntent,
  HistoryRecord,
  NativeTransferIntent,
  PendingMutationRequest,
} from "../../lib/tauri";
import { submitErc20Transfer, submitNativeTransfer } from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";

export interface TransferViewProps {
  draft: TransferDraft | null;
  accounts: Array<AccountRecord & AccountChainState>;
  chainId: bigint;
  chainName: string;
  rpcUrl: string;
  history?: HistoryRecord[];
  historyStorageIssue?: string | null;
  onSubmitFailed?: (error: unknown) => Promise<void> | void;
  onSubmitted: (record: HistoryRecord) => void;
}

function formatGwei(value: bigint) {
  return formatUnits(value, "gwei");
}

function formatEth(value: bigint) {
  return formatEther(value);
}

function toWeiFromGwei(value: string) {
  return parseUnits(value.trim() || "0", "gwei");
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

function ConfirmationRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <div>{label}</div>
      <div className="mono">{value}</div>
    </>
  );
}

export function TransferView({
  draft: initialDraft,
  accounts,
  chainId,
  chainName,
  rpcUrl,
  history = [],
  historyStorageIssue = null,
  onSubmitFailed,
  onSubmitted,
}: TransferViewProps) {
  const [transferMode, setTransferMode] = useState<"native" | "erc20">("native");
  const [selectedIndex, setSelectedIndex] = useState("");
  const [to, setTo] = useState("");
  const [amountEth, setAmountEth] = useState("");
  const [tokenContract, setTokenContract] = useState("");
  const [erc20Recipient, setErc20Recipient] = useState("");
  const [erc20Amount, setErc20Amount] = useState("");
  const [confirmedDecimals, setConfirmedDecimals] = useState("");
  const [nonce, setNonce] = useState("");
  const [nativeGasLimit, setNativeGasLimit] = useState("21000");
  const [erc20GasLimit, setErc20GasLimit] = useState("");
  const [baseFeeGwei, setBaseFeeGwei] = useState("");
  const [baseFeeIsManual, setBaseFeeIsManual] = useState(false);
  const [baseFeeMultiplier, setBaseFeeMultiplier] = useState("2");
  const [maxFeeOverrideGwei, setMaxFeeOverrideGwei] = useState("");
  const [priorityFeeGwei, setPriorityFeeGwei] = useState("");
  const [draft, setDraft] = useState<TransferDraft | null>(initialDraft);
  const [erc20Draft, setErc20Draft] = useState<Erc20TransferDraft | null>(null);
  const [secondConfirm, setSecondConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    message: string;
    stage: "build" | "submit";
  } | null>(null);
  const errorDisplay = useMemo(
    () =>
      error
        ? getRawHistoryErrorDisplay({
            message: error.message,
            source: error.stage === "submit" ? "transfer submit" : "transfer draft",
            category: error.stage === "submit" ? "submit" : "validation",
          })
        : null,
    [error],
  );

  function setStageError(stage: "build" | "submit", err: unknown) {
    setError({
      stage,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.index.toString() === selectedIndex) ?? null,
    [accounts, selectedIndex],
  );
  const maxGasCostWei = draft
    ? draft.submission.gasLimit * draft.submission.maxFeePerGas
    : 0n;
  const maxTotalCostWei = draft ? draft.submission.valueWei + maxGasCostWei : 0n;
  const erc20MaxGasCostWei = erc20Draft
    ? erc20Draft.submission.gasLimit * erc20Draft.submission.maxFeePerGas
    : 0n;
  const activeGasLimit = transferMode === "native" ? nativeGasLimit : erc20GasLimit;

  function clearDraft() {
    setDraft(null);
    setErc20Draft(null);
    setSecondConfirm(false);
  }

  function resetBaseFeeReference() {
    setBaseFeeGwei("");
    setBaseFeeIsManual(false);
  }

  useEffect(() => {
    if (!selectedIndex && accounts.length > 0) {
      setSelectedIndex(accounts[0].index.toString());
    }
  }, [accounts, selectedIndex]);

  useEffect(() => {
    resetBaseFeeReference();
    clearDraft();
  }, [selectedIndex, chainId, rpcUrl]);

  async function buildDraft() {
    setError(null);
    if (historyStorageIssue) {
      setStageError("build", historyStorageIssue);
      return;
    }
    setBusy(true);
    try {
      if (!rpcUrl.trim()) throw new Error("RPC URL is required.");
      if (!selectedAccount) throw new Error("Select a sender account.");
      if (!isAddress(to)) throw new Error("Destination address is invalid.");

      const provider = new JsonRpcProvider(rpcUrl);
      const network = await provider.getNetwork();
      if (network.chainId !== chainId) {
        throw new Error(`RPC returned chainId ${network.chainId}; expected ${chainId}.`);
      }

      const valueWei = parseEther(amountEth.trim() || "0");
      if (valueWei <= 0n) throw new Error("Amount must be greater than zero.");
      const feeData = await provider.getFeeData();
      const latestBlock = await provider.getBlock("latest");
      const latestBaseFeePerGas = latestBlock?.baseFeePerGas ?? null;
      const liveMaxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
      const livePriorityFee = feeData.maxPriorityFeePerGas ?? 1_500_000_000n;
      const onChainNonce = await provider.getTransactionCount(selectedAccount.address, "pending");
      let estimatedGasLimit = 21_000n;

      try {
        estimatedGasLimit = await provider.estimateGas({
          from: selectedAccount.address,
          to,
          value: valueWei,
        });
      } catch {
        estimatedGasLimit = 21_000n;
      }

      const nextNonce = nonce.trim()
        ? Number(nonce)
        : nextNonceWithLocalPending(
            onChainNonce,
            history,
            selectedAccount.index,
            Number(chainId),
            selectedAccount.address,
          );
      const nextGasLimit = nativeGasLimit.trim() ? BigInt(nativeGasLimit) : estimatedGasLimit;
      const nextPriorityFee = priorityFeeGwei.trim()
        ? toWeiFromGwei(priorityFeeGwei)
        : livePriorityFee;
      let nextBaseFee: bigint;
      if (baseFeeIsManual) {
        nextBaseFee = toWeiFromGwei(baseFeeGwei);
      } else {
        if (latestBaseFeePerGas === null) {
          throw new Error(
            "Latest block did not provide baseFeePerGas. Enter a Base fee (gwei) manually before building the draft.",
          );
        }
        nextBaseFee = latestBaseFeePerGas;
      }
      const multiplier = parseMultiplier(baseFeeMultiplier || "2");
      const automaticMaxFee =
        ceilMultiply(nextBaseFee, multiplier.numerator, multiplier.denominator) + nextPriorityFee;
      const maxFeeOverride = maxFeeOverrideGwei.trim()
        ? toWeiFromGwei(maxFeeOverrideGwei)
        : null;
      const nextMaxFee = maxFeeOverride ?? automaticMaxFee;

      setNonce(nextNonce.toString());
      setNativeGasLimit(nextGasLimit.toString());
      if (!baseFeeIsManual) {
        setBaseFeeGwei(formatGwei(nextBaseFee));
      }
      setBaseFeeMultiplier(multiplier.text);
      setPriorityFeeGwei(formatGwei(nextPriorityFee));
      setDraft(
        createTransferDraft({
          chainId,
          from: selectedAccount.address,
          to,
          valueWei,
          nonce: nextNonce,
          gasLimit: nextGasLimit,
          latestBaseFeePerGas,
          baseFeePerGas: nextBaseFee,
          baseFeeMultiplier: multiplier.text,
          maxFeePerGas: nextMaxFee,
          maxFeeOverridePerGas: maxFeeOverride,
          maxPriorityFeePerGas: nextPriorityFee,
          liveMaxFeePerGas,
          liveMaxPriorityFeePerGas: livePriorityFee,
          estimatedGasLimit,
        }),
      );
    } catch (err) {
      setStageError("build", err);
    } finally {
      setBusy(false);
    }
  }

  async function buildErc20Draft() {
    setError(null);
    if (historyStorageIssue) {
      setStageError("build", historyStorageIssue);
      return;
    }
    setBusy(true);
    try {
      if (!rpcUrl.trim()) throw new Error("RPC URL is required.");
      if (!selectedAccount) throw new Error("Select a sender account.");
      if (!isAddress(tokenContract)) throw new Error("Token contract address is invalid.");
      if (!isAddress(erc20Recipient)) throw new Error("Recipient address is invalid.");

      const provider = new JsonRpcProvider(rpcUrl);
      const network = await provider.getNetwork();
      if (network.chainId !== chainId) {
        throw new Error(`RPC returned chainId ${network.chainId}; expected ${chainId}.`);
      }

      const feeData = await provider.getFeeData();
      const latestBlock = await provider.getBlock("latest");
      const latestBaseFeePerGas = latestBlock?.baseFeePerGas ?? null;
      const liveMaxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
      const livePriorityFee = feeData.maxPriorityFeePerGas ?? 1_500_000_000n;
      const onChainNonce = await provider.getTransactionCount(selectedAccount.address, "pending");
      const nextNonce = nonce.trim()
        ? Number(nonce)
        : nextNonceWithLocalPending(
            onChainNonce,
            history,
            selectedAccount.index,
            Number(chainId),
            selectedAccount.address,
          );
      const nextPriorityFee = priorityFeeGwei.trim()
        ? toWeiFromGwei(priorityFeeGwei)
        : livePriorityFee;
      let nextBaseFee: bigint;
      if (baseFeeIsManual) {
        nextBaseFee = toWeiFromGwei(baseFeeGwei);
      } else {
        if (latestBaseFeePerGas === null) {
          throw new Error(
            "Latest block did not provide baseFeePerGas. Enter a Base fee (gwei) manually before building the draft.",
          );
        }
        nextBaseFee = latestBaseFeePerGas;
      }
      const multiplier = parseMultiplier(baseFeeMultiplier || "2");
      const automaticMaxFee =
        ceilMultiply(nextBaseFee, multiplier.numerator, multiplier.denominator) + nextPriorityFee;
      const maxFeeOverride = maxFeeOverrideGwei.trim()
        ? toWeiFromGwei(maxFeeOverrideGwei)
        : null;
      const nextMaxFee = maxFeeOverride ?? automaticMaxFee;
      const userConfirmedDecimals = confirmedDecimals.trim()
        ? Number(confirmedDecimals)
        : null;
      if (confirmedDecimals.trim() && !Number.isInteger(userConfirmedDecimals)) {
        throw new Error("Confirmed decimals must be an integer from 0 to 255.");
      }

      const nextDraft = await buildErc20TransferDraft({
        provider,
        chainId,
        from: selectedAccount.address,
        tokenContract,
        recipient: erc20Recipient,
        amount: erc20Amount,
        userConfirmedDecimals,
        nonce: nextNonce,
        gasLimit: erc20GasLimit.trim() ? BigInt(erc20GasLimit) : null,
        latestBaseFeePerGas,
        baseFeePerGas: nextBaseFee,
        baseFeeMultiplier: multiplier.text,
        maxFeePerGas: nextMaxFee,
        maxFeeOverridePerGas: maxFeeOverride,
        maxPriorityFeePerGas: nextPriorityFee,
        liveMaxFeePerGas,
        liveMaxPriorityFeePerGas: livePriorityFee,
      });

      setNonce(nextNonce.toString());
      setErc20GasLimit(nextDraft.submission.gasLimit.toString());
      if (!baseFeeIsManual) {
        setBaseFeeGwei(formatGwei(nextBaseFee));
      }
      setBaseFeeMultiplier(multiplier.text);
      setPriorityFeeGwei(formatGwei(nextPriorityFee));
      setErc20Draft(nextDraft);
    } catch (err) {
      setStageError("build", err);
    } finally {
      setBusy(false);
    }
  }

  async function submitDraft() {
    setError(null);
    if (!draft || !selectedAccount) return;
    if (historyStorageIssue) {
      setStageError("submit", historyStorageIssue);
      return;
    }
    if (draft.requiresSecondConfirmation && !secondConfirm) {
      setStageError("build", "High-risk fee settings need the extra confirmation.");
      return;
    }
    const submission = draft.submission;
    const intent: NativeTransferIntent = {
      rpc_url: rpcUrl,
      account_index: selectedAccount.index,
      chain_id: Number(chainId),
      from: submission.from,
      to: submission.to,
      value_wei: submission.valueWei.toString(),
      nonce: submission.nonce,
      gas_limit: submission.gasLimit.toString(),
      max_fee_per_gas: submission.maxFeePerGas.toString(),
      max_priority_fee_per_gas: submission.maxPriorityFeePerGas.toString(),
    };

    setBusy(true);
    try {
      const record = await submitNativeTransfer(intent);
      onSubmitted(record);
      setDraft(null);
    } catch (err) {
      setStageError("submit", err);
      try {
        await onSubmitFailed?.(err);
      } catch {
        // The local submit error remains visible; parent recovery state can be retried separately.
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitErc20Draft() {
    setError(null);
    if (!erc20Draft || !selectedAccount) return;
    if (historyStorageIssue) {
      setStageError("submit", historyStorageIssue);
      return;
    }
    if (erc20Draft.requiresSecondConfirmation && !secondConfirm) {
      setStageError("build", "High-risk fee settings need the extra confirmation.");
      return;
    }
    const submission = erc20Draft.submission;
    const intent: Erc20TransferIntent = {
      rpc_url: rpcUrl,
      account_index: selectedAccount.index,
      chain_id: Number(chainId),
      from: submission.from,
      token_contract: submission.tokenContract,
      recipient: submission.recipient,
      amount_raw: submission.amountRaw.toString(),
      decimals: submission.decimals,
      token_symbol: submission.symbol,
      token_name: submission.name,
      token_metadata_source: submission.metadataSource,
      nonce: submission.nonce,
      gas_limit: submission.gasLimit.toString(),
      max_fee_per_gas: submission.maxFeePerGas.toString(),
      max_priority_fee_per_gas: submission.maxPriorityFeePerGas.toString(),
      latest_base_fee_per_gas: submission.latestBaseFeePerGas?.toString() ?? null,
      base_fee_per_gas: submission.baseFeePerGas.toString(),
      base_fee_multiplier: submission.baseFeeMultiplier,
      max_fee_override_per_gas: submission.maxFeeOverridePerGas?.toString() ?? null,
      selector: submission.selector,
      method: submission.method,
      native_value_wei: submission.nativeValueWei.toString(),
      frozen_key: erc20Draft.frozenKey,
    };

    setBusy(true);
    try {
      const record = await submitErc20Transfer(intent);
      onSubmitted(record);
      setErc20Draft(null);
    } catch (err) {
      setStageError("submit", err);
      try {
        await onSubmitFailed?.(err);
      } catch {
        // The local submit error remains visible; parent recovery state can be retried separately.
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-section transfer-grid">
      <header className="section-header">
        <h2>Transfer</h2>
        <span className="pill">{chainName}</span>
      </header>
      <div className="segmented" role="tablist" aria-label="Transfer type">
        <button
          className={transferMode === "native" ? "active" : ""}
          onClick={() => {
            setTransferMode("native");
            clearDraft();
          }}
          type="button"
        >
          Native
        </button>
        <button
          className={transferMode === "erc20" ? "active" : ""}
          onClick={() => {
            setTransferMode("erc20");
            clearDraft();
          }}
          type="button"
        >
          ERC-20
        </button>
      </div>
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
              {account.label} · {account.address.slice(0, 10)}...
            </option>
          ))}
        </select>
      </label>
      {transferMode === "native" ? (
        <>
          <label>
            To
            <input
              onChange={(event) => {
                setTo(event.target.value);
                clearDraft();
              }}
              value={to}
            />
          </label>
          <label>
            Amount
            <input
              inputMode="decimal"
              onChange={(event) => {
                setAmountEth(event.target.value);
                clearDraft();
              }}
              value={amountEth}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Token contract
            <input
              onChange={(event) => {
                setTokenContract(event.target.value);
                clearDraft();
              }}
              value={tokenContract}
            />
          </label>
          <label>
            Recipient
            <input
              onChange={(event) => {
                setErc20Recipient(event.target.value);
                clearDraft();
              }}
              value={erc20Recipient}
            />
          </label>
          <div className="field-row">
            <label>
              Amount
              <input
                inputMode="decimal"
                onChange={(event) => {
                  setErc20Amount(event.target.value);
                  clearDraft();
                }}
                value={erc20Amount}
              />
            </label>
            <label>
              Confirmed decimals
              <input
                inputMode="numeric"
                onChange={(event) => {
                  setConfirmedDecimals(event.target.value);
                  clearDraft();
                }}
                value={confirmedDecimals}
              />
            </label>
          </div>
        </>
      )}
      <div className="field-row">
        <label>
          Nonce
          <input
            inputMode="numeric"
            onChange={(event) => {
              setNonce(event.target.value);
              clearDraft();
            }}
            value={nonce}
          />
        </label>
        <label>
          Gas limit
          <input
            inputMode="numeric"
            onChange={(event) => {
              if (transferMode === "native") {
                setNativeGasLimit(event.target.value);
              } else {
                setErc20GasLimit(event.target.value);
              }
              clearDraft();
            }}
            value={activeGasLimit}
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          Base fee (gwei)
          <input
            inputMode="decimal"
            onChange={(event) => {
              const nextValue = event.target.value;
              setBaseFeeGwei(nextValue);
              setBaseFeeIsManual(nextValue.trim() !== "");
              clearDraft();
            }}
            value={baseFeeGwei}
          />
        </label>
        <label>
          Base fee multiplier
          <input
            inputMode="decimal"
            onChange={(event) => {
              setBaseFeeMultiplier(event.target.value);
              clearDraft();
            }}
            value={baseFeeMultiplier}
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          Priority fee (gwei)
          <input
            inputMode="decimal"
            onChange={(event) => {
              setPriorityFeeGwei(event.target.value);
              clearDraft();
            }}
            value={priorityFeeGwei}
          />
        </label>
        <label>
          Max fee override (gwei)
          <input
            inputMode="decimal"
            onChange={(event) => {
              setMaxFeeOverrideGwei(event.target.value);
              clearDraft();
            }}
            value={maxFeeOverrideGwei}
          />
        </label>
      </div>
      <div className="button-row">
        <button
          disabled={busy || accounts.length === 0 || historyStorageIssue !== null}
          onClick={() => void (transferMode === "native" ? buildDraft() : buildErc20Draft())}
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
      {draft && (
        <section aria-label="Transfer confirmation" className="confirmation-panel">
          <header className="section-header">
            <h3>Confirm Transfer</h3>
            <span className={draft.feeRisk === "high" ? "pill danger-pill" : "pill"}>
              {draft.feeRisk === "high" ? "High fee risk" : "Normal fee"}
            </span>
          </header>
          {draft.feeRisk === "high" && (
            <div className="inline-warning" role="alert">
              Fee or gas settings are far above the live network reference. Review total cost before
              signing.
            </div>
          )}
          <div className="confirmation-grid">
            <ConfirmationRow label="Chain" value={`${chainName} (chainId ${chainId.toString()})`} />
            <ConfirmationRow label="From" value={draft.submission.from} />
            <ConfirmationRow label="To" value={draft.submission.to} />
            <ConfirmationRow
              label="Value"
              value={`${formatEth(draft.submission.valueWei)} native (${draft.submission.valueWei.toString()} wei)`}
            />
            <ConfirmationRow label="Nonce" value={draft.submission.nonce.toString()} />
            <ConfirmationRow label="Gas limit" value={draft.submission.gasLimit.toString()} />
            <ConfirmationRow
              label="Latest base fee reference"
              value={
                draft.submission.latestBaseFeePerGas === null
                  ? "Unavailable"
                  : `${formatGwei(draft.submission.latestBaseFeePerGas)} gwei`
              }
            />
            <ConfirmationRow
              label="Base fee used"
              value={`${formatGwei(draft.submission.baseFeePerGas)} gwei`}
            />
            <ConfirmationRow
              label="Base fee multiplier"
              value={draft.submission.baseFeeMultiplier}
            />
            <ConfirmationRow
              label="Max fee"
              value={`${formatGwei(draft.submission.maxFeePerGas)} gwei`}
            />
            <ConfirmationRow
              label="Priority fee"
              value={`${formatGwei(draft.submission.maxPriorityFeePerGas)} gwei`}
            />
            <ConfirmationRow
              label="Max gas cost"
              value={`${formatEth(maxGasCostWei)} native (${maxGasCostWei.toString()} wei)`}
            />
            <ConfirmationRow
              label="Max total cost"
              value={`${formatEth(maxTotalCostWei)} native (${maxTotalCostWei.toString()} wei)`}
            />
            <ConfirmationRow label="Frozen key" value={draft.frozenKey} />
          </div>
          {draft.requiresSecondConfirmation && (
            <label className="check-row">
              <input
                checked={secondConfirm}
                onChange={(event) => setSecondConfirm(event.target.checked)}
                type="checkbox"
              />
              Confirm high-risk fee settings
            </label>
          )}
          <div className="button-row">
            <button
              disabled={
                busy ||
                historyStorageIssue !== null ||
                (draft.requiresSecondConfirmation && !secondConfirm)
              }
              onClick={() => void submitDraft()}
              title={historyStorageIssue ?? undefined}
              type="button"
            >
              Submit
            </button>
          </div>
        </section>
      )}
      {erc20Draft && (
        <section aria-label="ERC-20 transfer confirmation" className="confirmation-panel">
          <header className="section-header">
            <h3>Confirm ERC-20 Transfer</h3>
            <span className={erc20Draft.feeRisk === "high" ? "pill danger-pill" : "pill"}>
              {erc20Draft.feeRisk === "high" ? "High fee risk" : "Normal fee"}
            </span>
          </header>
          {erc20Draft.feeRisk === "high" && (
            <div className="inline-warning" role="alert">
              Fee or gas settings are far above the live network reference. Review total cost before
              signing.
            </div>
          )}
          <div className="confirmation-grid">
            <ConfirmationRow label="Chain" value={`${chainName} (chainId ${chainId.toString()})`} />
            <ConfirmationRow label="From" value={erc20Draft.submission.from} />
            <ConfirmationRow label="Transaction to" value={erc20Draft.submission.transactionTo} />
            <ConfirmationRow label="Token contract" value={erc20Draft.submission.tokenContract} />
            <ConfirmationRow
              label="Recipient calldata parameter"
              value={erc20Draft.submission.recipient}
            />
            <ConfirmationRow
              label="Amount"
              value={`${erc20Draft.submission.amount} token units (${erc20Draft.submission.amountRaw.toString()} raw)`}
            />
            <ConfirmationRow
              label="Decimals"
              value={`${erc20Draft.submission.decimals.toString()} (${erc20Draft.submission.metadataSource})`}
            />
            <ConfirmationRow
              label="Token metadata"
              value={`${erc20Draft.submission.symbol ?? "unknown"} · ${erc20Draft.submission.name ?? "unknown"}`}
            />
            <ConfirmationRow label="Selector" value={erc20Draft.submission.selector} />
            <ConfirmationRow label="Method" value={erc20Draft.submission.method} />
            <ConfirmationRow
              label="Native value"
              value={`${erc20Draft.submission.nativeValueWei.toString()} wei`}
            />
            <ConfirmationRow label="Nonce" value={erc20Draft.submission.nonce.toString()} />
            <ConfirmationRow label="Gas limit" value={erc20Draft.submission.gasLimit.toString()} />
            <ConfirmationRow
              label="Estimated gas"
              value={erc20Draft.submission.estimatedGasLimit.toString()}
            />
            <ConfirmationRow
              label="Max fee"
              value={`${formatGwei(erc20Draft.submission.maxFeePerGas)} gwei`}
            />
            <ConfirmationRow
              label="Priority fee"
              value={`${formatGwei(erc20Draft.submission.maxPriorityFeePerGas)} gwei`}
            />
            <ConfirmationRow
              label="Max gas cost"
              value={`${formatEth(erc20MaxGasCostWei)} native (${erc20MaxGasCostWei.toString()} wei)`}
            />
            <ConfirmationRow
              label="Token balance"
              value={`${erc20Draft.submission.tokenBalanceRaw.toString()} raw`}
            />
            <ConfirmationRow
              label="Native balance"
              value={`${formatEth(erc20Draft.submission.nativeBalanceWei)} native (${erc20Draft.submission.nativeBalanceWei.toString()} wei)`}
            />
            <ConfirmationRow label="Frozen key" value={erc20Draft.frozenKey} />
          </div>
          {erc20Draft.requiresSecondConfirmation && (
            <label className="check-row">
              <input
                checked={secondConfirm}
                onChange={(event) => setSecondConfirm(event.target.checked)}
                type="checkbox"
              />
              Confirm high-risk fee settings
            </label>
          )}
          <div className="button-row">
            <button
              disabled={
                busy ||
                historyStorageIssue !== null ||
                (erc20Draft.requiresSecondConfirmation && !secondConfirm)
              }
              onClick={() => void submitErc20Draft()}
              title={historyStorageIssue ?? undefined}
              type="button"
            >
              Submit
            </button>
          </div>
        </section>
      )}
      {errorDisplay && <HistoryErrorCard error={errorDisplay} role="alert" />}
    </section>
  );
}

export interface PendingActionProps {
  pendingRequest?: PendingMutationRequest;
  onReplace?: (request: PendingMutationRequest) => void;
  onCancelPending?: (request: PendingMutationRequest) => void;
}

export function PendingActions({
  pendingRequest,
  onReplace,
  onCancelPending,
}: PendingActionProps) {
  if (!pendingRequest) return null;
  return (
    <div>
      <button type="button" onClick={() => onReplace?.(pendingRequest)}>
        Replace Pending
      </button>
      <button type="button" onClick={() => onCancelPending?.(pendingRequest)}>
        Cancel Pending
      </button>
    </div>
  );
}
