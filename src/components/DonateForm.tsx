import { useMemo, useState } from "react";
import { parseEther } from "ethers";
import { useApp } from "../state/store";
import { donate, planDonate } from "../wallet/actions";
import type { DonatePlan } from "../wallet/actions";
import { fmtEth } from "../wallet/gas";
import { ConfirmModal } from "./ConfirmModal";

interface Props {
  selected: Set<number>;
  canBroadcast: boolean;
}

export function DonateForm({ selected, canBroadcast }: Props) {
  const { state, dispatch, getProvider, getChildWallet } = useApp();
  const [amountStr, setAmountStr] = useState("0.00001");
  const [plan, setPlan] = useState<DonatePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const selectedChildren = useMemo(
    () => state.children.filter((c) => selected.has(c.index)),
    [state.children, selected],
  );

  async function onSimulate() {
    setError(null);
    setPlan(null);
    try {
      const provider = getProvider();
      if (!provider) throw new Error("Provider 未就绪");
      if (selectedChildren.length === 0) throw new Error("未选择子账户");
      const amountWei = parseEther(amountStr);
      const p = await planDonate(selectedChildren.length, amountWei, provider);
      setPlan(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onExecute() {
    setConfirming(false);
    if (!plan) return;
    const provider = getProvider();
    if (!provider) return;
    const wallets = selectedChildren
      .map((c) => getChildWallet(c.index))
      .filter((w): w is NonNullable<typeof w> => w !== null);
    dispatch({ type: "SET_BUSY", busy: "Donate" });
    try {
      await donate(
        wallets,
        state.vault!.donationTarget,
        plan.perChildValueWei,
        provider,
        (rec) => dispatch({ type: "TX", record: rec }),
      );
      for (const c of selectedChildren) {
        dispatch({ type: "UPDATE_CHILD", index: c.index, patch: { status: "donated" } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_BUSY", busy: null });
      // refresh balances
      try {
        for (const c of selectedChildren) {
          const w = getChildWallet(c.index);
          if (!w) continue;
          const b = await provider.getBalance(w.address);
          dispatch({ type: "UPDATE_CHILD", index: c.index, patch: { balanceWei: b } });
        }
      } catch {
        /* noop */
      }
    }
  }

  return (
    <div>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 0 }}>
        每个选中子账户向<strong>目标地址</strong>独立发起一笔捐款。完全并发（限流 8）。
      </p>
      <div className="row">
        <div>
          <label>每个子账户捐款 (ETH)</label>
          <input value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
        </div>
        <div>
          <label>目标地址</label>
          <input value={state.vault!.donationTarget} readOnly className="mono" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="secondary" onClick={() => void onSimulate()} disabled={!state.network}>
          Simulate
        </button>
        <button
          onClick={() => setConfirming(true)}
          disabled={!plan || !canBroadcast || state.busy !== null}
        >
          Execute
        </button>
      </div>
      {error && (
        <div className="banner bad" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      {plan && (
        <div className="banner info" style={{ marginTop: 12 }}>
          <div className="kvs">
            <div>子账户数</div>
            <div>{plan.count}</div>
            <div>每个金额</div>
            <div className="mono">{fmtEth(plan.perChildValueWei)} ETH</div>
            <div>每笔预估 gas</div>
            <div className="mono">{fmtEth(plan.perChildFeeWei)} ETH</div>
            <div>总捐款</div>
            <div className="mono">{fmtEth(plan.totalValueWei)} ETH</div>
            <div>总 gas</div>
            <div className="mono">{fmtEth(plan.totalFeeWei)} ETH</div>
          </div>
        </div>
      )}
      {confirming && plan && (
        <ConfirmModal
          title="主网广播确认 · Donate"
          confirmText="Broadcast"
          warning={`即将由 ${plan.count} 个子账户各发起一笔向目标地址的转账。`}
          details={[
            { label: "网络", value: `Ethereum Mainnet (chainId 1)` },
            { label: "目标地址", value: state.vault!.donationTarget },
            { label: "笔数", value: plan.count },
            { label: "每笔金额", value: `${fmtEth(plan.perChildValueWei)} ETH` },
            { label: "总额", value: `${fmtEth(plan.totalValueWei)} ETH` },
            { label: "总 gas", value: `${fmtEth(plan.totalFeeWei)} ETH` },
          ]}
          onConfirm={() => void onExecute()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
