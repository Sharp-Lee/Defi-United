import { describe, expect, it } from "vitest";
import type { HotContractAnalysisReadModel } from "../../lib/tauri";
import {
  buildHotContractCopySummary,
  compactHotContractText,
  hotContractStatusTitle,
  sourceStatusLabel,
  uncertaintyLabel,
} from "./readModel";

const address = "0x1111111111111111111111111111111111111111";

function status(status = "ok", reason: string | null = null) {
  return { status, reason, errorSummary: null };
}

function model(): HotContractAnalysisReadModel {
  return {
    status: "ok",
    reasons: [],
    chainId: 1,
    contract: { address },
    rpc: {
      endpoint: "https://rpc.example.invalid/private/path?apikey=secret",
      expectedChainId: 1,
      actualChainId: 1,
      chainStatus: "matched",
    },
    code: {
      status: "contract",
      blockTag: "latest",
      byteLength: 2048,
      codeHashVersion: "keccak256-v1",
      codeHash: "0xcodehash",
      errorSummary: null,
    },
    sources: {
      chainId: status("ok"),
      code: status("ok"),
      source: status("limited", "provider returned bounded sample only"),
    },
    sampleCoverage: {
      requestedLimit: 25,
      returnedSamples: 3,
      omittedSamples: 2,
      sourceStatus: "limited",
    },
    samples: [
      {
        chainId: 1,
        contractAddress: address,
        txHash: `0x${"a".repeat(64)}`,
        blockTime: "2026-04-30T00:00:00Z",
        from: "0x2222222222222222222222222222222222222222",
        to: address,
        value: "0",
        status: "success",
        selector: "0xa9059cbb",
        approveAmountIsZero: false,
        calldataLength: 68,
        calldataHash: "0xcalldatahash",
        logTopic0: ["0xddf252ad"],
        providerLabel: "Sample provider",
        blockNumber: 123,
      },
    ],
    analysis: {
      selectors: [
        {
          selector: "0xa9059cbb",
          sampledCallCount: 3,
          sampleShareBps: 6000,
          uniqueSenderCount: 2,
          successCount: 2,
          revertCount: 1,
          unknownStatusCount: 0,
          firstBlock: 100,
          lastBlock: 123,
          firstBlockTime: null,
          lastBlockTime: null,
          nativeValue: {
            sampleCount: 3,
            nonZeroCount: 0,
            zeroCount: 3,
            totalWei: "0",
          },
          exampleTxHashes: [`0x${"a".repeat(64)}`],
          source: "providerSample",
          confidence: "candidate",
          advisoryLabels: ["ERC-20 transfer candidate"],
        },
      ],
      topics: [
        {
          topic: "0xddf252ad",
          logCount: 3,
          sampleShareBps: 5000,
          firstBlock: 100,
          lastBlock: 123,
          firstBlockTime: null,
          lastBlockTime: null,
          exampleTxHashes: [`0x${"b".repeat(64)}`],
          source: "providerSample",
          confidence: "candidate",
          advisoryLabels: ["Transfer event candidate"],
        },
      ],
    },
    decode: {
      status: "partial",
      items: [],
      abiSources: [
        {
          contractAddress: address,
          sourceKind: "userImported",
          providerConfigId: null,
          userSourceId: "safe-source",
          versionId: "v1",
          selected: true,
          fetchSourceStatus: "ok",
          validationStatus: "ok",
          cacheStatus: "cacheFresh",
          selectionStatus: "selected",
          artifactStatus: "available",
          proxyDetected: false,
          providerProxyHint: null,
          errorSummary: null,
        },
      ],
      classificationCandidates: [],
      uncertaintyStatuses: [
        {
          code: "sampledOnly",
          severity: "warning",
          source: "providerSample",
          summary: "Only bounded samples were available.",
        },
      ],
    },
    errorSummary: null,
  };
}

describe("hot contract read model", () => {
  it("labels status boundaries and uncertainty codes", () => {
    expect(hotContractStatusTitle(model())).toBe("RPC-only limited analysis");
    expect(sourceStatusLabel("source", model().sources.source)).toBe(
      "Source: limited (provider returned bounded sample only)",
    );
    expect(uncertaintyLabel("proxyImplementationUncertainty")).toBe(
      "Proxy implementation uncertainty",
    );
    expect(uncertaintyLabel("sampledOnly")).toBe("Sampled only");
  });

  it("labels unavailable source states before reporting analysis ready", () => {
    for (const sourceStatus of ["rateLimited", "disabled", "wrongChain", "stale", "unsupported"]) {
      expect(
        hotContractStatusTitle({
          ...model(),
          status: "ok",
          sources: {
            ...model().sources,
            source: status(sourceStatus, "source unavailable"),
          },
          sampleCoverage: {
            ...model().sampleCoverage,
            sourceStatus,
          },
        }),
      ).toBe("Source unavailable");
    }

    expect(
      hotContractStatusTitle({
        ...model(),
        status: "sourceUnavailable",
        sources: {
          ...model().sources,
          source: status("ok"),
        },
        sampleCoverage: {
          ...model().sampleCoverage,
          sourceStatus: "ok",
        },
      }),
    ).toBe("Source unavailable");
  });

  it("redacts malicious source status reasons", () => {
    const calldata = `0x${"a".repeat(256)}`;
    const reason = [
      "provider failed at https://user:password@api.example.invalid/v1?apikey=secret-api-key",
      "Authorization: Bearer secret-token-value",
      `calldata=${calldata}`,
      "raw body={\"apiKey\":\"secret-json-key\",\"url\":\"https://secret.example.invalid/path\"}",
    ].join(" ");

    const label = sourceStatusLabel("source", {
      status: "limited",
      reason,
      errorSummary: null,
    });

    expect(label).toContain("Source: limited (");
    expect(label).toContain("[redacted_url]");
    expect(label).toContain("[redacted_auth]");
    expect(label).toContain("[redacted_hex_payload]");
    expect(label).toContain("[redacted_body]");
    expect(label.toLowerCase()).not.toContain("raw body");
    expect(label).not.toContain("{\"apiKey\"");
    expect(label).not.toContain("\"url\"");
    expect(label).not.toContain("secret-api-key");
    expect(label).not.toContain("secret-token-value");
    expect(label).not.toContain("secret-json-key");
    expect(label).not.toContain("secret.example.invalid");
    expect(label).not.toContain(calldata);
  });

  it("builds a bounded secret-safe copy summary", () => {
    const seedTxHash = `0x${"c".repeat(64)}`;
    const seededModel = { ...model(), seedTxHash } as HotContractAnalysisReadModel;
    const summary = buildHotContractCopySummary(
      seededModel,
      "https://rpc.example.invalid",
    );

    expect(summary).toContain(`contract=${address}`);
    expect(summary).toContain("chainId=1");
    expect(summary).toContain(`seedTxHash=${seedTxHash}`);
    expect(summary).toContain("selector=0xa9059cbb count=3 share=60.00%");
    expect(summary).toContain("topic=0xddf252ad count=3 share=50.00%");
    expect(summary).toContain("codeHash=0xcodehash");
    expect(summary).not.toContain("apikey");
    expect(summary).not.toContain("secret");
    expect(summary).not.toContain("calldata=");
    expect(summary).not.toContain("logs=");

    expect(
      buildHotContractCopySummary(model(), "https://rpc.example.invalid", seedTxHash),
    ).toContain(`seedTxHash=${seedTxHash}`);
  });

  it("redacts URLs, credentials, raw bodies, and full calldata from hot contract text", () => {
    const calldata = `0x${"a".repeat(256)}`;
    const text = [
      "provider failed: https://user:password@api.example.invalid/v1?apikey=secret-api-key",
      "Authorization: Bearer secret-token-value",
      `calldata=${calldata}`,
      "raw body={\"apiKey\":\"secret-json-key\",\"url\":\"https://secret.example.invalid/path\"}",
    ].join(" ");

    const compact = compactHotContractText(text);

    expect(compact).toContain("[redacted_url]");
    expect(compact).toContain("[redacted_auth]");
    expect(compact).toContain("[redacted_hex_payload]");
    expect(compact).toContain("[redacted_body]");
    expect(compact.toLowerCase()).not.toContain("raw body");
    expect(compact).not.toContain("{\"apiKey\"");
    expect(compact).not.toContain("\"url\"");
    expect(compact).not.toContain("secret-api-key");
    expect(compact).not.toContain("secret-token-value");
    expect(compact).not.toContain("secret-json-key");
    expect(compact).not.toContain("secret.example.invalid");
    expect(compact).not.toContain(calldata);
  });

  it("compacts provider response body fragments without preserving raw structure", () => {
    const compact = compactHotContractText(
      "fetch failed; response body: {\"message\":\"NOTOK\",\"result\":\"Invalid API Key\",\"status\":\"0\"}; retry later",
    );

    expect(compact).toContain("[redacted_body]");
    expect(compact.toLowerCase()).not.toContain("response body");
    expect(compact).not.toContain("\"message\"");
    expect(compact).not.toContain("\"result\"");
    expect(compact).not.toContain("Invalid API Key");
    expect(compact).toContain("retry later");
  });

  it("compacts provider raw response variants without preserving raw structure", () => {
    const compact = compactHotContractText(
      [
        "provider raw response: {\"apiKey\":\"secret-provider-key\",\"result\":\"private body\"};",
        "providerRawResponse={\"token\":\"secret-query-token\",\"items\":[{\"note\":\"private note\"}]};",
        "providerRawResponse: {\"auth\":\"secret-auth-token\",\"status\":\"0\"};",
        "providerRawResponseBody={\"details\":\"secret response body detail\"};",
        "retry later",
      ].join(" "),
    );

    expect(compact.match(/\[redacted_body\]/g)?.length).toBe(4);
    expect(compact).toContain("retry later");
    expect(compact.toLowerCase()).not.toContain("provider raw response");
    expect(compact).not.toContain("providerRawResponse");
    expect(compact).not.toContain("providerRawResponseBody");
    expect(compact).not.toContain("\"apiKey\"");
    expect(compact).not.toContain("\"token\"");
    expect(compact).not.toContain("\"items\"");
    expect(compact).not.toContain("\"auth\"");
    expect(compact).not.toContain("\"details\"");
    expect(compact).not.toContain("secret-provider-key");
    expect(compact).not.toContain("secret-query-token");
    expect(compact).not.toContain("secret-auth-token");
    expect(compact).not.toContain("secret response body detail");
    expect(compact).not.toContain("private note");
  });

  it("compacts quote-aware provider raw response body payloads", () => {
    const compact = compactHotContractText(
      'providerRawResponseBody={"message":"contains }; inside","after":"SECRET_AFTER"}; retry later',
    );

    expect(compact).toContain("[redacted_body]");
    expect(compact).toContain("retry later");
    expect(compact).not.toContain("providerRawResponseBody");
    expect(compact).not.toContain("SECRET_AFTER");
  });

  it("compacts provider raw response text with internal periods", () => {
    const compact = compactHotContractText(
      "providerRawResponse=label=first. privateLabel=period-hidden-label; retry later",
    );

    expect(compact).toContain("[redacted_body]");
    expect(compact).toContain("retry later");
    expect(compact).not.toContain("providerRawResponse");
    expect(compact).not.toContain("period-hidden-label");
  });

  it("compacts raw provider body text variants and query tokens", () => {
    const compact = compactHotContractText(
      [
        "provider raw response body api_key=provider-secret queryToken=query-secret label=hidden-label;",
        "raw provider body sourceQueryToken=source-secret details=hidden-details;",
        "retry later",
      ].join(" "),
    );

    expect(compact.match(/\[redacted_body\]/g)?.length).toBe(2);
    expect(compact).toContain("retry later");
    expect(compact.toLowerCase()).not.toContain("provider raw response body");
    expect(compact.toLowerCase()).not.toContain("raw provider body");
    expect(compact).not.toContain("provider-secret");
    expect(compact).not.toContain("query-secret");
    expect(compact).not.toContain("source-secret");
    expect(compact).not.toContain("hidden-label");
    expect(compact).not.toContain("hidden-details");
  });

  it("compacts source raw body aliases without preserving raw structure", () => {
    const compact = compactHotContractText(
      [
        "sourceRawBody={\"apiKey\":\"source-body-key\",\"note\":\"source body private note\"};",
        "rawSourceBody=[{\"token\":\"raw-source-token\",\"label\":\"raw source private label\"}];",
        'sourceRawResponseBody={"message":"contains }; inside","after":"SOURCE_RESPONSE_AFTER"};',
        "source raw body: {\"label\":\"spaced source body label\"};",
        "raw source body: [{\"label\":\"spaced raw source body label\"}];",
        "source raw response body label=source-hidden-label; safeSourceAlias=value",
      ].join(" "),
    );

    expect(compact.match(/\[redacted_body\]/g)?.length).toBe(6);
    expect(compact).toContain("safeSourceAlias=value");
    expect(compact).not.toContain("sourceRawBody");
    expect(compact).not.toContain("rawSourceBody");
    expect(compact).not.toContain("sourceRawResponseBody");
    expect(compact.toLowerCase()).not.toContain("source raw body");
    expect(compact.toLowerCase()).not.toContain("raw source body");
    expect(compact.toLowerCase()).not.toContain("source raw response body");
    expect(compact).not.toContain("source-body-key");
    expect(compact).not.toContain("source body private note");
    expect(compact).not.toContain("raw-source-token");
    expect(compact).not.toContain("raw source private label");
    expect(compact).not.toContain("SOURCE_RESPONSE_AFTER");
    expect(compact).not.toContain("spaced source body label");
    expect(compact).not.toContain("spaced raw source body label");
    expect(compact).not.toContain("source-hidden-label");
  });

  it("redacts bare provider host paths in compact text", () => {
    const compact = compactHotContractText(
      "provider failed at api.example.invalid/v1/account retry later",
    );

    expect(compact).toContain("[redacted_url]");
    expect(compact).toContain("retry later");
    expect(compact).not.toContain("api.example.invalid");
  });

  it("redacts websocket and userinfo endpoint credentials in compact text", () => {
    const compact = compactHotContractText(
      [
        "provider failed at wss://user:pass@api.example.invalid/rpc",
        "fallback user:pass@api.example.invalid/rpc?token=secret",
        "retry later",
      ].join(" "),
    );

    expect(compact).toContain("[redacted_url]");
    expect(compact).toContain("retry later");
    for (const secret of [
      "user",
      "pass",
      "api.example.invalid",
      "token=secret",
      "/rpc",
    ]) {
      expect(compact).not.toContain(secret);
    }
  });
});
