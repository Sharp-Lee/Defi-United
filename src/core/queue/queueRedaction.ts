import { wordlists } from "ethers";
import type { RedactedCalldataSummary } from "./queueTypes";

const HEX_SECRET_PATTERN = /0x[0-9a-fA-F]{64,}/g;
const LABELED_HEX_SECRET_PATTERN =
  /\b(?:private\s*key|raw\s*signed\s*(?:transaction|tx)|signed\s*(?:transaction|tx))\s*[:=]?\s*0x[0-9a-fA-F]{32,}/gi;
const MNEMONIC_PATTERN =
  /\b(?:abandon|ability|able|about|above|absent|absorb|abstract|absurd|abuse|access|accident)(?:\s+(?:abandon|ability|able|about|above|absent|absorb|abstract|absurd|abuse|access|accident)){5,}\b/gi;
const LABELED_MNEMONIC_PATTERN = /\b(?:mnemonic|seed\s*phrase|recovery\s*phrase)\s*[:=]?\s+(?:[a-z]+(?:\s+|$)){6,24}/gi;
const TOKEN_PATTERN = /\b(?:x-api-key|api[_-]?key|rpc[_-]?token|access[_-]?token|token|secret)\s*[:=]\s*[A-Za-z0-9._~+/=-]{6,}/gi;
const PASSWORD_PATTERN = /\b(?:password|passphrase|vault\s+password)\s*(?:[:=]|\s+is\s+|\s+)[^\s"'<>]+/gi;
const VAULT_MATERIAL_PATTERN = /"?(?:ciphertext|privateKey|mnemonic|password|salt|iv)"?\s*:\s*"[^"]*"/gi;
const SECRET_QUERY_PATTERN = /[?&][A-Za-z0-9_.~-]*(?:api|token|key|secret|password)[A-Za-z0-9_.~-]*=[^\s"'<>]+/gi;
const LOCAL_PATH_PATTERN =
  /(?:\/Users\/|\/home\/|\/var\/folders\/|\/tmp\/|\/private\/tmp\/)[A-Za-z0-9._~%!$&'()*+,;=:@/-]+/g;
const WORD_PATTERN = /[a-z]+/gi;
const BIP39_WORD_COUNTS = [24, 21, 18, 15, 12];

function isPotentialEnglishBip39Phrase(phrase: string) {
  return phrase.split(" ").every((word) => wordlists.en.getWordIndex(word) >= 0);
}

function redactValidBip39Mnemonics(value: string) {
  const words = Array.from(value.matchAll(WORD_PATTERN));
  const replacements: Array<{ start: number; end: number }> = [];

  for (let index = 0; index < words.length; index += 1) {
    for (const wordCount of BIP39_WORD_COUNTS) {
      if (index + wordCount > words.length) continue;
      const slice = words.slice(index, index + wordCount);
      const phrase = slice.map((match) => match[0].toLowerCase()).join(" ");
      if (isPotentialEnglishBip39Phrase(phrase)) {
        replacements.push({
          start: slice[0].index ?? 0,
          end: (slice[slice.length - 1].index ?? 0) + slice[slice.length - 1][0].length,
        });
        index += wordCount - 1;
        break;
      }
    }
  }

  return replacements.reduceRight(
    (redacted, replacement) =>
      `${redacted.slice(0, replacement.start)}[redacted-mnemonic]${redacted.slice(replacement.end)}`,
    value,
  );
}

export function sanitizeQueueMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return redactValidBip39Mnemonics(raw)
    .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "[redacted-bearer]")
    .replace(TOKEN_PATTERN, "[redacted-token]")
    .replace(PASSWORD_PATTERN, "[redacted-password]")
    .replace(VAULT_MATERIAL_PATTERN, "[redacted-vault-material]")
    .replace(SECRET_QUERY_PATTERN, "[redacted-query]")
    .replace(LOCAL_PATH_PATTERN, "[redacted-path]")
    .replace(LABELED_MNEMONIC_PATTERN, "[redacted-mnemonic]")
    .replace(MNEMONIC_PATTERN, "[redacted-mnemonic]")
    .replace(LABELED_HEX_SECRET_PATTERN, "[redacted-hex-secret]")
    .replace(HEX_SECRET_PATTERN, "[redacted-hex-secret]")
    .trim();
}

export function summarizeCalldata(data: string): RedactedCalldataSummary {
  const normalized = data.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
    return { selector: null, byteLength: 0, summary: "invalid calldata" };
  }

  const byteLength = (normalized.length - 2) / 2;
  if (byteLength === 0) {
    return { selector: null, byteLength: 0, summary: "empty calldata" };
  }

  const selector = byteLength >= 4 ? normalized.slice(0, 10).toLowerCase() : null;
  return {
    selector,
    byteLength,
    summary: `${selector ?? "0x"} · ${byteLength} bytes`,
  };
}

export function summarizeSignedMaterial(_rawSignedTransaction: string) {
  return "[redacted-signed-transaction]";
}
