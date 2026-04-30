import { describe, expect, it } from "vitest";
import type { HistoryRecord, SubmissionKind, TransactionType } from "../history/schema";
import { buildTxAnalysisLocalHistoryModel } from "./localHistory";

const txHash = `0x${"a".repeat(64)}`;
const otherHash = `0x${"b".repeat(64)}`;
const from = "0x1111111111111111111111111111111111111111";
const otherFrom = "0x3333333333333333333333333333333333333333";
const to = "0x2222222222222222222222222222222222222222";

type HistoryRecordOverrides = Omit<
  Partial<HistoryRecord>,
  "intent" | "submission" | "outcome" | "nonce_thread"
> & {
  intent?: Partial<HistoryRecord["intent"]>;
  submission?: Partial<HistoryRecord["submission"]>;
  outcome?: Partial<HistoryRecord["outcome"]>;
  nonce_thread?: Partial<HistoryRecord["nonce_thread"]>;
};

function record(overrides: HistoryRecordOverrides = {}): HistoryRecord {
  const transactionType = overrides.submission?.transaction_type ?? "nativeTransfer";
  return {
    schema_version: 1,
    intent_snapshot: { source: "test", captured_at: null },
    intent: {
      transaction_type: transactionType,
      token_contract: null,
      recipient: null,
      amount_raw: null,
      decimals: null,
      token_symbol: null,
      token_name: null,
      token_metadata_source: null,
      selector: null,
      method_name: null,
      native_value_wei: "100",
      rpc_url: null,
      account_index: 0,
      chain_id: 1,
      from,
      to,
      value_wei: "100",
      nonce: 7,
      gas_limit: null,
      max_fee_per_gas: null,
      max_priority_fee_per_gas: null,
      ...overrides.intent,
    },
    submission: {
      transaction_type: transactionType,
      token_contract: null,
      recipient: null,
      amount_raw: null,
      decimals: null,
      token_symbol: null,
      token_name: null,
      token_metadata_source: null,
      selector: null,
      method_name: null,
      native_value_wei: "100",
      frozen_key: "frozen",
      tx_hash: txHash,
      kind: "nativeTransfer",
      source: "test",
      chain_id: 1,
      account_index: 0,
      from,
      to,
      value_wei: "100",
      nonce: 7,
      gas_limit: null,
      max_fee_per_gas: null,
      max_priority_fee_per_gas: null,
      broadcasted_at: null,
      replaces_tx_hash: null,
      ...overrides.submission,
    },
    outcome: {
      state: "Pending",
      tx_hash: overrides.submission?.tx_hash ?? txHash,
      receipt: null,
      finalized_at: null,
      reconciled_at: null,
      reconcile_summary: null,
      error_summary: null,
      dropped_review_history: [],
      ...overrides.outcome,
    },
    nonce_thread: {
      source: "test",
      key: "thread",
      chain_id: 1,
      account_index: 0,
      from,
      nonce: 7,
      replaces_tx_hash: null,
      replaced_by_tx_hash: null,
      ...overrides.nonce_thread,
    },
    batch_metadata: overrides.batch_metadata ?? null,
    abi_call_metadata: overrides.abi_call_metadata ?? null,
    raw_calldata_metadata: overrides.raw_calldata_metadata ?? null,
    asset_approval_revoke_metadata: overrides.asset_approval_revoke_metadata ?? null,
  };
}

function query(overrides: Partial<Parameters<typeof buildTxAnalysisLocalHistoryModel>[0]> = {}) {
  return buildTxAnalysisLocalHistoryModel({
    txHash,
    chainId: 1,
    from,
    nonce: "7",
    to,
    valueWei: "100",
    history: [],
    ...overrides,
  });
}

function typedRecord(
  transactionType: TransactionType,
  submission: Partial<HistoryRecord["submission"]> = {},
  extra: HistoryRecordOverrides = {},
) {
  return record({
    ...extra,
    submission: {
      transaction_type: transactionType,
      kind: submissionKindForTransactionType(transactionType),
      ...submission,
    },
    intent: { transaction_type: transactionType, ...extra.intent },
  });
}

function submissionKindForTransactionType(transactionType: TransactionType): SubmissionKind {
  if (transactionType === "contractCall") return "abiWriteCall";
  if (transactionType === "unknown") return "unsupported";
  return transactionType;
}

describe("buildTxAnalysisLocalHistoryModel", () => {
  it("matches local tx hash side-by-side without replacing RPC facts", () => {
    const result = query({ history: [record({ submission: { tx_hash: otherHash } }), record()] });

    expect(result.status).toBe("matched");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      outcome: "Pending",
      txHash,
      localChainId: 1,
      from,
      nonce: 7,
      transactionType: "nativeTransfer",
      conflicts: [],
    });
    expect(result.disclaimer).toContain("does not override RPC facts");
  });

  it("surfaces duplicate tx hash records instead of hiding them", () => {
    const result = query({
      history: [
        record({ outcome: { state: "Pending" } }),
        record({ outcome: { state: "Confirmed" }, submission: { kind: "erc20Transfer" } }),
      ],
    });

    expect(result.status).toBe("duplicateTxHash");
    expect(result.records.map((entry) => entry.outcome)).toEqual(["Pending", "Confirmed"]);
  });

  it("flags chain, from, and nonce conflicts against RPC facts", () => {
    expect(query({ history: [record({ submission: { chain_id: 5 } })] }).status).toBe(
      "chainConflict",
    );
    expect(query({ history: [record({ submission: { from: otherFrom } })] }).status).toBe(
      "fromMismatch",
    );
    expect(query({ history: [record({ submission: { nonce: 8 } })] }).status).toBe(
      "nonceMismatch",
    );
    expect(query({ txHash: otherHash, history: [record()] }).status).toBe("noMatch");
  });

  it("summarizes native, ERC-20, batch, ABI, raw calldata, and revoke typed history", () => {
    const records = [
      typedRecord("nativeTransfer", { native_value_wei: "100", value_wei: "100" }),
      typedRecord("erc20Transfer", {
        tx_hash: `0x${"b".repeat(64)}`,
        token_contract: "0xtoken",
        recipient: "0xrecipient",
        amount_raw: "2500000",
        decimals: 6,
        token_symbol: "USDC",
        token_metadata_source: "token-list",
        method_name: "transfer",
        selector: "0xa9059cbb",
      }),
      typedRecord(
        "contractCall",
        { tx_hash: `0x${"c".repeat(64)}`, selector: "0x095ea7b3", method_name: "approve" },
        {
          batch_metadata: {
            batch_id: "batch-1",
            child_id: "child-1",
            batch_kind: "distribute",
            asset_kind: "erc20",
            child_index: 0,
            freeze_key: "freeze",
            child_count: 2,
            contract_address: to,
            selector: "0x095ea7b3",
            method_name: "approve",
            total_value_wei: null,
            token_contract: "0xtoken",
            decimals: 18,
            token_symbol: "TOK",
            token_name: "Token",
            token_metadata_source: "cache",
            total_amount_raw: "500",
            recipients: [],
          },
          abi_call_metadata: {
            intent_kind: "abiWriteCall",
            draft_id: "draft-abi",
            created_at: null,
            chain_id: 1,
            account_index: 0,
            from,
            contract_address: to,
            source_kind: "userImported",
            provider_config_id: null,
            user_source_id: "source-1",
            version_id: "v1",
            abi_hash: "abi-hash",
            source_fingerprint: "source-fingerprint",
            function_signature: "approve(address,uint256)",
            selector: "0x095ea7b3",
            argument_summary: [],
            argument_hash: "argument-hash",
            native_value_wei: "0",
            gas_limit: null,
            max_fee_per_gas: null,
            max_priority_fee_per_gas: null,
            nonce: 7,
            selected_rpc: null,
            warnings: [],
            blocking_statuses: [],
            calldata: { selector: "0x095ea7b3", byte_length: 68, hash: "0xcalldatahash" },
            future_submission: null,
            future_outcome: null,
            broadcast: null,
            recovery: null,
          },
        },
      ),
      typedRecord(
        "rawCalldata",
        { tx_hash: `0x${"d".repeat(64)}`, selector: "0x12345678" },
        {
          raw_calldata_metadata: {
            intent_kind: "rawCalldata",
            draft_id: "draft-raw",
            created_at: null,
            chain_id: 1,
            account_index: 0,
            from,
            to,
            value_wei: "0",
            gas_limit: null,
            max_fee_per_gas: null,
            max_priority_fee_per_gas: null,
            nonce: 7,
            calldata_hash_version: "keccak256-v1",
            calldata_hash: "0xrawhash",
            calldata_byte_length: 516,
            selector: "0x12345678",
            selector_status: "present",
            preview: {
              preview_prefix_bytes: 4,
              preview_suffix_bytes: 4,
              truncated: true,
              omitted_bytes: 508,
              display: `0x${"f".repeat(1024)}`,
              prefix: "0x12345678",
              suffix: "0xabcdef12",
            },
            warning_acknowledgements: [],
            warning_summaries: [],
            blocking_statuses: [],
            inference: {
              inference_status: "selectorMatched",
              matched_source_kind: "userImported",
              matched_source_id: "source-1",
              matched_version_id: "v1",
              matched_source_fingerprint: "source-fingerprint",
              matched_abi_hash: "abi-hash",
              selector_match_count: 1,
              conflict_summary: null,
              stale_status: "fresh",
              source_status: "ok",
            },
            frozen_key: "freeze-raw",
            future_submission: null,
            future_outcome: null,
            broadcast: null,
            recovery: null,
          },
        },
      ),
      typedRecord(
        "assetApprovalRevoke",
        { tx_hash: `0x${"e".repeat(64)}`, selector: "0x095ea7b3", method_name: "approve" },
        {
          asset_approval_revoke_metadata: {
            intent_kind: "assetApprovalRevoke",
            draft_id: "draft-revoke",
            created_at: null,
            frozen_at: null,
            chain_id: 1,
            account_index: 0,
            from,
            to,
            value_wei: "0",
            approval_kind: "erc20Allowance",
            token_approval_contract: "0xtoken",
            spender: "0xspender",
            operator: null,
            token_id: null,
            method: "approve",
            selector: "0x095ea7b3",
            calldata_hash: "0xrevokehash",
            calldata_byte_length: 68,
            calldata_args: [],
            gas_limit: null,
            latest_base_fee_per_gas: null,
            base_fee_per_gas: null,
            max_fee_per_gas: null,
            max_priority_fee_per_gas: null,
            nonce: 7,
            selected_rpc: null,
            snapshot: null,
            warning_acknowledgements: [],
            warning_summaries: [],
            blocking_statuses: [],
            frozen_key: "freeze-revoke",
            future_submission: null,
            future_outcome: null,
            broadcast: null,
            recovery: null,
          },
        },
      ),
    ];

    const summaries = records.map((entry) =>
      query({ txHash: entry.submission.tx_hash, history: records }).records[0].typedRows,
    );
    const text = summaries.flat().map((row) => `${row.label}: ${row.value}`).join("\n");

    expect(text).toContain("Native value: 100 wei");
    expect(text).toContain("Token symbol: USDC");
    expect(text).toContain("Batch id: batch-1");
    expect(text).toContain("Function: approve(address,uint256)");
    expect(text).toContain("Calldata bytes: 516");
    expect(text).toContain("Inference: selectorMatched");
    expect(text).toContain("Approval kind: erc20Allowance");
    expect(text).toContain("Spender: 0xspender");
    expect(text).not.toContain("ffffffffff");
  });

  it("redacts untrusted local metadata values from bounded summaries", () => {
    const secret = "seed phrase abandon abandon private_key=0xsecret";
    const rawCalldata = `0x${"f".repeat(1024)}`;
    const result = query({
      history: [
        typedRecord(
          "rawCalldata",
          { source: secret, frozen_key: secret },
          {
            raw_calldata_metadata: {
              intent_kind: "rawCalldata",
              draft_id: secret,
              created_at: null,
              chain_id: 1,
              account_index: 0,
              from,
              to,
              value_wei: "0",
              gas_limit: null,
              max_fee_per_gas: null,
              max_priority_fee_per_gas: null,
              nonce: 7,
              calldata_hash_version: "keccak256-v1",
              calldata_hash: "0xrawhash",
              calldata_byte_length: 516,
              selector: "0x12345678",
              selector_status: "present",
              preview: {
                preview_prefix_bytes: 4,
                preview_suffix_bytes: 4,
                truncated: true,
                omitted_bytes: 508,
                display: rawCalldata,
                prefix: rawCalldata,
                suffix: rawCalldata,
              },
              warning_acknowledgements: [{ level: "warning", code: "privateKey", message: secret, source: secret }],
              warning_summaries: [{ level: "warning", code: "rawCalldata", message: rawCalldata, source: secret }],
              blocking_statuses: [],
              inference: null,
              frozen_key: secret,
              future_submission: null,
              future_outcome: null,
              broadcast: null,
              recovery: null,
            },
          },
        ),
      ],
    });
    const serialized = JSON.stringify(result);

    expect(serialized).toContain("0xrawhash");
    expect(serialized).toContain("516");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(rawCalldata);
    expect(serialized).not.toContain("abandon abandon");
  });

  it("redacts credential-shaped local typed summary values", () => {
    const unsafeValues = [
      "password=hunter2",
      "passphrase:correct horse battery staple",
      "Bearer local-access-token",
      "https://user:pass@rpc.example.invalid/v3/path?token=secret",
      "accessToken:local-access-token",
      `0xa9059cbb${"f".repeat(128)}`,
    ];
    const result = query({
      history: unsafeValues.map((value) =>
        typedRecord("erc20Transfer", {
          tx_hash: txHash,
          token_contract: value,
          recipient: value,
          amount_raw: value,
          token_symbol: value,
          token_name: value,
          token_metadata_source: value,
        }),
      ),
    });
    const serialized = JSON.stringify(result);

    for (const value of unsafeValues) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).toContain("[redacted]");
  });

  it("uses distinct conflict statuses for to and value mismatches", () => {
    const result = query({
      to: "0x4444444444444444444444444444444444444444",
      valueWei: "999",
      history: [record()],
    });

    expect(result.status).toBe("toMismatch");
    expect(result.records[0].conflicts).toEqual(["toMismatch", "valueMismatch"]);
  });
});
