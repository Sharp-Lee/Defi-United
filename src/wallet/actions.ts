import { Contract, HDNodeWallet, JsonRpcProvider, isAddress } from "ethers";
import type { TxRecord } from "../types";
import { PLAIN_TRANSFER_GAS, estimateDistributeGas, getFees } from "./gas";
import { pLimit } from "./pLimit";

export const DISPERSE_ABI = [
  "function disperseEther(address[] recipients, uint256[] values) external payable",
];
export const DISPERSE_SELECTOR = "0xe63d38ed";

let txSeq = 0;
const nextTxId = (): string => `tx-${Date.now()}-${++txSeq}`;

export type OnTx = (rec: TxRecord) => void;

export interface DistributePlan {
  totalValueWei: bigint;
  estGas: bigint;
  feeEstWei: bigint;
  totalCostWei: bigint;
  recipients: string[];
  values: bigint[];
}

export async function planDistribute(
  rootAddress: string,
  disperseAddr: string,
  targets: { address: string; amountWei: bigint }[],
  provider: JsonRpcProvider,
): Promise<DistributePlan> {
  if (!isAddress(disperseAddr)) throw new Error("Disperse 合约地址无效");
  for (const t of targets) {
    if (!isAddress(t.address)) throw new Error(`无效收款地址 ${t.address}`);
    if (t.amountWei <= 0n) throw new Error("分发金额必须大于 0");
  }
  const recipients = targets.map((t) => t.address);
  const values = targets.map((t) => t.amountWei);
  const totalValueWei = values.reduce((a, b) => a + b, 0n);

  const fees = await getFees(provider);
  let estGas = estimateDistributeGas(targets.length);
  try {
    const c = new Contract(disperseAddr, DISPERSE_ABI, provider);
    const fn = c.getFunction("disperseEther");
    const live = await fn.estimateGas(recipients, values, {
      value: totalValueWei,
      from: rootAddress,
    });
    estGas = (live * 12n) / 10n; // +20% buffer
  } catch {
    // Fall back to heuristic when estimateGas fails (e.g. balance too low).
  }
  const feeEstWei = estGas * fees.maxFeePerGas;
  const totalCostWei = totalValueWei + feeEstWei;
  return { totalValueWei, estGas, feeEstWei, totalCostWei, recipients, values };
}

export async function distribute(
  root: HDNodeWallet,
  disperseAddr: string,
  plan: DistributePlan,
  provider: JsonRpcProvider,
  onTx: OnTx,
): Promise<void> {
  const fees = await getFees(provider);
  const signer = root.connect(provider);
  const contract = new Contract(disperseAddr, DISPERSE_ABI, signer);
  const id = nextTxId();
  const rec: TxRecord = {
    id,
    kind: "distribute",
    from: root.address,
    to: disperseAddr,
    valueWei: plan.totalValueWei,
    status: "pending",
    createdAt: Date.now(),
  };
  onTx(rec);
  try {
    const tx = await contract.disperseEther(plan.recipients, plan.values, {
      value: plan.totalValueWei,
      gasLimit: plan.estGas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    onTx({ ...rec, hash: tx.hash });
    const receipt = await tx.wait();
    onTx({ ...rec, hash: tx.hash, status: receipt && receipt.status === 1 ? "mined" : "failed" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    onTx({ ...rec, status: "failed", error: msg });
    throw e;
  }
}

export interface DonatePlan {
  perChildValueWei: bigint;
  perChildFeeWei: bigint;
  perChildTotalWei: bigint;
  totalValueWei: bigint;
  totalFeeWei: bigint;
  count: number;
}

export async function planDonate(
  count: number,
  amountWei: bigint,
  provider: JsonRpcProvider,
): Promise<DonatePlan> {
  if (amountWei <= 0n) throw new Error("捐款金额必须大于 0");
  if (count <= 0) throw new Error("未选择子账户");
  const fees = await getFees(provider);
  const perChildFeeWei = PLAIN_TRANSFER_GAS * fees.maxFeePerGas;
  const perChildTotalWei = amountWei + perChildFeeWei;
  return {
    perChildValueWei: amountWei,
    perChildFeeWei,
    perChildTotalWei,
    totalValueWei: amountWei * BigInt(count),
    totalFeeWei: perChildFeeWei * BigInt(count),
    count,
  };
}

export async function donate(
  children: HDNodeWallet[],
  target: string,
  amountWei: bigint,
  provider: JsonRpcProvider,
  onTx: OnTx,
  concurrency = 8,
): Promise<void> {
  if (!isAddress(target)) throw new Error("目标地址无效");
  const fees = await getFees(provider);
  const limit = pLimit<void>(concurrency);
  await Promise.all(
    children.map((child) =>
      limit(async () => {
        const id = nextTxId();
        const rec: TxRecord = {
          id,
          kind: "donate",
          from: child.address,
          to: target,
          valueWei: amountWei,
          status: "pending",
          createdAt: Date.now(),
        };
        onTx(rec);
        try {
          const signer = child.connect(provider);
          const tx = await signer.sendTransaction({
            to: target,
            value: amountWei,
            gasLimit: PLAIN_TRANSFER_GAS,
            maxFeePerGas: fees.maxFeePerGas,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          });
          onTx({ ...rec, hash: tx.hash });
          const receipt = await tx.wait();
          onTx({
            ...rec,
            hash: tx.hash,
            status: receipt && receipt.status === 1 ? "mined" : "failed",
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          onTx({ ...rec, status: "failed", error: msg });
        }
      }),
    ),
  );
}

export async function sweep(
  children: HDNodeWallet[],
  rootAddr: string,
  provider: JsonRpcProvider,
  onTx: OnTx,
  concurrency = 8,
): Promise<void> {
  if (!isAddress(rootAddr)) throw new Error("Root 地址无效");
  const fees = await getFees(provider);
  const gasCost = PLAIN_TRANSFER_GAS * fees.maxFeePerGas;
  const limit = pLimit<void>(concurrency);
  await Promise.all(
    children.map((child) =>
      limit(async () => {
        const balance = await provider.getBalance(child.address);
        if (balance <= gasCost) return; // not worth sweeping
        const value = balance - gasCost;
        const id = nextTxId();
        const rec: TxRecord = {
          id,
          kind: "sweep",
          from: child.address,
          to: rootAddr,
          valueWei: value,
          status: "pending",
          createdAt: Date.now(),
        };
        onTx(rec);
        try {
          const signer = child.connect(provider);
          const tx = await signer.sendTransaction({
            to: rootAddr,
            value,
            gasLimit: PLAIN_TRANSFER_GAS,
            maxFeePerGas: fees.maxFeePerGas,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
          });
          onTx({ ...rec, hash: tx.hash });
          const receipt = await tx.wait();
          onTx({
            ...rec,
            hash: tx.hash,
            status: receipt && receipt.status === 1 ? "mined" : "failed",
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          onTx({ ...rec, status: "failed", error: msg });
        }
      }),
    ),
  );
}

export async function checkDisperseContract(
  provider: JsonRpcProvider,
  address: string,
): Promise<{ exists: boolean; selectorMatches: boolean }> {
  if (!isAddress(address)) return { exists: false, selectorMatches: false };
  const code = await provider.getCode(address);
  return {
    exists: code !== "0x" && code.length > 2,
    selectorMatches: code.includes(DISPERSE_SELECTOR.slice(2)),
  };
}
