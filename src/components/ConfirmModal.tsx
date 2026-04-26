import { useState } from "react";

interface Props {
  title: string;
  details: { label: string; value: React.ReactNode }[];
  confirmText: string;
  onConfirm: () => void;
  onCancel: () => void;
  warning?: string;
}

export function ConfirmModal({ title, details, confirmText, onConfirm, onCancel, warning }: Props) {
  const [acked, setAcked] = useState(false);
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {warning && <div className="banner warn">{warning}</div>}
        <div className="kvs">
          {details.map((d, i) => (
            <Frag key={i} label={d.label}>
              {d.value}
            </Frag>
          ))}
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} />
          I understand, broadcast on mainnet
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button className="secondary" onClick={onCancel}>
            取消
          </button>
          <button onClick={onConfirm} disabled={!acked}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function Frag({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div>{label}</div>
      <div className="mono" style={{ fontSize: 12 }}>{children}</div>
    </>
  );
}
