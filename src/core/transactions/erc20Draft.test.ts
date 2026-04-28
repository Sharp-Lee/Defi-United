import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildErc20TransferDraft,
  ERC20_TRANSFER_SELECTOR,
  erc20Interface,
  type Erc20ReadProvider,
} from "./erc20Draft";

const from = "0x1111111111111111111111111111111111111111";
const tokenContract = "0x3333333333333333333333333333333333333333";
const recipient = "0x2222222222222222222222222222222222222222";

function encoded(method: "balanceOf" | "decimals" | "name" | "symbol", value: unknown[]) {
  return erc20Interface.encodeFunctionResult(method, value);
}

function request(overrides: Partial<Parameters<typeof buildErc20TransferDraft>[0]> = {}) {
  return {
    provider,
    chainId: 1n,
    from,
    tokenContract,
    recipient,
    amount: "1.5",
    userConfirmedDecimals: null,
    nonce: 7,
    gasLimit: null,
    latestBaseFeePerGas: 20_000_000_000n,
    baseFeePerGas: 20_000_000_000n,
    baseFeeMultiplier: "2",
    maxFeePerGas: 41_500_000_000n,
    maxFeeOverridePerGas: null,
    maxPriorityFeePerGas: 1_500_000_000n,
    liveMaxFeePerGas: 40_000_000_000n,
    liveMaxPriorityFeePerGas: 1_500_000_000n,
    ...overrides,
  };
}

const provider: Erc20ReadProvider = {
  call: vi.fn(),
  estimateGas: vi.fn(),
  getBalance: vi.fn(),
  getNetwork: vi.fn(),
};

describe("buildErc20TransferDraft", () => {
  beforeEach(() => {
    vi.mocked(provider.getNetwork).mockReset().mockResolvedValue({ chainId: 1n });
    vi.mocked(provider.estimateGas).mockReset().mockResolvedValue(65_000n);
    vi.mocked(provider.getBalance).mockReset().mockResolvedValue(10_000_000_000_000_000n);
    vi.mocked(provider.call)
      .mockReset()
      .mockImplementation(async ({ data }) => {
        if (data === erc20Interface.encodeFunctionData("decimals")) {
          return encoded("decimals", [6]);
        }
        if (data === erc20Interface.encodeFunctionData("symbol")) {
          return encoded("symbol", ["USDC"]);
        }
        if (data === erc20Interface.encodeFunctionData("name")) {
          return encoded("name", ["USD Coin"]);
        }
        if (data.startsWith(erc20Interface.getFunction("balanceOf")!.selector)) {
          return encoded("balanceOf", [2_000_000n]);
        }
        throw new Error("unexpected call");
      });
  });

  it("reads metadata, parses raw amount, checks balances, estimates gas, and freezes ERC-20 parameters", async () => {
    const draft = await buildErc20TransferDraft(request());

    expect(draft.submission.transactionTo).toBe(tokenContract);
    expect(draft.submission.recipient).toBe(recipient);
    expect(draft.submission.amountRaw).toBe(1_500_000n);
    expect(draft.submission.decimals).toBe(6);
    expect(draft.submission.metadataSource).toBe("onChainCall");
    expect(draft.submission.symbol).toBe("USDC");
    expect(draft.submission.name).toBe("USD Coin");
    expect(draft.submission.gasLimit).toBe(65_000n);
    expect(draft.submission.nativeValueWei).toBe(0n);
    expect(draft.submission.selector).toBe(ERC20_TRANSFER_SELECTOR);
    expect(draft.frozenKey).toContain(`chainId=1|from=${from}|tokenContract=${tokenContract}`);
    expect(draft.frozenKey).toContain("recipient=0x2222222222222222222222222222222222222222");
    expect(draft.frozenKey).toContain("amountRaw=1500000|decimals=6|metadataSource=onChainCall");
    expect(draft.frozenKey).toContain("selector=0xa9059cbb|method=transfer(address,uint256)|nativeValueWei=0");
    expect(provider.estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({
        from,
        to: tokenContract,
        value: 0n,
      }),
    );
  });

  it("rejects an RPC chainId mismatch before reading token state", async () => {
    vi.mocked(provider.getNetwork).mockResolvedValueOnce({ chainId: 8453n });

    await expect(buildErc20TransferDraft(request())).rejects.toThrow(
      "RPC returned chainId 8453; expected 1.",
    );
    expect(provider.call).not.toHaveBeenCalled();
  });

  it("allows user-confirmed decimals when decimals metadata is missing", async () => {
    vi.mocked(provider.call).mockImplementation(async ({ data }) => {
      if (data === erc20Interface.encodeFunctionData("decimals")) {
        throw new Error("execution reverted");
      }
      if (data.startsWith(erc20Interface.getFunction("balanceOf")!.selector)) {
        return encoded("balanceOf", [2_000_000n]);
      }
      return "0x";
    });

    const draft = await buildErc20TransferDraft(
      request({ amount: "1", userConfirmedDecimals: 6 }),
    );

    expect(draft.submission.metadataSource).toBe("userConfirmed");
    expect(draft.submission.amountRaw).toBe(1_000_000n);
    expect(draft.submission.symbol).toBeNull();
    expect(draft.submission.name).toBeNull();
  });

  it("blocks when decimals metadata is missing and no user-confirmed decimals are provided", async () => {
    vi.mocked(provider.call).mockRejectedValueOnce(new Error("execution reverted"));

    await expect(buildErc20TransferDraft(request())).rejects.toThrow(
      "Token decimals metadata call failed",
    );
  });

  it("blocks when user-confirmed decimals no longer match on-chain decimals", async () => {
    await expect(
      buildErc20TransferDraft(request({ userConfirmedDecimals: 18 })),
    ).rejects.toThrow("Token decimals changed");
  });

  it("blocks insufficient token balance", async () => {
    vi.mocked(provider.call).mockImplementation(async ({ data }) => {
      if (data === erc20Interface.encodeFunctionData("decimals")) {
        return encoded("decimals", [6]);
      }
      if (data.startsWith(erc20Interface.getFunction("balanceOf")!.selector)) {
        return encoded("balanceOf", [1n]);
      }
      return "0x";
    });

    await expect(buildErc20TransferDraft(request())).rejects.toThrow(
      "Token balance insufficient",
    );
  });

  it("surfaces estimate gas failures", async () => {
    vi.mocked(provider.estimateGas).mockRejectedValueOnce(new Error("paused token"));

    await expect(buildErc20TransferDraft(request())).rejects.toThrow(
      "Estimate gas failed for ERC-20 transfer: paused token",
    );
  });

  it("blocks insufficient native gas balance", async () => {
    vi.mocked(provider.getBalance).mockResolvedValueOnce(1n);

    await expect(buildErc20TransferDraft(request())).rejects.toThrow(
      "Native gas balance insufficient",
    );
  });
});
