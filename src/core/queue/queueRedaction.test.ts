import { describe, expect, it } from "vitest";
import { sanitizeQueueMessage, summarizeCalldata, summarizeSignedMaterial } from "./queueRedaction";

describe("queue redaction", () => {
  it("removes URLs, API tokens, bearer tokens, passwords, vault material, private keys, mnemonics, raw signed tx, and local paths", () => {
    const sensitive = [
      "https://rpc.example.com/project/secret-token?apiKey=abc123",
      "Authorization: Bearer eyJhbGciOiJsecret",
      "x-api-key: sk_live_1234567890",
      "password hunter2",
      "{\"ciphertext\":\"vault-ciphertext-secret\",\"iv\":\"vault-iv-secret\",\"salt\":\"vault-salt-secret\"}",
      "private key 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "mnemonic abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      "raw signed tx 0xf86c808504a817c80082520894aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa880de0b6b3a76400008025a0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbba0cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "/Users/wukong/mylife/Defi-United/.secret/file.json",
    ].join(" ");

    const sanitized = sanitizeQueueMessage(sensitive);

    expect(sanitized).toContain("[redacted-url]");
    expect(sanitized).toContain("[redacted-bearer]");
    expect(sanitized).toContain("[redacted-token]");
    expect(sanitized).toContain("[redacted-password]");
    expect(sanitized).toContain("[redacted-vault-material]");
    expect(sanitized).toContain("[redacted-hex-secret]");
    expect(sanitized).toContain("[redacted-mnemonic]");
    expect(sanitized).toContain("[redacted-path]");
    expect(sanitized).not.toContain("secret-token");
    expect(sanitized).not.toContain("apiKey");
    expect(sanitized).not.toContain("hunter2");
    expect(sanitized).not.toContain("vault-ciphertext-secret");
    expect(sanitized).not.toContain("sk_live");
    expect(sanitized).not.toContain("abandon abandon");
    expect(sanitized).not.toContain("/Users/wukong");
    expect(sanitized).not.toMatch(/0x[0-9a-f]{64,}/i);
  });

  it("redacts unlabeled valid BIP39 mnemonic phrases", () => {
    const mnemonic = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

    const sanitized = sanitizeQueueMessage(`broadcast failed: ${mnemonic}`);

    expect(sanitized).toContain("[redacted-mnemonic]");
    expect(sanitized).not.toContain(mnemonic);
    expect(sanitized).not.toContain("zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong");
  });

  it("redacts ws and wss RPC URLs including userinfo, paths, and query secrets", () => {
    const message = [
      "connect ws://user:provider-secret@rpc.example.com/project/secret-path?apiKey=secret-query",
      "fallback wss://token:another-secret@backup.example.org/v3/provider-key?token=secret-token",
    ].join(" ");

    const sanitized = sanitizeQueueMessage(message);

    expect(sanitized).toContain("[redacted-url]");
    expect(sanitized).not.toContain("rpc.example.com");
    expect(sanitized).not.toContain("backup.example.org");
    expect(sanitized).not.toContain("provider-secret");
    expect(sanitized).not.toContain("another-secret");
    expect(sanitized).not.toContain("secret-path");
    expect(sanitized).not.toContain("provider-key");
    expect(sanitized).not.toContain("apiKey");
    expect(sanitized).not.toContain("secret-token");
  });

  it("keeps only selector and byte length for calldata summaries", () => {
    expect(summarizeCalldata("0xa9059cbb0000000000000000000000001111111111111111111111111111111111111111")).toEqual({
      byteLength: 36,
      selector: "0xa9059cbb",
      summary: "0xa9059cbb · 36 bytes",
    });
    expect(summarizeCalldata("0x")).toEqual({ byteLength: 0, selector: null, summary: "empty calldata" });
  });

  it("never exposes signed material in summaries", () => {
    const summary = summarizeSignedMaterial("0xf86c808504a817c80082520894aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    expect(summary).toBe("[redacted-signed-transaction]");
    expect(summary).not.toContain("f86c");
  });
});
