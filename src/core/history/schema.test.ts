import { describe, expect, it } from "vitest";
import { normalizeHistoryRecords, parseTransactionHistoryPayload } from "./schema";

const legacyIntent = {
  rpc_url: "http://127.0.0.1:8545",
  account_index: 1,
  chain_id: 1,
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  value_wei: "100",
  nonce: 7,
  gas_limit: "21000",
  max_fee_per_gas: "40000000000",
  max_priority_fee_per_gas: "1500000000",
};

describe("history schema normalization", () => {
  it("loads v1 records with legacy unknown null defaults", () => {
    const records = parseTransactionHistoryPayload(
      JSON.stringify([
        {
          intent: legacyIntent,
          submission: {
            frozen_key: "legacy-key",
            tx_hash: "0xlegacy",
          },
          outcome: {
            state: "Pending",
            tx_hash: "0xlegacy",
          },
        },
      ]),
    );

    expect(records[0]).toMatchObject({
      schema_version: 1,
      intent_snapshot: { source: "legacy", captured_at: null },
      intent: {
        transaction_type: "nativeTransfer",
        token_contract: null,
        recipient: null,
        amount_raw: null,
      },
      submission: {
        kind: "legacy",
        transaction_type: "nativeTransfer",
        source: "legacy",
        broadcasted_at: null,
        chain_id: null,
      },
      outcome: {
        receipt: null,
        finalized_at: null,
        reconciled_at: null,
        reconcile_summary: null,
        error_summary: null,
        dropped_review_history: [],
      },
      nonce_thread: {
        source: "legacy",
        key: "unknown",
        chain_id: null,
      },
      batch_metadata: null,
    });
  });

  it("preserves p3 submission, outcome, and nonce thread fields", () => {
    const records = normalizeHistoryRecords([
      {
        schema_version: 2,
        intent: legacyIntent,
        intent_snapshot: {
          source: "nativeTransferIntent",
          captured_at: "1700000000",
        },
        submission: {
          frozen_key: "p3-key",
          tx_hash: "0xp3",
          kind: "nativeTransfer",
          source: "submission",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          to: legacyIntent.to,
          value_wei: "100",
          nonce: 7,
          gas_limit: "21000",
          max_fee_per_gas: "40000000000",
          max_priority_fee_per_gas: "1500000000",
          broadcasted_at: "1700000001",
          replaces_tx_hash: null,
        },
        outcome: {
          state: "Confirmed",
          tx_hash: "0xp3",
          receipt: {
            status: 1,
            block_number: 12,
            block_hash: "0xblock",
            transaction_index: 0,
            gas_used: "21000",
            effective_gas_price: "123",
          },
          finalized_at: "1700000002",
          reconciled_at: "1700000002",
          reconcile_summary: {
            source: "rpcReceipt",
            checked_at: "1700000002",
            rpc_chain_id: 1,
            latest_confirmed_nonce: null,
            decision: "receiptStatus1",
          },
          error_summary: null,
        },
        nonce_thread: {
          source: "derived",
          key: "1:1:0x1111111111111111111111111111111111111111:7",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          nonce: 7,
          replaces_tx_hash: null,
          replaced_by_tx_hash: null,
        },
      },
    ]);

    expect(records[0].submission.broadcasted_at).toBe("1700000001");
    expect(records[0].outcome.receipt?.gas_used).toBe("21000");
    expect(records[0].nonce_thread.key).toBe(
      "1:1:0x1111111111111111111111111111111111111111:7",
    );
  });

  it("normalizes additive batch metadata without breaking ordinary history rows", () => {
    const records = normalizeHistoryRecords([
      {
        schema_version: 2,
        intent: legacyIntent,
        intent_snapshot: {
          source: "nativeTransferIntent",
          captured_at: "1700000000",
        },
        submission: {
          frozen_key: "batch-key",
          tx_hash: "0xbatch",
          kind: "nativeTransfer",
          source: "submission",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          to: legacyIntent.to,
          value_wei: "100",
          nonce: 7,
          gas_limit: "21000",
          max_fee_per_gas: "40000000000",
          max_priority_fee_per_gas: "1500000000",
          broadcasted_at: "1700000001",
          replaces_tx_hash: null,
        },
        outcome: {
          state: "Pending",
          tx_hash: "0xbatch",
        },
        nonce_thread: {
          source: "derived",
          key: "1:1:0x1111111111111111111111111111111111111111:7",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          nonce: 7,
        },
        batchMetadata: {
          batchId: "batch-1",
          childId: "batch-1:child-0001",
          batchKind: "distribute",
          assetKind: "native",
          childIndex: 0,
          freezeKey: "0xfrozen",
        },
      },
    ]);

    expect(records[0].batch_metadata).toEqual({
      batch_id: "batch-1",
      child_id: "batch-1:child-0001",
      batch_kind: "distribute",
      asset_kind: "native",
      child_index: 0,
      freeze_key: "0xfrozen",
      child_count: null,
      contract_address: null,
      selector: null,
      method_name: null,
      total_value_wei: null,
      recipients: [],
    });
  });

  it("normalizes persisted native distribution recipient allocations", () => {
    const records = normalizeHistoryRecords([
      {
        intent: {
          ...legacyIntent,
          transaction_type: "contractCall",
          to: "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3",
          value_wei: "300",
          native_value_wei: "300",
          selector: "0xe63d38ed",
          method_name: "disperseEther(address[],uint256[])",
        },
        submission: {
          frozen_key: "contract-key",
          tx_hash: "0xcontract",
          transaction_type: "contractCall",
          selector: "0xe63d38ed",
          method_name: "disperseEther(address[],uint256[])",
          native_value_wei: "300",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          to: "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3",
          value_wei: "300",
          nonce: 7,
        },
        outcome: { state: "Pending", tx_hash: "0xcontract" },
        batch_metadata: {
          batch_id: "batch-1",
          child_id: "batch-1:parent",
          batch_kind: "distribute",
          asset_kind: "native",
          freeze_key: "0xfrozen",
          child_count: 2,
          contract_address: "0xd15fE25eD0Dba12fE05e7029C88b10C25e8880E3",
          selector: "0xe63d38ed",
          method_name: "disperseEther(address[],uint256[])",
          total_value_wei: "300",
          recipients: [
            {
              child_id: "batch-1:child-0001",
              child_index: 0,
              target_kind: "localAccount",
              target_address: "0x2222222222222222222222222222222222222222",
              value_wei: "100",
            },
            {
              childId: "batch-1:child-0002",
              childIndex: 1,
              targetKind: "externalAddress",
              targetAddress: "0x3333333333333333333333333333333333333333",
              valueWei: "200",
            },
          ],
        },
      },
    ]);

    expect(records[0].batch_metadata?.recipients).toEqual([
      {
        child_id: "batch-1:child-0001",
        child_index: 0,
        target_kind: "localAccount",
        target_address: "0x2222222222222222222222222222222222222222",
        value_wei: "100",
      },
      {
        child_id: "batch-1:child-0002",
        child_index: 1,
        target_kind: "externalAddress",
        target_address: "0x3333333333333333333333333333333333333333",
        value_wei: "200",
      },
    ]);
  });

  it("normalizes mixed legacy and p3 records to one stable contract", () => {
    const records = normalizeHistoryRecords([
      {
        intent: legacyIntent,
        submission: { frozen_key: "legacy-key", tx_hash: "0xlegacy" },
        outcome: { state: "Pending", tx_hash: "0xlegacy" },
      },
      {
        schema_version: 2,
        intent: { ...legacyIntent, nonce: 8 },
        intent_snapshot: { source: "nativeTransferIntent", captured_at: "1700000000" },
        submission: {
          frozen_key: "p3-key",
          tx_hash: "0xp3",
          kind: "replacement",
          source: "submission",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          to: legacyIntent.to,
          value_wei: "200",
          nonce: 8,
          gas_limit: "21000",
          max_fee_per_gas: "50000000000",
          max_priority_fee_per_gas: "2000000000",
          broadcasted_at: "1700000001",
          replaces_tx_hash: "0xlegacy",
        },
        outcome: { state: "Pending", tx_hash: "0xp3" },
        nonce_thread: {
          source: "derived",
          key: "1:1:0x1111111111111111111111111111111111111111:8",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          nonce: 8,
          replaces_tx_hash: "0xlegacy",
          replaced_by_tx_hash: null,
        },
      },
    ]);

    expect(records).toHaveLength(2);
    expect(records[0].submission.kind).toBe("legacy");
    expect(records[1].submission.kind).toBe("replacement");
    expect(records[1].outcome.receipt).toBeNull();
  });

  it("preserves ERC-20 typed fields without collapsing token contract and recipient", () => {
    const tokenContract = "0x4444444444444444444444444444444444444444";
    const recipient = "0x5555555555555555555555555555555555555555";
    const records = normalizeHistoryRecords([
      {
        schema_version: 3,
        intent: {
          ...legacyIntent,
          transaction_type: "erc20Transfer",
          to: tokenContract,
          value_wei: "0",
          token_contract: tokenContract,
          recipient,
          amount_raw: "1234500",
          decimals: 6,
          token_symbol: "TST",
          token_name: "Test Token",
          token_metadata_source: "userConfirmed",
          selector: "0xa9059cbb",
          method_name: "transfer",
          native_value_wei: "0",
        },
        submission: {
          frozen_key: "erc20-key",
          tx_hash: "0xerc20",
          kind: "erc20Transfer",
          transaction_type: "erc20Transfer",
          source: "submission",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          to: tokenContract,
          value_wei: "0",
          token_contract: tokenContract,
          recipient,
          amount_raw: "1234500",
          decimals: 6,
          token_symbol: "TST",
          token_name: "Test Token",
          token_metadata_source: "userConfirmed",
          selector: "0xa9059cbb",
          method_name: "transfer",
          native_value_wei: "0",
          nonce: 9,
          gas_limit: "65000",
          max_fee_per_gas: "40000000000",
          max_priority_fee_per_gas: "1500000000",
          broadcasted_at: "1700000001",
          replaces_tx_hash: null,
        },
        outcome: { state: "Pending", tx_hash: "0xerc20" },
        nonce_thread: {
          source: "derived",
          key: "1:1:0x1111111111111111111111111111111111111111:9",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          nonce: 9,
          replaces_tx_hash: null,
          replaced_by_tx_hash: null,
        },
      },
    ]);

    expect(records[0].intent.transaction_type).toBe("erc20Transfer");
    expect(records[0].intent.to).toBe(tokenContract);
    expect(records[0].intent.token_contract).toBe(tokenContract);
    expect(records[0].intent.recipient).toBe(recipient);
    expect(records[0].submission.kind).toBe("erc20Transfer");
    expect(records[0].submission.native_value_wei).toBe("0");
  });

  it("falls back when submission kind, transaction type, or outcome state are unknown", () => {
    const records = normalizeHistoryRecords([
      {
        intent: legacyIntent,
        submission: {
          frozen_key: "strange-key",
          tx_hash: "0xstrange",
          kind: "surprise",
          transaction_type: "mysterySwap",
        },
        outcome: {
          state: "MinedButMaybeNot",
          tx_hash: "0xstrange",
        },
      },
    ]);

    expect(records[0].submission.kind).toBe("unsupported");
    expect(records[0].submission.transaction_type).toBe("unknown");
    expect(records[0].outcome.state).toBe("Unknown");
  });

  it("normalizes additive dropped review audit history", () => {
    const records = normalizeHistoryRecords([
      {
        intent: legacyIntent,
        submission: { frozen_key: "key", tx_hash: "0xreviewed" },
        outcome: {
          state: "Confirmed",
          tx_hash: "0xreviewed",
          dropped_review_history: [
            {
              reviewed_at: "1700000010",
              source: "droppedManualReview",
              tx_hash: "0xreviewed",
              rpc_endpoint_summary: "https://mainnet.example",
              requested_chain_id: 1,
              rpc_chain_id: 1,
              latest_confirmed_nonce: 9,
              transaction_found: false,
              local_same_nonce_tx_hash: "0xreplacement",
              local_same_nonce_state: "Replaced",
              original_state: "Dropped",
              original_finalized_at: "1700000000",
              original_reconciled_at: "1700000000",
              original_reconcile_summary: {
                source: "rpcNonce",
                checked_at: "1700000000",
                rpc_chain_id: 1,
                latest_confirmed_nonce: 9,
                decision: "missingReceiptNonceAdvanced",
              },
              result_state: "Confirmed",
              receipt: { status: 1 },
              decision: "receiptStatus1",
              recommendation: "confirmed after review",
              error_summary: null,
            },
          ],
        },
      },
    ]);

    expect(records[0].outcome.dropped_review_history[0]).toMatchObject({
      reviewed_at: "1700000010",
      rpc_endpoint_summary: "https://mainnet.example",
      original_state: "Dropped",
      result_state: "Confirmed",
      transaction_found: false,
      local_same_nonce_state: "Replaced",
    });
  });
});
