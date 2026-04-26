import { useMemo, useState } from "react";
import { parseEther } from "ethers";
import { useApp } from "../state/store";
import { distribute, planDistribute } from "../wallet/actions";
import type { DistributePlan } from "../wallet/actions";
import { fmtEth } from "../wallet/gas";
import { ConfirmModal } from "./ConfirmModal";

interface Props {
  selected: Set<number>;
  canBroadcast: boolean;
}

export function DistributeForm({ selected, canBroadcast }: Props) {
  const { state, dispatch, getProvider, getRoot, getChildWallet } = useApp();
  const [amountStr, setAmountStr] = useState("0.0001");
  const [plan, setPlan] = useState<DistributePlan | null>(null);
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
      const root = getRoot();
      if (!root) throw new Error("Root 未派生");
      if (selectedChildren.length === 0) throw new Error("未选择子账户");
      const amountWei = parseEther(amountStr);
      const targets = selectedChildren.map((c) => ({ address: c.address, amountWei }));
      const p = await planDistribute(root.address, state.vault!.disperseAddress, targets, provider);
      setPlan(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onExecute() {
    setConfirming(false);
    if (!plan) return;
    const provider = getProvider();
    const root = getRoot();
    if (!provider || !root) return;
    dispatch({ type: "SET_BUSY", busy: "Distribute" });
    try {
      await distribute(root, state.vault!.disperseAddress, plan, provider, (rec) =>
        dispatch({ type: "TX", record: rec }),
      );
      // mark children as funded
      for (const c of selectedChildren) {
        dispatch({ type: "UPDATE_CHILD", index: c.index, patch: { status: "funded" } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_BUSY", busy: null });
      // refresh balances of touched children + root
      try {
        const bal = await provider.getBalance(root.address);
        dispatch({ type: "SET_ROOT_BALANCE", balanceWei: bal });
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
        Root → Disperse 合约 → 选中的 N 个子账户。<strong>单笔交易</strong>，msg.value =
        ∑values，gas 远低于 N 笔独立 transfer。
      </p>
      <div className="row">
        <div>
          <label>每个子账户分发 (ETH)</label>
          <input
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="0.0001"
          />
        </div>
        <div>
          <label>选中子账户</label>
          <input value={`${selectedChildren.length}`} readOnly />
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
            <div>合约</div>
            <div className="mono">{state.vault!.disperseAddress}</div>
            <div>收款数</div>
            <div>{plan.recipients.length}</div>
            <div>总分发</div>
            <div className="mono">{fmtEth(plan.totalValueWei)} ETH</div>
            <div>预估 gas</div>
            <div className="mono">{plan.estGas.toString()} units</div>
            <div>预估 gas 费</div>
            <div className="mono">{fmtEth(plan.feeEstWei)} ETH</div>
            <div>合计成本</div>
            <div className="mono">
              <strong>{fmtEth(plan.totalCostWei)} ETH</strong>
            </div>
          </div>
        </div>
      )}
      {confirming && plan && (
        <ConfirmModal
          title="主网广播确认 · Distribute"
          confirmText="Broadcast"
          warning="即将通过 Disperse 合约一笔交易批量分发 ETH 给所有选中子账户。"
          details={[
            { label: "网络", value: `Ethereum Mainnet (chainId 1)` },
            { label: "调用合约", value: state.vault!.disperseAddress },
            { label: "收款数", value: plan.recipients.length },
            { label: "总分发", value: `${fmtEth(plan.totalValueWei)} ETH` },
            { label: "预估总成本", value: `${fmtEth(plan.totalCostWei)} ETH` },
          ]}
          onConfirm={() => void onExecute()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
