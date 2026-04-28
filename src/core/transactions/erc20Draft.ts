import { Interface, parseUnits } from "ethers";
import type { FeeRisk } from "./draft";

export type Erc20MetadataSource = "onChainCall" | "cache" | "userConfirmed" | "unknown";

export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";
export const ERC20_TRANSFER_METHOD = "transfer(address,uint256)";

export const erc20Interface = new Interface([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

export interface Erc20ReadProvider {
  call(transaction: { to: string; data: string }): Promise<string>;
  estimateGas(transaction: {
    from: string;
    to: string;
    data: string;
    value: bigint;
  }): Promise<bigint>;
  getBalance(address: string): Promise<bigint>;
  getNetwork(): Promise<{ chainId: bigint }>;
}

export interface Erc20FeeModel {
  latestBaseFeePerGas: bigint | null;
  baseFeePerGas: bigint;
  baseFeeMultiplier: string;
  maxFeePerGas: bigint;
  maxFeeOverridePerGas: bigint | null;
  maxPriorityFeePerGas: bigint;
  liveMaxFeePerGas: bigint;
  liveMaxPriorityFeePerGas: bigint;
}

export interface BuildErc20TransferDraftInput extends Erc20FeeModel {
  provider: Erc20ReadProvider;
  chainId: bigint;
  from: string;
  tokenContract: string;
  recipient: string;
  amount: string;
  userConfirmedDecimals: number | null;
  nonce: number;
  gasLimit: bigint | null;
}

export interface Erc20TransferSubmission extends Erc20FeeModel {
  transactionType: "erc20Transfer";
  chainId: bigint;
  from: string;
  transactionTo: string;
  tokenContract: string;
  recipient: string;
  amount: string;
  amountRaw: bigint;
  tokenBalanceRaw: bigint;
  nativeBalanceWei: bigint;
  decimals: number;
  metadataSource: Erc20MetadataSource;
  symbol: string | null;
  name: string | null;
  nonce: number;
  gasLimit: bigint;
  estimatedGasLimit: bigint;
  selector: typeof ERC20_TRANSFER_SELECTOR;
  method: typeof ERC20_TRANSFER_METHOD;
  nativeValueWei: 0n;
}

export interface Erc20TransferDraft {
  frozenKey: string;
  feeRisk: FeeRisk;
  requiresSecondConfirmation: boolean;
  submission: Erc20TransferSubmission;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function assertDecimals(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("Confirmed decimals must be an integer from 0 to 255.");
  }
}

function decodeOptionalString(value: string, method: "name" | "symbol") {
  try {
    const decoded = erc20Interface.decodeFunctionResult(method, value)[0];
    return typeof decoded === "string" && decoded.trim() ? decoded : null;
  } catch {
    return null;
  }
}

async function readDecimals(provider: Erc20ReadProvider, tokenContract: string) {
  const raw = await provider.call({
    to: tokenContract,
    data: erc20Interface.encodeFunctionData("decimals"),
  });
  const decoded = erc20Interface.decodeFunctionResult("decimals", raw)[0];
  const decimals = Number(decoded);
  assertDecimals(decimals);
  return decimals;
}

async function readOptionalMetadata(
  provider: Erc20ReadProvider,
  tokenContract: string,
  method: "name" | "symbol",
) {
  try {
    const raw = await provider.call({
      to: tokenContract,
      data: erc20Interface.encodeFunctionData(method),
    });
    return decodeOptionalString(raw, method);
  } catch {
    return null;
  }
}

async function readTokenBalance(
  provider: Erc20ReadProvider,
  tokenContract: string,
  owner: string,
) {
  const raw = await provider.call({
    to: tokenContract,
    data: erc20Interface.encodeFunctionData("balanceOf", [owner]),
  });
  const decoded = erc20Interface.decodeFunctionResult("balanceOf", raw)[0];
  return BigInt(decoded);
}

export function createErc20TransferDraft(
  submission: Erc20TransferSubmission,
): Erc20TransferDraft {
  const highFee = submission.maxFeePerGas > submission.liveMaxFeePerGas * 3n;
  const highBaseFee =
    submission.latestBaseFeePerGas !== null &&
    submission.latestBaseFeePerGas > 0n &&
    submission.baseFeePerGas > submission.latestBaseFeePerGas * 3n;
  const highTip =
    submission.liveMaxPriorityFeePerGas > 0n &&
    submission.maxPriorityFeePerGas > submission.liveMaxPriorityFeePerGas * 3n;
  const highGasLimit = submission.gasLimit > submission.estimatedGasLimit * 2n;

  return {
    frozenKey: [
      `chainId=${submission.chainId.toString()}`,
      `from=${submission.from}`,
      `tokenContract=${submission.tokenContract}`,
      `recipient=${submission.recipient}`,
      `amountRaw=${submission.amountRaw.toString()}`,
      `decimals=${submission.decimals.toString()}`,
      `metadataSource=${submission.metadataSource}`,
      `nonce=${submission.nonce.toString()}`,
      `gasLimit=${submission.gasLimit.toString()}`,
      `latestBaseFee=${submission.latestBaseFeePerGas?.toString() ?? "unavailable"}`,
      `baseFee=${submission.baseFeePerGas.toString()}`,
      `baseFeeMultiplier=${submission.baseFeeMultiplier}`,
      `maxFee=${submission.maxFeePerGas.toString()}`,
      `maxFeeOverride=${submission.maxFeeOverridePerGas?.toString() ?? "auto"}`,
      `priorityFee=${submission.maxPriorityFeePerGas.toString()}`,
      `selector=${submission.selector}`,
      `method=${submission.method}`,
      `nativeValueWei=${submission.nativeValueWei.toString()}`,
    ].join("|"),
    feeRisk: highFee || highBaseFee || highTip || highGasLimit ? "high" : "normal",
    requiresSecondConfirmation: highFee || highBaseFee || highTip || highGasLimit,
    submission,
  };
}

export async function buildErc20TransferDraft(
  input: BuildErc20TransferDraftInput,
): Promise<Erc20TransferDraft> {
  const network = await input.provider.getNetwork();
  if (network.chainId !== input.chainId) {
    throw new Error(`RPC returned chainId ${network.chainId}; expected ${input.chainId}.`);
  }

  if (input.userConfirmedDecimals !== null) {
    assertDecimals(input.userConfirmedDecimals);
  }

  let onChainDecimals: number | null = null;
  let metadataSource: Erc20MetadataSource = "unknown";
  try {
    onChainDecimals = await readDecimals(input.provider, input.tokenContract);
    metadataSource = "onChainCall";
  } catch (error) {
    if (input.userConfirmedDecimals === null) {
      throw new Error(
        `Token decimals metadata call failed. Enter confirmed decimals before building this draft. ${errorMessage(error)}`,
      );
    }
  }

  if (
    onChainDecimals !== null &&
    input.userConfirmedDecimals !== null &&
    onChainDecimals !== input.userConfirmedDecimals
  ) {
    throw new Error(
      `Token decimals changed: on-chain decimals ${onChainDecimals} do not match confirmed decimals ${input.userConfirmedDecimals}.`,
    );
  }

  const decimals = input.userConfirmedDecimals ?? onChainDecimals;
  if (decimals === null) {
    throw new Error("Token decimals are missing. Enter confirmed decimals before building this draft.");
  }
  if (input.userConfirmedDecimals !== null) {
    metadataSource = "userConfirmed";
  }

  const amountRaw = parseUnits(input.amount.trim() || "0", decimals);
  if (amountRaw <= 0n) throw new Error("ERC-20 amount must be greater than zero.");

  const [symbol, name, tokenBalanceRaw] = await Promise.all([
    readOptionalMetadata(input.provider, input.tokenContract, "symbol"),
    readOptionalMetadata(input.provider, input.tokenContract, "name"),
    readTokenBalance(input.provider, input.tokenContract, input.from),
  ]);

  if (tokenBalanceRaw < amountRaw) {
    throw new Error(
      `Token balance insufficient: balance ${tokenBalanceRaw.toString()} raw, required ${amountRaw.toString()} raw.`,
    );
  }

  const transferData = erc20Interface.encodeFunctionData("transfer", [
    input.recipient,
    amountRaw,
  ]);
  let estimatedGasLimit: bigint;
  try {
    estimatedGasLimit = await input.provider.estimateGas({
      from: input.from,
      to: input.tokenContract,
      data: transferData,
      value: 0n,
    });
  } catch (error) {
    throw new Error(`Estimate gas failed for ERC-20 transfer: ${errorMessage(error)}`);
  }

  const gasLimit = input.gasLimit ?? estimatedGasLimit;
  const nativeBalanceWei = await input.provider.getBalance(input.from);
  const maxGasCostWei = gasLimit * input.maxFeePerGas;
  if (nativeBalanceWei < maxGasCostWei) {
    throw new Error(
      `Native gas balance insufficient: balance ${nativeBalanceWei.toString()} wei, max gas cost ${maxGasCostWei.toString()} wei.`,
    );
  }

  return createErc20TransferDraft({
    transactionType: "erc20Transfer",
    chainId: input.chainId,
    from: input.from,
    transactionTo: input.tokenContract,
    tokenContract: input.tokenContract,
    recipient: input.recipient,
    amount: input.amount.trim(),
    amountRaw,
    tokenBalanceRaw,
    nativeBalanceWei,
    decimals,
    metadataSource,
    symbol,
    name,
    nonce: input.nonce,
    gasLimit,
    estimatedGasLimit,
    latestBaseFeePerGas: input.latestBaseFeePerGas,
    baseFeePerGas: input.baseFeePerGas,
    baseFeeMultiplier: input.baseFeeMultiplier,
    maxFeePerGas: input.maxFeePerGas,
    maxFeeOverridePerGas: input.maxFeeOverridePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    liveMaxFeePerGas: input.liveMaxFeePerGas,
    liveMaxPriorityFeePerGas: input.liveMaxPriorityFeePerGas,
    selector: ERC20_TRANSFER_SELECTOR,
    method: ERC20_TRANSFER_METHOD,
    nativeValueWei: 0n,
  });
}
