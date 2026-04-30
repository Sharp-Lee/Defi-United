import type {
  HotContractAnalysisReadModel,
  HotContractSourceStatus,
} from "../../lib/tauri";

function titleCaseCode(code: string) {
  return code
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

export function percentFromBps(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

export function sourceStatusLabel(name: string, value: HotContractSourceStatus) {
  const label = name === "chainId" ? "Chain ID" : titleCaseCode(name);
  return `${label}: ${value.status}${
    value.reason ? ` (${compactBoundedHotContractText(value.reason)})` : ""
  }`;
}

export function uncertaintyLabel(code: string) {
  switch (code) {
    case "sampledOnly":
      return "Sampled only";
    case "sourceMissing":
      return "Source missing";
    case "rpcOnlyLimited":
      return "RPC-only limited";
    case "proxyImplementationUncertainty":
      return "Proxy implementation uncertainty";
    case "staleAbi":
      return "Stale ABI";
    case "unverifiedAbi":
      return "Unverified ABI";
    case "selectorConflict":
      return "Selector conflict";
    case "unknownSelector":
      return "Unknown selector";
    case "eventDecodeConflict":
      return "Event decode conflict";
    default:
      return titleCaseCode(code);
  }
}

export function hotContractStatusTitle(model: HotContractAnalysisReadModel) {
  if (
    model.rpc.chainStatus.toLowerCase().includes("mismatch") ||
    (model.rpc.actualChainId !== null &&
      model.rpc.actualChainId !== undefined &&
      model.rpc.actualChainId !== model.rpc.expectedChainId)
  ) {
    return "Chain/RPC mismatch";
  }
  if (model.sources.source.status === "notConfigured" || model.sources.source.status === "missing") {
    return "Source missing";
  }
  if (
    model.status === "limited" ||
    model.sampleCoverage.sourceStatus === "limited" ||
    model.sources.source.status === "limited"
  ) {
    return "RPC-only limited analysis";
  }
  if (model.status === "sourceUnavailable" || model.sources.source.status !== "ok") {
    return "Source unavailable";
  }
  if (model.code.status !== "ok" && model.code.status !== "contract") return "Code unavailable";
  return "Analysis ready";
}

export function compactHotContractError(err: unknown) {
  return compactHotContractText(err instanceof Error ? err.message : String(err));
}

const RAW_BODY_MARKERS = [
  "provider raw response body",
  "providerRawResponseBody",
  "provider raw response",
  "providerRawResponse",
  "raw provider body",
  "rawProviderBody",
  "provider raw body",
  "providerRawBody",
  "source raw response body",
  "sourceRawResponseBody",
  "source raw response",
  "sourceRawResponse",
  "source raw body",
  "sourceRawBody",
  "raw source body",
  "rawSourceBody",
  "raw response body",
  "response body",
  "raw body",
].sort((left, right) => right.length - left.length);

function redactRawBodyPayloads(value: string) {
  let redacted = "";
  let cursor = 0;

  while (cursor < value.length) {
    const match = findNextRawBodyPayload(value, cursor);
    if (!match) {
      redacted += value.slice(cursor);
      break;
    }
    redacted += value.slice(cursor, match.start);
    redacted += "[redacted_body]";
    cursor = match.end;
  }

  return redacted;
}

function findNextRawBodyPayload(value: string, cursor: number) {
  for (let index = cursor; index < value.length; index += 1) {
    if (index > 0 && /[A-Za-z0-9_]/.test(value[index - 1])) continue;

    for (const marker of RAW_BODY_MARKERS) {
      if (!startsWithCaseInsensitive(value, marker, index)) continue;

      const markerEnd = index + marker.length;
      if (/[A-Za-z0-9_]/.test(value[markerEnd] ?? "")) continue;

      const valueStart = rawBodyValueStart(value, markerEnd);
      if (valueStart === null) continue;

      return {
        start: index,
        end: rawBodyValueEnd(value, valueStart),
      };
    }
  }

  return null;
}

function startsWithCaseInsensitive(value: string, expected: string, index: number) {
  return value.slice(index, index + expected.length).toLowerCase() === expected.toLowerCase();
}

function rawBodyValueStart(value: string, markerEnd: number) {
  let cursor = markerEnd;
  while (/\s/.test(value[cursor] ?? "")) cursor += 1;

  if (value[cursor] === ":" || value[cursor] === "=") {
    cursor += 1;
    while (/\s/.test(value[cursor] ?? "")) cursor += 1;
    return cursor;
  }

  return cursor > markerEnd ? cursor : null;
}

function rawBodyValueEnd(value: string, valueStart: number) {
  const first = value[valueStart];
  if (first === "{" || first === "[") {
    return balancedRawBodyEnd(value, valueStart) ?? value.length;
  }

  const delimiter = value.slice(valueStart).search(/;/);
  return delimiter === -1 ? value.length : valueStart + delimiter;
}

function balancedRawBodyEnd(value: string, valueStart: number) {
  const stack: string[] = [];
  let quote: string | null = null;
  let escaped = false;

  for (let index = valueStart; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.pop() !== expected) return null;
      if (stack.length === 0) return index + 1;
    }
  }

  return null;
}

export function compactHotContractText(value: unknown) {
  return redactRawBodyPayloads(String(value))
    .replace(/\b(?:https?|wss?):\/\/\S+/gi, "[redacted_url]")
    .replace(
      /(^|[\s([{:;=])(?:[A-Za-z0-9._~%!$&'()*+,;=-]+:[A-Za-z0-9._~%!$&'()*+,;=-]*@)(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s,;)]*)?/gi,
      "$1[redacted_url]",
    )
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s,;)]*)?/gi, "[redacted_url]")
    .replace(/\bAuthorization\s*:\s*(?:Bearer|Basic)?\s*[A-Za-z0-9._~+/=-]+/gi, "[redacted_auth]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[redacted_auth]")
    .replace(
      /(["']?)(sourceApiKey|sourceQueryToken|queryToken|source[_-]?api[_-]?key|source[_-]?query[_-]?token|query[_-]?token|api[_-]?key|apikey|token|auth|authorization|password|secret)\1(\s*:\s*)(["'])[^"']+\4/gi,
      "$1$2$1$3$4[redacted]$4",
    )
    .replace(
      /\b(sourceApiKey|sourceQueryToken|queryToken|source[_-]?api[_-]?key|source[_-]?query[_-]?token|query[_-]?token|api[_-]?key|apikey|token|auth|authorization|password|secret)(\s*[:=]\s*)(["']?)[^"',}\s]+/gi,
      "$1$2$3[redacted]",
    )
    .replace(/\b0x[a-f0-9]{132,}\b/gi, "[redacted_hex_payload]")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactBoundedHotContractText(value: unknown, maxLength = 120) {
  const raw = String(value);
  const compact = compactHotContractText(raw);
  if (compact.length <= maxLength && raw.length <= maxLength) return compact;
  const suffix = "...";
  if (maxLength <= suffix.length) return suffix.slice(0, maxLength);
  const bounded = compact.length > maxLength - suffix.length
    ? compact.slice(0, maxLength - suffix.length)
    : compact;
  return `${bounded}${suffix}`;
}

export function buildHotContractCopySummary(
  model: HotContractAnalysisReadModel,
  endpointSummary: string,
  seedTxHash?: string | null,
) {
  const provenanceSeedTxHash = seedTxHash ?? model.seedTxHash ?? null;
  const selectorLines = model.analysis.selectors.slice(0, 5).map(
    (selector) =>
      `selector=${selector.selector} count=${selector.sampledCallCount} share=${percentFromBps(
        selector.sampleShareBps,
      )}`,
  );
  const topicLines = model.analysis.topics.slice(0, 5).map(
    (topic) =>
      `topic=${topic.topic} count=${topic.logCount} share=${percentFromBps(topic.sampleShareBps)}`,
  );
  return [
    `contract=${model.contract.address}`,
    `chainId=${model.chainId}`,
    `rpc=${endpointSummary}`,
    `status=${hotContractStatusTitle(model)}`,
    provenanceSeedTxHash
      ? `seedTxHash=${compactBoundedHotContractText(provenanceSeedTxHash)}`
      : null,
    `samples=${model.sampleCoverage.returnedSamples}/${model.sampleCoverage.requestedLimit}`,
    `omitted=${model.sampleCoverage.omittedSamples}`,
    model.code.codeHash ? `codeHash=${model.code.codeHash}` : null,
    model.errorSummary ? `error=${compactHotContractText(model.errorSummary)}` : null,
    ...selectorLines,
    ...topicLines,
  ]
    .filter(Boolean)
    .join("\n");
}
