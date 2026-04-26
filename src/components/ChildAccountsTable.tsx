import { useEffect, useState } from "react";
import { useApp } from "../state/store";
import { encryptVault } from "../state/crypto";
import { saveVault } from "../state/vault";
import { deriveChildren } from "../wallet/hd";
import { pLimit } from "../wallet/pLimit";
import { fmtEth } from "../wallet/gas";
import type { ChildAccount } from "../types";

interface Props {
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
}

export function ChildAccountsTable({ selected, setSelected }: Props) {
  const { state, dispatch, getProvider } = useApp();
  const v = state.vault!;
  const [addCount, setAddCount] = useState<number>(10);
  const [refreshing, setRefreshing] = useState(false);

  // Derive existing children list from vault.nextChildIndex
  useEffect(() => {
    const list: ChildAccount[] = [];
    const wallets = deriveChildren(v.mnemonic, 1, v.nextChildIndex - 1);
    for (let i = 0; i < wallets.length; i++) {
      const idx = i + 1;
      const existing = state.children.find((c) => c.index === idx);
      list.push(
        existing ?? {
          index: idx,
          address: wallets[i].address,
          balanceWei: null,
          status: "idle",
        },
      );
    }
    if (list.length !== state.children.length) {
      dispatch({ type: "SET_CHILDREN", children: list });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.mnemonic, v.nextChildIndex]);

  async function addMore() {
    if (addCount <= 0) return;
    const next = {
      ...v,
      nextChildIndex: v.nextChildIndex + addCount,
    };
    if (state.password) {
      const enc = await encryptVault(next, state.password);
      saveVault(enc);
    }
    dispatch({ type: "VAULT_UPDATE", vault: next });
  }

  async function refreshBalances() {
    const p = getProvider();
    if (!p) return;
    setRefreshing(true);
    const limit = pLimit<void>(10);
    try {
      await Promise.all(
        state.children.map((c) =>
          limit(async () => {
            try {
              const bal = await p.getBalance(c.address);
              dispatch({ type: "UPDATE_CHILD", index: c.index, patch: { balanceWei: bal } });
            } catch {
              /* keep null */
            }
          }),
        ),
      );
    } finally {
      setRefreshing(false);
    }
  }

  function toggle(idx: number) {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelected(next);
  }
  function selectAll() {
    setSelected(new Set(state.children.map((c) => c.index)));
  }
  function selectNone() {
    setSelected(new Set());
  }

  return (
    <div className="panel">
      <h2>Child 账户 ({state.children.length})</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          type="number"
          min={1}
          max={500}
          value={addCount}
          onChange={(e) => setAddCount(parseInt(e.target.value || "0", 10))}
          style={{ width: 80 }}
        />
        <button onClick={() => void addMore()}>新增 N 个子账户</button>
        <div className="spacer" />
        <button className="secondary" onClick={selectAll}>
          全选
        </button>
        <button className="secondary" onClick={selectNone}>
          反选清空
        </button>
        <button
          className="secondary"
          onClick={() => void refreshBalances()}
          disabled={refreshing || !state.network}
        >
          {refreshing ? "刷新中…" : "刷新余额"}
        </button>
      </div>

      <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
        <table>
          <thead style={{ position: "sticky", top: 0, background: "var(--panel)" }}>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={selected.size === state.children.length && state.children.length > 0}
                  onChange={(e) => (e.target.checked ? selectAll() : selectNone())}
                />
              </th>
              <th style={{ width: 40 }}>#</th>
              <th>地址</th>
              <th style={{ width: 130 }}>余额 (ETH)</th>
              <th style={{ width: 90 }}>状态</th>
            </tr>
          </thead>
          <tbody>
            {state.children.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--muted)", textAlign: "center", padding: 16 }}>
                  无子账户。点上方「新增 N 个子账户」开始。
                </td>
              </tr>
            )}
            {state.children.map((c) => (
              <tr key={c.index}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(c.index)}
                    onChange={() => toggle(c.index)}
                  />
                </td>
                <td className="mono">{c.index}</td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {c.address}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {c.balanceWei === null ? "—" : fmtEth(c.balanceWei, 6)}
                </td>
                <td>
                  <span
                    className={`tag ${
                      c.status === "error"
                        ? "bad"
                        : c.status === "donated" || c.status === "swept"
                          ? "ok"
                          : c.status === "funded"
                            ? "warn"
                            : ""
                    }`}
                  >
                    {c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
