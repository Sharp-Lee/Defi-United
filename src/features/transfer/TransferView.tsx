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
import { nextNonceWithLocalPending } from "../../core/history/reconciler";
import type {
  AccountRecord,
  HistoryRecord,
  NativeTransferIntent,
  PendingMutationRequest,
} from "../../lib/tauri";
import { submitNativeTransfer } from "../../lib/tauri";
import type { AccountChainState } from "../../lib/rpc";

export interface TransferViewProps {
  draft: TransferDraft | null;
  accounts: Array<AccountRecord & AccountChainState>;
  chainId: bigint;
  chainName: string;
  rpcUrl: string;
  history?: HistoryRecord[];
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
  onSubmitted,
}: TransferViewProps) {
  const [selectedIndex, setSelectedIndex] = useState("");
  const [to, setTo] = useState("");
  const [amountEth, setAmountEth] = useState("");
  const [nonce, setNonce] = useState("");
  const [gasLimit, setGasLimit] = useState("21000");
  const [maxFeeGwei, setMaxFeeGwei] = useState("");
  const [priorityFeeGwei, setPriorityFeeGwei] = useState("");
  const [draft, setDraft] = useState<TransferDraft | null>(initialDraft);
  const [secondConfirm, setSecondConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.index.toString() === selectedIndex) ?? null,
    [accounts, selectedIndex],
  );
  const maxGasCostWei = draft
    ? draft.submission.gasLimit * draft.submission.maxFeePerGas
    : 0n;
  const maxTotalCostWei = draft ? draft.submission.valueWei + maxGasCostWei : 0n;

  function clearDraft() {
    setDraft(null);
    setSecondConfirm(false);
  }

  useEffect(() => {
    if (!selectedIndex && accounts.length > 0) {
      setSelectedIndex(accounts[0].index.toString());
    }
  }, [accounts, selectedIndex]);

  useEffect(() => {
    clearDraft();
  }, [selectedIndex, chainId, rpcUrl]);

  async function buildDraft() {
    setError(null);
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
      const nextGasLimit = gasLimit.trim() ? BigInt(gasLimit) : estimatedGasLimit;
      const nextMaxFee = maxFeeGwei.trim() ? toWeiFromGwei(maxFeeGwei) : liveMaxFeePerGas;
      const nextPriorityFee = priorityFeeGwei.trim()
        ? toWeiFromGwei(priorityFeeGwei)
        : livePriorityFee;

      setNonce(nextNonce.toString());
      setGasLimit(nextGasLimit.toString());
      setMaxFeeGwei(formatGwei(nextMaxFee));
      setPriorityFeeGwei(formatGwei(nextPriorityFee));
      setDraft(
        createTransferDraft({
          chainId,
          from: selectedAccount.address,
          to,
          valueWei,
          nonce: nextNonce,
          gasLimit: nextGasLimit,
          maxFeePerGas: nextMaxFee,
          maxPriorityFeePerGas: nextPriorityFee,
          liveMaxFeePerGas,
          liveMaxPriorityFeePerGas: livePriorityFee,
          estimatedGasLimit,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitDraft() {
    setError(null);
    if (!draft || !selectedAccount) return;
    if (draft.requiresSecondConfirmation && !secondConfirm) {
      setError("High-risk fee settings need the extra confirmation.");
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
      setError(err instanceof Error ? err.message : String(err));
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
              setGasLimit(event.target.value);
              clearDraft();
            }}
            value={gasLimit}
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          Max fee (gwei)
          <input
            inputMode="decimal"
            onChange={(event) => {
              setMaxFeeGwei(event.target.value);
              clearDraft();
            }}
            value={maxFeeGwei}
          />
        </label>
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
      </div>
      <div className="button-row">
        <button disabled={busy || accounts.length === 0} onClick={() => void buildDraft()} type="button">
          Build Draft
        </button>
      </div>
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
              Gas settings are far above the live network reference. Review total cost before signing.
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
              disabled={busy || (draft.requiresSecondConfirmation && !secondConfirm)}
              onClick={() => void submitDraft()}
              type="button"
            >
              Submit
            </button>
          </div>
        </section>
      )}
      {error && <div className="inline-error">{error}</div>}
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
