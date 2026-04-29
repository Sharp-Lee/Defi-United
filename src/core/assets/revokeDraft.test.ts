import { describe, expect, it } from "vitest";
import type { AllowanceSnapshotRecord, NftApprovalSnapshotRecord } from "../../lib/tauri";
import {
  ERC20_APPROVE_SELECTOR,
  ERC721_APPROVE_SELECTOR,
  SET_APPROVAL_FOR_ALL_SELECTOR,
  ZERO_ADDRESS,
  buildRevokeDraft,
  getRevokeDraftEligibility,
  type BuildRevokeDraftInput,
  type RevokeDraftWarningCode,
} from "./revokeDraft";

const owner = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const token = "0x1111111111111111111111111111111111111111";
const spender = "0x2222222222222222222222222222222222222222";
const operator = "0x3333333333333333333333333333333333333333";
const createdAt = "2026-04-29T00:00:00.000Z";

function allowance(overrides: Partial<AllowanceSnapshotRecord> = {}): AllowanceSnapshotRecord {
  return {
    chainId: 1,
    owner,
    tokenContract: token,
    spender,
    allowanceRaw: "100",
    status: "active",
    source: { kind: "rpcPointRead" },
    lastScannedAt: "100",
    staleAfter: "200",
    createdAt: "90",
    updatedAt: "100",
    ...overrides,
  };
}

function nft(overrides: Partial<NftApprovalSnapshotRecord> = {}): NftApprovalSnapshotRecord {
  return {
    chainId: 1,
    owner,
    tokenContract: token,
    kind: "erc721ApprovalForAll",
    operator,
    approved: true,
    status: "active",
    source: { kind: "rpcPointRead" },
    lastScannedAt: "100",
    staleAfter: "200",
    createdAt: "90",
    updatedAt: "100",
    ...overrides,
  };
}

function input(overrides: Partial<BuildRevokeDraftInput> = {}): BuildRevokeDraftInput {
  return {
    chainId: 1,
    selectedRpc: {
      chainId: 1,
      providerConfigId: "mainnet",
      endpointId: "primary",
      endpointName: "Primary",
      endpointSummary: "https://rpc.example.invalid/mainnet?api_key=secret",
      endpointFingerprint: "rpc-fp-1",
    },
    snapshot: allowance(),
    localAccounts: [{ address: owner, index: 1 }],
    fee: {
      nonce: 7,
      gasLimit: 50_000n,
      latestBaseFeePerGas: 10n,
      baseFeePerGas: 10n,
      maxFeePerGas: 12n,
      maxPriorityFeePerGas: 2n,
    },
    warningAcknowledgements: {
      externalCounterparty: true,
      manualFeeGas: true,
    },
    now: 150_000,
    createdAt,
    ...overrides,
  };
}

describe("buildRevokeDraft", () => {
  it("builds ERC-20 approve(spender, 0) calldata and freezes contract-vs-spender identity", () => {
    const draft = buildRevokeDraft(input());

    expect(draft.ready).toBe(true);
    expect(draft.method).toBe("approve(address,uint256)");
    expect(draft.selector).toBe(ERC20_APPROVE_SELECTOR);
    expect(draft.transactionTo).toBe(token.toLowerCase());
    expect(draft.calldata).toMatch(/^0x095ea7b3/);
    expect(draft.calldataArgs).toEqual([
      { name: "spender", type: "address", value: spender.toLowerCase() },
      { name: "amount", type: "uint256", value: "0" },
    ]);
    expect(draft.intent).toMatchObject({
      to: token.toLowerCase(),
      from: owner.toLowerCase(),
      valueWei: "0",
      nonce: 7,
      gasLimit: "50000",
    });
    expect(draft.approvalIdentity).toMatchObject({
      kind: "erc20Allowance",
      contract: token.toLowerCase(),
      spender: spender.toLowerCase(),
      status: "active",
      sourceKind: "rpcPointRead",
    });
    expect(JSON.stringify(draft.frozenPayload)).toContain('"tokenApprovalContract"');
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret");
  });

  it("builds NFT operator setApprovalForAll(operator, false) calldata", () => {
    const draft = buildRevokeDraft(
      input({
        snapshot: nft(),
        warningAcknowledgements: {
          externalCounterparty: true,
          manualFeeGas: true,
        },
      }),
    );

    expect(draft.ready).toBe(true);
    expect(draft.method).toBe("setApprovalForAll(address,bool)");
    expect(draft.selector).toBe(SET_APPROVAL_FOR_ALL_SELECTOR);
    expect(draft.transactionTo).toBe(token.toLowerCase());
    expect(draft.calldata).toMatch(/^0xa22cb465/);
    expect(draft.calldataArgs).toEqual([
      { name: "operator", type: "address", value: operator.toLowerCase() },
      { name: "approved", type: "bool", value: false },
    ]);
  });

  it("builds ERC-721 token-specific approve(address(0), tokenId) calldata", () => {
    const draft = buildRevokeDraft(
      input({
        snapshot: nft({
          kind: "erc721TokenApproval",
          tokenId: "042",
        }),
        warningAcknowledgements: {
          externalCounterparty: true,
          manualFeeGas: true,
        },
      }),
    );

    expect(draft.ready).toBe(true);
    expect(draft.method).toBe("approve(address,uint256)");
    expect(draft.selector).toBe(ERC721_APPROVE_SELECTOR);
    expect(draft.transactionTo).toBe(token.toLowerCase());
    expect(draft.calldata).toMatch(/^0x095ea7b3/);
    expect(draft.calldataArgs).toEqual([
      { name: "approved", type: "address", value: ZERO_ADDRESS },
      { name: "tokenId", type: "uint256", value: "42" },
    ]);
    expect(draft.approvalIdentity?.operator).toBe(operator.toLowerCase());
    expect(draft.approvalIdentity?.tokenId).toBe("42");
  });

  it("blocks stale, unknown, failed, zero, revoked, and missing tokenId snapshots", () => {
    const blocked = [
      { snapshot: allowance({ status: "active", allowanceRaw: "100" }), stale: true },
      { snapshot: allowance({ status: "unknown" }) },
      { snapshot: allowance({ status: "readFailed" }) },
      { snapshot: allowance({ status: "zero", allowanceRaw: "0" }) },
      { snapshot: nft({ status: "revoked", approved: false }) },
      { snapshot: nft({ kind: "erc721TokenApproval", tokenId: null }) },
    ];

    for (const item of blocked) {
      const draft = buildRevokeDraft(
        input({
          snapshot: item.snapshot,
          snapshotStale: item.stale,
          warningAcknowledgements: {
            externalCounterparty: true,
            manualFeeGas: true,
            staleOrFailedSnapshot: true,
          },
        }),
      );
      expect(draft.ready).toBe(false);
      expect(draft.blockingStatuses.length).toBeGreaterThan(0);
      expect(getRevokeDraftEligibility(item.snapshot, item.stale).eligible).toBe(false);
    }
  });

  it("blocks token-specific invalid tokenIds without throwing", () => {
    const overflow = (1n << 256n).toString();
    const invalidTokenIds = ["-1", "0x2a", overflow];

    for (const tokenId of invalidTokenIds) {
      const snapshot = nft({
        kind: "erc721TokenApproval",
        tokenId,
      });
      const draft = buildRevokeDraft(
        input({
          snapshot,
          warningAcknowledgements: {
            externalCounterparty: true,
            manualFeeGas: true,
          },
        }),
      );

      expect(getRevokeDraftEligibility(snapshot).eligible).toBe(false);
      expect(draft.ready).toBe(false);
      expect(draft.intent).toBeNull();
      expect(draft.calldata).toBeNull();
      expect(draft.blockingStatuses).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "invalidTokenId" })]),
      );
    }
  });

  it("blocks missing or unfrozen RPC identity instead of fabricating a ready draft", () => {
    const missingRpc = buildRevokeDraft(input({ selectedRpc: null }));
    const missingChainId = buildRevokeDraft(
      input({
        selectedRpc: {
          endpointSummary: "https://rpc.example.invalid",
          endpointFingerprint: "rpc-fp-1",
        },
      }),
    );
    const missingEndpointSummary = buildRevokeDraft(
      input({
        selectedRpc: {
          chainId: 1,
          endpointFingerprint: "rpc-fp-1",
        },
      }),
    );
    const missingEndpointFingerprint = buildRevokeDraft(
      input({
        selectedRpc: {
          chainId: 1,
          endpointSummary: "https://rpc.example.invalid",
        },
      }),
    );

    expect(missingRpc.ready).toBe(false);
    expect(missingRpc.intent).toBeNull();
    expect(missingRpc.blockingStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missingRpc" })]),
    );
    expect(missingChainId.ready).toBe(false);
    expect(missingChainId.intent).toBeNull();
    expect(missingChainId.blockingStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missingRpcChainId" })]),
    );
    expect(missingEndpointSummary.ready).toBe(false);
    expect(missingEndpointSummary.blockingStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missingRpcEndpointSummary" })]),
    );
    expect(missingEndpointFingerprint.ready).toBe(false);
    expect(missingEndpointFingerprint.blockingStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missingRpcEndpointFingerprint" })]),
    );
  });

  it("sanitizes RPC path secrets from selected RPC and snapshot refs", () => {
    const draft = buildRevokeDraft(
      input({
        selectedRpc: {
          chainId: 1,
          endpointSummary: "wss://rpc.example.invalid/v3/secret-token?apikey=secret",
          endpointFingerprint: "rpc-fp-1",
        },
        snapshot: allowance({
          rpcIdentity: "wss://rpc.example.invalid/v3/secret-token?apikey=secret",
        }),
      }),
    );
    const frozen = JSON.stringify(draft.frozenPayload);

    expect(draft.selectedRpc.endpointSummary).toBe("wss://rpc.example.invalid/<redacted_path>?apikey=[redacted]");
    expect(draft.approvalIdentity?.ref.rpcIdentity).toBe("wss://rpc.example.invalid/<redacted_path>?apikey=[redacted]");
    expect(frozen).not.toContain("secret-token");
    expect(frozen).not.toContain("/v3/");
    expect(frozen).not.toContain("apikey=secret");
  });

  it("sanitizes non-url selected RPC summaries with token-like secrets", () => {
    const draft = buildRevokeDraft(
      input({
        selectedRpc: {
          chainId: 1,
          endpointSummary: "configured rpc token=secret-token key=secret-key Authorization=secret-auth authorization: secret-colon Basic abcdef Bearer secret-bearer",
          endpointFingerprint: "rpc-fp-1",
        },
      }),
    );
    const frozen = JSON.stringify(draft.frozenPayload);

    expect(draft.selectedRpc.endpointSummary).toBe(
      "configured rpc token=[redacted] key=[redacted] Authorization=[redacted] Authorization: [redacted] Basic [redacted] Bearer [redacted]",
    );
    expect(frozen).not.toContain("secret-token");
    expect(frozen).not.toContain("secret-key");
    expect(frozen).not.toContain("secret-auth");
    expect(frozen).not.toContain("secret-colon");
    expect(frozen).not.toContain("abcdef");
    expect(frozen).not.toContain("secret-bearer");
  });

  it("blocks snapshots when staleAfter has expired at builder level", () => {
    const snapshot = allowance({
      status: "active",
      allowanceRaw: "100",
      staleAfter: "100",
    });

    const fresh = buildRevokeDraft(
      input({
        snapshot,
        now: 99_000,
        warningAcknowledgements: {
          externalCounterparty: true,
          manualFeeGas: true,
        },
      }),
    );
    const expired = buildRevokeDraft(
      input({
        snapshot,
        now: 100_000,
        warningAcknowledgements: {
          externalCounterparty: true,
          manualFeeGas: true,
          staleOrFailedSnapshot: true,
        },
      }),
    );

    expect(getRevokeDraftEligibility(snapshot, false, false, 100_000).eligible).toBe(false);
    expect(fresh.ready).toBe(true);
    expect(expired.ready).toBe(false);
    expect(expired.approvalIdentity?.stale).toBe(true);
    expect(expired.blockingStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "staleOrFailedSnapshot" })]),
    );
  });

  it("blocks negative optional base fee references", () => {
    const negativeLatest = buildRevokeDraft(
      input({
        fee: {
          ...input().fee,
          latestBaseFeePerGas: -1n,
        },
      }),
    );
    const negativeBase = buildRevokeDraft(
      input({
        fee: {
          ...input().fee,
          baseFeePerGas: -1n,
        },
      }),
    );

    expect(negativeLatest.ready).toBe(false);
    expect(negativeLatest.intent).toBeNull();
    expect(negativeLatest.blockingStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "latestBaseFee" })]),
    );
    expect(negativeBase.ready).toBe(false);
    expect(negativeBase.intent).toBeNull();
    expect(negativeBase.blockingStatuses).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "baseFee" })]),
    );
  });

  it("freezes complete sanitized source refs and changes frozen key when source identity changes", () => {
    const sourceful = allowance({
      source: {
        kind: "explorerCandidate",
        label: "Explorer token: secret-token",
        sourceId: "etherscan api_key: secret-key",
        summary: "https://explorer.example/path?apikey=secret",
        providerHint:
          "Bearer secret-token password: secret-pass authToken: secret-auth privateKey=0xabc mnemonic: word word signature: sig-secret rawTx: raw-secret",
        observedAt: "2026-04-29T00:00:00.000Z",
      },
    });
    const draft = buildRevokeDraft(
      input({
        snapshot: sourceful,
        warningAcknowledgements: {
          nonRpcConfirmedSource: true,
          externalCounterparty: true,
          manualFeeGas: true,
        },
      }),
    );

    expect(draft.approvalIdentity?.source).toMatchObject({
      kind: "explorerCandidate",
      label: "Explorer token: [redacted]",
      sourceId: "etherscan api_key: [redacted]",
      providerHint:
        "Bearer [redacted] password: [redacted] authToken: [redacted] privateKey=[redacted] mnemonic: [redacted] signature: [redacted] rawTx: [redacted]",
      observedAt: "2026-04-29T00:00:00.000Z",
    });
    expect(JSON.stringify(draft.frozenPayload)).toContain("sourceId");
    expect(JSON.stringify(draft.frozenPayload)).toContain("providerHint");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret-token");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret-key");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret-pass");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret-auth");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("0xabc");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("word word");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("sig-secret");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("raw-secret");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("apikey=secret");

    const changedSource = buildRevokeDraft(
      input({
        snapshot: allowance({
          source: {
            ...sourceful.source,
            sourceId: "different-source",
          },
        }),
        warningAcknowledgements: {
          nonRpcConfirmedSource: true,
          externalCounterparty: true,
          manualFeeGas: true,
        },
      }),
    );

    expect(changedSource.frozenKey).not.toBe(draft.frozenKey);
  });

  it("sanitizes snapshot rpc refs in frozen approval identity", () => {
    const draft = buildRevokeDraft(
      input({
        snapshot: allowance({
          rpcIdentity: "https://rpc.example.invalid/path/secret-token?apikey=secret api_key: secret-key",
          rpcProfileId:
            "profile token: secret-token password: secret-pass signedTx: signed-secret passphrase: pass-secret pass_phrase=secret-one pass-phrase: secret-two pass phrase secret three",
        }),
      }),
    );

    expect(draft.approvalIdentity?.ref.rpcIdentity).toBe("https://rpc.example.invalid/<redacted_path>?apikey=[redacted] api_key: [redacted]");
    expect(draft.approvalIdentity?.ref.rpcProfileId).toBe(
      "profile token: [redacted] password: [redacted] signedTx: [redacted] passphrase: [redacted] pass_phrase=[redacted] pass-phrase: [redacted] pass phrase [redacted]",
    );
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret-token");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret-key");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret-pass");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("signed-secret");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("pass-secret");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret-one");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret-two");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("secret three");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("/path/");
    expect(JSON.stringify(draft.frozenPayload)).not.toContain("apikey=secret");
  });

  it("marks invalid approval identities in eligibility before build", () => {
    expect(
      getRevokeDraftEligibility(
        allowance({
          owner: "not-an-address",
        }),
      ),
    ).toEqual({ eligible: false, reason: "Not eligible: invalid approval identity" });
    expect(
      getRevokeDraftEligibility(
        allowance({
          spender: "not-an-address",
        }),
      ),
    ).toEqual({ eligible: false, reason: "Not eligible: invalid approval identity" });
    expect(
      getRevokeDraftEligibility(
        nft({
          operator: "not-an-address",
        }),
      ),
    ).toEqual({ eligible: false, reason: "Not eligible: invalid approval identity" });
  });

  it("requires acknowledgement warnings before ready", () => {
    const unlimited = allowance({
      allowanceRaw: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      source: { kind: "indexerCandidate" },
    });
    const draft = buildRevokeDraft(input({ snapshot: unlimited, warningAcknowledgements: {} }));

    expect(draft.ready).toBe(false);
    expect(draft.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining<RevokeDraftWarningCode>([
        "unlimitedErc20Allowance",
        "nonRpcConfirmedSource",
        "externalCounterparty",
        "manualFeeGas",
      ]),
    );

    const acknowledged = buildRevokeDraft(
      input({
        snapshot: unlimited,
        warningAcknowledgements: {
          unlimitedErc20Allowance: true,
          nonRpcConfirmedSource: true,
          externalCounterparty: true,
          manualFeeGas: true,
        },
      }),
    );

    expect(acknowledged.ready).toBe(true);
  });

  it("changes frozen key for snapshot identity, fee, nonce, rpc, calldata method, and acknowledgements", () => {
    const frozenKey = buildRevokeDraft(input()).frozenKey;
    const changes: BuildRevokeDraftInput[] = [
      input({ chainId: 5, selectedRpc: { chainId: 5, endpointSummary: "https://rpc.example.invalid" }, snapshot: allowance({ chainId: 5 }) }),
      input({ selectedRpc: { chainId: 1, endpointSummary: "https://other-rpc.example.invalid" } }),
      input({ snapshot: allowance({ spender: "0x4444444444444444444444444444444444444444" }) }),
      input({ snapshot: nft(), warningAcknowledgements: { externalCounterparty: true, manualFeeGas: true } }),
      input({ fee: { ...input().fee, nonce: 8 } }),
      input({ fee: { ...input().fee, gasLimit: 60_000n } }),
      input({ fee: { ...input().fee, maxFeePerGas: 13n } }),
      input({ warningAcknowledgements: { externalCounterparty: false, manualFeeGas: true } }),
    ];

    for (const changed of changes) {
      expect(buildRevokeDraft(changed).frozenKey).not.toBe(frozenKey);
    }
  });

  it("keeps frozenKey stable across instance time while draftId and frozenTimeKey cover time", () => {
    const first = buildRevokeDraft(input({ createdAt: "2026-04-29T00:00:00.000Z" }));
    const second = buildRevokeDraft(input({ createdAt: "2026-04-29T00:01:00.000Z" }));

    expect(second.frozenKey).toBe(first.frozenKey);
    expect(second.draftId).not.toBe(first.draftId);
    expect(second.frozenTimeKey).not.toBe(first.frozenTimeKey);
    expect(JSON.stringify(second.frozenPayload)).toContain("createdAt");
    expect(JSON.stringify(second.frozenPayload)).toContain("frozenAt");
    expect(JSON.stringify(second.frozenPayload)).toContain("frozenTimeKey");
  });
});
