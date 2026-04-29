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
      token_contract: null,
      decimals: null,
      token_symbol: null,
      token_name: null,
      token_metadata_source: null,
      total_amount_raw: null,
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
        amount_raw: null,
      },
      {
        child_id: "batch-1:child-0002",
        child_index: 1,
        target_kind: "externalAddress",
        target_address: "0x3333333333333333333333333333333333333333",
        value_wei: "200",
        amount_raw: null,
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

  it("normalizes raw calldata metadata without disguising it or retaining full payloads", () => {
    const rawCalldata = `0x12345678${"ab".repeat(256)}`;
    const records = normalizeHistoryRecords([
      {
        schema_version: 5,
        intent: {
          ...legacyIntent,
          transaction_type: "rawCalldata",
          to: "0x6666666666666666666666666666666666666666",
          value_wei: "42",
          selector: "0x12345678",
          native_value_wei: "42",
        },
        submission: {
          frozen_key: "raw-draft-key",
          tx_hash: "0xraw",
          kind: "rawCalldata",
          transaction_type: "rawCalldata",
          source: "rawCalldataDraft",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          to: "0x6666666666666666666666666666666666666666",
          value_wei: "42",
          nonce: 12,
          gas_limit: "120000",
          max_fee_per_gas: "40000000000",
          max_priority_fee_per_gas: "1500000000",
          selector: "0x12345678",
          native_value_wei: "42",
        },
        outcome: { state: "Pending", tx_hash: "0xraw" },
        nonce_thread: {
          source: "rawCalldataDraft",
          key: "1:1:0x1111111111111111111111111111111111111111:12",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          nonce: 12,
        },
        rawCalldataMetadata: {
          intentKind: "rawCalldata",
          draftId: "draft-raw-1",
          createdAt: "2026-04-29T01:02:03.000Z",
          chainId: 1,
          accountIndex: 1,
          from: legacyIntent.from,
          to: "0x6666666666666666666666666666666666666666",
          valueWei: "42",
          gasLimit: "120000",
          maxFeePerGas: "40000000000",
          maxPriorityFeePerGas: "1500000000",
          nonce: 12,
          calldataHashVersion: "keccak256-v1",
          calldataHash: "0xhash",
          calldataByteLength: 260,
          selector: "0x12345678",
          selectorStatus: "matched",
          preview: {
            previewPrefixBytes: 32,
            previewSuffixBytes: 32,
            truncated: true,
            omittedBytes: 196,
            display: "0x12345678...abab",
            prefix: "0x12345678",
            suffix: "0xabab",
            fullCalldata: rawCalldata,
          },
          warningAcknowledgements: [
            { level: "warning", code: "unknownSelector", message: "ack token=SECRET_TOKEN", source: "user" },
          ],
          warningSummaries: [
            { level: "warning", code: "largeCalldata", message: "payload is large", source: "preview" },
          ],
          blockingStatuses: [
            { level: "blocking", code: "missingAck", message: "privateKey=0xabc", source: "preview" },
          ],
          inference: {
            inferenceStatus: "matched",
            matchedSourceKind: "explorerFetched",
            matchedSourceId: "etherscan-mainnet",
            matchedVersionId: "v1",
            matchedSourceFingerprint: "0xfingerprint",
            matchedAbiHash: "0xabi",
            selectorMatchCount: 1,
            conflictSummary: "none",
            staleStatus: "fresh",
            sourceStatus: "ok",
          },
          frozenKey: "raw-draft-key",
          futureSubmission: {
            txHash: null,
            errorSummary: "failed signedTx=0xsigned mnemonic=abandon abandon next=value",
          },
          rawCalldata,
          calldata: rawCalldata,
          canonicalCalldata: rawCalldata,
          fullCalldata: rawCalldata,
          privateKey: "0xabc",
        },
        abi_call_metadata: {
          intentKind: "abiWriteCall",
        },
        batchMetadata: {
          batchId: "should-not-render-as-batch",
        },
      },
    ]);

    expect(records[0].intent.transaction_type).toBe("rawCalldata");
    expect(records[0].submission.kind).toBe("rawCalldata");
    expect(records[0].submission.transaction_type).toBe("rawCalldata");
    expect(records[0].raw_calldata_metadata).toMatchObject({
      intent_kind: "rawCalldata",
      calldata_hash_version: "keccak256-v1",
      calldata_hash: "0xhash",
      calldata_byte_length: 260,
      selector: "0x12345678",
      selector_status: "matched",
      preview: {
        preview_prefix_bytes: 32,
        preview_suffix_bytes: 32,
        truncated: true,
        omitted_bytes: 196,
        display: "0x12345678...abab",
        prefix: "0x12345678",
        suffix: "0xabab",
      },
      inference: {
        inference_status: "matched",
        matched_source_kind: "explorerFetched",
        selector_match_count: 1,
      },
      frozen_key: "raw-draft-key",
    });
    expect(records[0].raw_calldata_metadata?.warning_acknowledgements[0].message).toBe(
      "ack [redacted_secret]",
    );
    expect(records[0].raw_calldata_metadata?.blocking_statuses[0].message).toBe(
      "[redacted_secret]",
    );
    expect(records[0].raw_calldata_metadata?.future_submission?.error_summary).toBe(
      "failed [redacted_secret] [redacted_secret] next=value",
    );
    expect(records[0].abi_call_metadata?.intent_kind).toBe("abiWriteCall");
    expect(records[0].batch_metadata?.batch_id).toBe("should-not-render-as-batch");

    const durable = JSON.stringify(records[0]);
    expect(durable).not.toContain(rawCalldata);
    expect(durable).not.toContain("rawCalldata\":\"");
    expect(durable).not.toContain("fullCalldata");
    expect(durable).not.toContain("canonicalCalldata");
    expect(durable).not.toContain("calldata\":\"");
    expect(durable).not.toContain("SECRET_TOKEN");
    expect(durable).not.toContain("0xabc");
    expect(durable).not.toContain("0xsigned");
    expect(durable).not.toContain("abandon abandon");
  });

  it("normalizes arbitrary ABI write call metadata without raw ABI, calldata, params, or RPC secrets", () => {
    const rawCalldata = `0xa9059cbb${"0".repeat(512)}`;
    const overlongKind = `kind-${"x".repeat(220)}`;
    const overlongType = `0x${"ab".repeat(160)}`;
    const overlongHash = `0x${"cd".repeat(160)}`;
    const records = normalizeHistoryRecords([
      {
        schema_version: 4,
        intent: {
          ...legacyIntent,
          transaction_type: "contractCall",
          to: "0x6666666666666666666666666666666666666666",
          value_wei: "42",
          selector: "0xa9059cbb",
          method_name: "transfer(address,uint256)",
          native_value_wei: "42",
        },
        submission: {
          frozen_key: "abi-draft-key",
          tx_hash: "unknown",
          kind: "abiWriteCall",
          source: "abiWriteDraft",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          to: "0x6666666666666666666666666666666666666666",
          value_wei: "42",
          nonce: null,
          gas_limit: null,
          max_fee_per_gas: null,
          max_priority_fee_per_gas: null,
        },
        outcome: { state: "Unknown", tx_hash: "unknown" },
        nonce_thread: {
          source: "abiWriteDraft",
          key: "unknown",
          chain_id: 1,
          account_index: 1,
          from: legacyIntent.from,
          nonce: null,
        },
        abiCallMetadata: {
          intentKind: "abiWriteCall",
          draftId: "draft-abi-1",
          createdAt: "2026-04-29T01:02:03.000Z",
          chainId: 1,
          accountIndex: 1,
          from: legacyIntent.from,
          contractAddress: "0x6666666666666666666666666666666666666666",
          sourceKind: "provider",
          providerConfigId: "etherscan-mainnet",
          userSourceId: null,
          versionId: "v1",
          abiHash: "0xabi",
          sourceFingerprint: "0xfingerprint",
          functionSignature: "transfer(address,uint256)",
          selector: "0xa9059cbb",
          argumentSummary: [
            {
              kind: "address",
              type: "address",
              value: "0x7777777777777777777777777777777777777777",
              truncated: false,
              rawParam: "do not persist",
            },
            {
              kind: "uint",
              type: "uint256",
              value: "1000000",
              truncated: false,
            },
            {
              kind: overlongKind,
              type: overlongType,
              value: "payload-summary",
              hash: overlongHash,
              truncated: false,
            },
            {
              kind: "string",
              type: "string",
              value: "callback https://rpc.example/?api_key=SECRET_TOKEN Authorization: Bearer SECRET_TOKEN password=SECRET_TOKEN",
              truncated: false,
            },
          ],
          argumentHash: "0xargs",
          canonicalParams: ["0x7777777777777777777777777777777777777777", "1000000"],
          nativeValueWei: "42",
          nonce: null,
          gasLimit: null,
          maxFeePerGas: null,
          maxPriorityFeePerGas: null,
          selectedRpc: {
            chainId: 1,
            providerConfigId: "mainnet-rpc",
            endpointId: "primary",
            endpointName: "Mainnet primary token=SECRET_TOKEN",
            endpointSummary: "https://rpc.example/?api_key=SECRET_TOKEN",
            endpointFingerprint: "rpc-endpoint-1234abcd",
            endpointFingerprintSource: "https://rpc.example/?api_key=SECRET_TOKEN",
            rpcUrl: "https://rpc.example/?api_key=SECRET_TOKEN",
          },
          warnings: [
            {
              level: "warning",
              code: "payable",
              message: "Requires value via https://rpc.example/?api_key=SECRET_TOKEN",
              source: "abi",
            },
          ],
          blockingStatuses: [
            {
              level: "blocking",
              code: "unsupportedTuple",
              message: "Tuple input Authorization: Bearer SECRET_TOKEN",
              source: "abi",
            },
          ],
          calldata: {
            selector: "0xa9059cbb",
            byteLength: 68,
            hash: "0xcalldatahash",
            rawCalldata,
          },
          futureSubmission: {
            status: null,
            txHash: null,
            submittedAt: null,
            broadcastedAt: null,
            errorSummary:
              "submit failed token=SECRET_TOKEN privateKey=0xabc rawTx=0xsigned signed transaction=signed-secret",
          },
          futureOutcome: {
            state: "Confirmed",
            checkedAt: null,
            receiptStatus: null,
            blockNumber: null,
            gasUsed: null,
            errorSummary:
              "receipt failed https://rpc.example/?token=SECRET_TOKEN mnemonic=abandon abandon next=value",
          },
          broadcast: {
            txHash: null,
            broadcastedAt: null,
            rpcChainId: null,
            rpcEndpointSummary: "wss://rpc.example/socket?token=SECRET_TOKEN",
            errorSummary: "broadcast failed Bearer SECRET_TOKEN",
          },
          recovery: {
            recoveryId: null,
            status: null,
            createdAt: null,
            recoveredAt: null,
            lastError: "recover failed api_key=SECRET_TOKEN",
            replacementTxHash: null,
          },
          rawAbi: "[{\"type\":\"function\",\"name\":\"transfer\"}]",
        },
      },
    ]);

    expect(records[0].submission.kind).toBe("abiWriteCall");
    expect(records[0].submission.transaction_type).toBe("contractCall");
    expect(records[0].abi_call_metadata).toMatchObject({
      intent_kind: "abiWriteCall",
      chain_id: 1,
      account_index: 1,
      contract_address: "0x6666666666666666666666666666666666666666",
      source_kind: "provider",
      provider_config_id: "etherscan-mainnet",
      version_id: "v1",
      abi_hash: "0xabi",
      source_fingerprint: "0xfingerprint",
      function_signature: "transfer(address,uint256)",
      selector: "0xa9059cbb",
      argument_hash: "0xargs",
      native_value_wei: "42",
      gas_limit: null,
      max_fee_per_gas: null,
      max_priority_fee_per_gas: null,
      nonce: null,
      selected_rpc: {
        provider_config_id: "mainnet-rpc",
        endpoint_id: "primary",
        endpoint_name: "Mainnet primary [redacted_secret]",
        endpoint_summary: "[redacted_endpoint]",
        endpoint_fingerprint: "rpc-endpoint-1234abcd",
      },
      calldata: {
        selector: "0xa9059cbb",
        byte_length: 68,
        hash: "0xcalldatahash",
      },
      future_submission: {
        tx_hash: null,
        broadcasted_at: null,
        error_summary:
          "submit failed [redacted_secret] [redacted_secret] [redacted_secret] [redacted_secret]",
      },
      future_outcome: {
        state: "Confirmed",
        error_summary: "receipt failed [redacted_endpoint] [redacted_secret] next=value",
      },
      broadcast: {
        tx_hash: null,
        rpc_endpoint_summary: "[redacted_endpoint]",
        error_summary: "broadcast failed Bearer [redacted_secret]",
      },
      recovery: {
        recovery_id: null,
        last_error: "recover failed [redacted_secret]",
        replacement_tx_hash: null,
      },
    });
    expect(records[0].abi_call_metadata?.argument_summary).toEqual([
      {
        kind: "address",
        type: "address",
        value: "0x7777777777777777777777777777777777777777",
        byte_length: null,
        hash: null,
        items: [],
        fields: [],
        truncated: false,
      },
      {
        kind: "uint",
        type: "uint256",
        value: "1000000",
        byte_length: null,
        hash: null,
        items: [],
        fields: [],
        truncated: false,
      },
      {
        kind: "kind-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...[truncated]",
        type: "[redacted_payload]",
        value: "payload-summary",
        byte_length: null,
        hash: "0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd...[truncated]",
        items: [],
        fields: [],
        truncated: true,
      },
      {
        kind: "string",
        type: "string",
        value: "callback [redacted_endpoint] [redacted_secret] [redacted_secret] [redacted_secret]",
        byte_length: null,
        hash: null,
        items: [],
        fields: [],
        truncated: true,
      },
    ]);
    expect(records[0].abi_call_metadata?.warnings[0]).toMatchObject({
      code: "payable",
      message: "Requires value via [redacted_endpoint]",
    });
    expect(records[0].abi_call_metadata?.blocking_statuses[0]).toMatchObject({
      level: "blocking",
      message: "Tuple input [redacted_secret] [redacted_secret]",
    });

    const durable = JSON.stringify(records[0]);
    expect(durable).not.toContain(rawCalldata);
    expect(durable).not.toContain("rawAbi");
    expect(durable).not.toContain("canonicalParams");
    expect(durable).not.toContain("endpointFingerprintSource");
    expect(durable).not.toContain("SECRET_TOKEN");
    expect(durable).not.toContain("api_key");
    expect(durable).not.toContain("token=");
    expect(durable).not.toContain("0xabc");
    expect(durable).not.toContain("0xsigned");
    expect(durable).not.toContain("signed-secret");
    expect(durable).not.toContain("abandon abandon");
    expect(durable).not.toContain(overlongKind);
    expect(durable).not.toContain(overlongType);
    expect(durable).not.toContain(overlongHash);
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
