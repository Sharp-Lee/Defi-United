import { useMemo, useState } from "react";
import { useApp } from "../state/store";
import { sweep } from "../wallet/actions";
import { ConfirmModal } from "./ConfirmModal";

interface Props {
  selected: Set<number>;
  canBroadcast: boolean;
}

export function SweepForm({ selected, canBroadcast }: Props) {
  const { state, dispatch, getProvider, getRoot, getChildWallet } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const selectedChildren = useMemo(
    () => state.children.filter((c) => selected.has(c.index)),
    [state.children, selected],
  );

  async function onExecute() {
    setConfirming(false);
    setError(null);
    const provider = getProvider();
    const root = getRoot();
    if (!provider || !root) return;
    const wallets = selectedChildren
      .map((c) => getChildWallet(c.index))
      .filter((w): w is NonNullable<typeof w> => w !== null);
    dispatch({ type: "SET_BUSY", busy: "Sweep" });
    try {
      await sweep(wallets, root.address, provider, (rec) =>
        dispatch({ type: "TX", record: rec }),
      );
      for (const c of selectedChildren) {
        dispatch({ type: "UPDATE_CHILD", index: c.index, patch: { status: "swept" } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_BUSY", busy: null });
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
        将选中子账户的余额（扣除 21000 × maxFeePerGas 后）全部转回 Root。余额不足以付 gas 的账户会被自动跳过。
      </p>
      <div className="row">
        <div>
          <label>选中子账户</label>
          <input value={`${selectedChildren.length}`} readOnly />
        </div>
        <div>
          <label>Root（目标）</label>
          <input value={state.rootAddress ?? ""} readOnly className="mono" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          className="warn"
          onClick={() => setConfirming(true)}
          disabled={selectedChildren.length === 0 || !canBroadcast || state.busy !== null}
        >
          Sweep to Root
        </button>
      </div>
      {error && (
        <div className="banner bad" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      {confirming && (
        <ConfirmModal
          title="主网广播确认 · Sweep"
          confirmText="Broadcast"
          warning={`将由 ${selectedChildren.length} 个子账户各发一笔转回 Root。`}
          details={[
            { label: "网络", value: `Ethereum Mainnet (chainId 1)` },
            { label: "Root", value: state.rootAddress },
            { label: "笔数", value: selectedChildren.length },
          ]}
          onConfirm={() => void onExecute()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
