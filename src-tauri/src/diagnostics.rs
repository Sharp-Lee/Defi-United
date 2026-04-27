use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::storage::diagnostics_path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEvent {
    pub timestamp: String,
    pub level: DiagnosticLevel,
    pub category: String,
    pub source: String,
    pub event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub metadata: Map<String, Value>,
}

#[derive(Debug, Clone)]
pub struct DiagnosticEventInput {
    pub level: DiagnosticLevel,
    pub category: &'static str,
    pub source: &'static str,
    pub event: &'static str,
    pub chain_id: Option<u64>,
    pub account_index: Option<u32>,
    pub tx_hash: Option<String>,
    pub message: Option<String>,
    pub metadata: Value,
}

fn diagnostics_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn now_unix_seconds() -> Result<String, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string())
}

impl DiagnosticEvent {
    pub fn new(input: DiagnosticEventInput) -> Result<Self, String> {
        Ok(Self {
            timestamp: now_unix_seconds()?,
            level: input.level,
            category: input.category.to_string(),
            source: input.source.to_string(),
            event: input.event.to_string(),
            chain_id: input.chain_id,
            account_index: input.account_index,
            tx_hash: input
                .tx_hash
                .map(|value| sanitize_structured_tx_hash(&value)),
            message: input
                .message
                .as_deref()
                .map(sanitize_diagnostic_message)
                .filter(|value| !value.is_empty()),
            metadata: sanitize_metadata(input.metadata),
        })
    }
}

pub fn append_diagnostic_event(input: DiagnosticEventInput) {
    let Ok(event) = DiagnosticEvent::new(input) else {
        return;
    };
    let _ = append_diagnostic_event_record(&event);
}

pub fn append_diagnostic_event_record(event: &DiagnosticEvent) -> Result<(), String> {
    let path = diagnostics_path()?;
    append_diagnostic_event_to_path(&path, event)
}

pub fn append_diagnostic_event_to_path(path: &Path, event: &DiagnosticEvent) -> Result<(), String> {
    let _guard = diagnostics_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let line = serde_json::to_string(event).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    file.write_all(b"\n").map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())
}

pub fn read_diagnostic_events_from_path(path: &Path) -> Result<Vec<DiagnosticEvent>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    BufReader::new(file)
        .lines()
        .map(|line| {
            let line = line.map_err(|e| e.to_string())?;
            serde_json::from_str::<DiagnosticEvent>(&line).map_err(|e| e.to_string())
        })
        .collect()
}

pub fn sanitize_diagnostic_message(value: &str) -> String {
    let mut redact_mode = RedactMode::None;
    let mut sanitized_parts = Vec::new();
    for token in value.split_whitespace() {
        match redact_mode {
            RedactMode::None => {}
            RedactMode::Next => {
                sanitized_parts.push("[redacted]".to_string());
                redact_mode = RedactMode::None;
                continue;
            }
            RedactMode::UntilNextKeyValue => {
                if looks_like_key_value_token(token) {
                } else {
                    sanitized_parts.push("[redacted]".to_string());
                    continue;
                }
            }
        }

        let (sanitized, next_mode) = sanitize_message_token(token);
        sanitized_parts.push(sanitized);
        redact_mode = next_mode;
    }

    let mut sanitized = sanitized_parts.join(" ");
    if sanitized.len() > 800 {
        sanitized.truncate(800);
        sanitized.push_str("[truncated]");
    }
    sanitized
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RedactMode {
    None,
    Next,
    UntilNextKeyValue,
}

fn sanitize_structured_tx_hash(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join("")
}

fn sanitize_message_token(token: &str) -> (String, RedactMode) {
    if let Some(result) = sanitize_secret_key_value_token(token) {
        return result;
    }

    (sanitize_token(token), RedactMode::None)
}

fn sanitize_token(token: &str) -> String {
    let lower = token.to_ascii_lowercase();
    if let Some(index) = ["https://", "http://", "wss://", "ws://"]
        .iter()
        .filter_map(|scheme| lower.find(scheme))
        .min()
    {
        return format!("{}[redacted_url]", &token[..index]);
    }

    let trimmed = token.trim_matches(|ch: char| !ch.is_ascii_hexdigit() && ch != 'x' && ch != 'X');
    if is_long_hex_payload(trimmed) {
        return token.replace(trimmed, "[redacted_hex]");
    }

    redact_unprefixed_hex_runs(token)
}

fn sanitize_secret_key_value_token(token: &str) -> Option<(String, RedactMode)> {
    let separator = token
        .char_indices()
        .find(|(_, ch)| *ch == '=' || *ch == ':')?;
    let (separator_index, separator_char) = separator;
    let key_part = &token[..separator_index];
    let key = key_part.trim_matches(|ch: char| !is_secret_key_char(ch));
    if !is_sensitive_message_key(key) {
        return None;
    }

    let value_start = separator_index + separator_char.len_utf8();
    let value = &token[value_start..];
    if value.trim_matches(|ch| ch == '"' || ch == '\'').is_empty() {
        return Some((
            format!("{key_part}{separator_char}"),
            redact_mode_after_empty_value(key),
        ));
    }

    let leading_quote = if value.starts_with('"') {
        "\""
    } else if value.starts_with('\'') {
        "'"
    } else {
        ""
    };
    let trailing = secret_value_trailing_punctuation(value);
    let redacted = format!("{key_part}{separator_char}{leading_quote}[redacted]{trailing}");
    let next_mode = if is_multi_token_secret_key(key) {
        RedactMode::UntilNextKeyValue
    } else if is_authorization_message_key(key) {
        RedactMode::Next
    } else {
        RedactMode::None
    };
    Some((redacted, next_mode))
}

fn is_secret_key_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '-'
}

fn secret_value_trailing_punctuation(value: &str) -> &str {
    value
        .char_indices()
        .rev()
        .find(|(_, ch)| !matches!(*ch, '"' | '\'' | ',' | ';' | ')' | ']' | '}'))
        .map(|(index, ch)| &value[index + ch.len_utf8()..])
        .unwrap_or(value)
}

fn is_sensitive_message_key(key: &str) -> bool {
    is_sensitive_key_name(key)
}

fn is_authorization_message_key(key: &str) -> bool {
    matches!(normalize_key_name(key).as_str(), "authorization" | "auth")
}

fn redact_mode_after_empty_value(key: &str) -> RedactMode {
    if is_multi_token_secret_key(key) {
        RedactMode::UntilNextKeyValue
    } else {
        RedactMode::Next
    }
}

fn looks_like_key_value_token(token: &str) -> bool {
    token.contains('=') || token.contains(':')
}

fn is_long_hex_payload(value: &str) -> bool {
    let hex = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .unwrap_or(value);
    hex.len() >= 64 && hex.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn redact_unprefixed_hex_runs(value: &str) -> String {
    let mut redacted = String::with_capacity(value.len());
    let mut cursor = 0;
    let mut run_start: Option<usize> = None;

    for (index, ch) in value.char_indices() {
        if ch.is_ascii_hexdigit() {
            if run_start.is_none() {
                run_start = Some(index);
            }
            continue;
        }

        if let Some(start) = run_start.take() {
            if index - start >= 64 {
                redacted.push_str(&value[cursor..start]);
                redacted.push_str("[redacted_hex]");
                cursor = index;
            }
        }
    }

    if let Some(start) = run_start {
        if value.len() - start >= 64 {
            redacted.push_str(&value[cursor..start]);
            redacted.push_str("[redacted_hex]");
            cursor = value.len();
        }
    }

    redacted.push_str(&value[cursor..]);
    redacted
}

fn sanitize_metadata(value: Value) -> Map<String, Value> {
    match sanitize_value(value) {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

fn sanitize_value(value: Value) -> Value {
    match value {
        Value::String(value) => Value::String(sanitize_diagnostic_message(&value)),
        Value::Array(items) => Value::Array(items.into_iter().map(sanitize_value).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, value)| {
                    if is_sensitive_metadata_key(&key) {
                        (key, Value::String("[redacted]".to_string()))
                    } else {
                        (key, sanitize_value(value))
                    }
                })
                .collect(),
        ),
        other => other,
    }
}

fn is_sensitive_metadata_key(key: &str) -> bool {
    is_sensitive_key_name(key)
}

fn normalize_key_name(key: &str) -> String {
    key.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn is_sensitive_key_name(key: &str) -> bool {
    let key = normalize_key_name(key);
    key.contains("rpcurl")
        || key == "url"
        || key.contains("mnemonic")
        || key.contains("privatekey")
        || key.contains("signature")
        || key.contains("signedtx")
        || key.contains("signedtransaction")
        || key.contains("rawtx")
        || key.contains("rawtransaction")
        || key.contains("payload")
        || key.contains("apikey")
        || key.contains("accesstoken")
        || key == "token"
        || key == "authorization"
        || key == "auth"
        || key.contains("secret")
        || key == "key"
}

fn is_multi_token_secret_key(key: &str) -> bool {
    let key = normalize_key_name(key);
    key.contains("mnemonic") || key.contains("seedphrase") || key.contains("recoveryphrase")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(message: &str, metadata: Value) -> DiagnosticEvent {
        DiagnosticEvent::new(DiagnosticEventInput {
            level: DiagnosticLevel::Error,
            category: "test",
            source: "diagnostics_test",
            event: "testEvent",
            chain_id: Some(1),
            account_index: Some(0),
            tx_hash: Some("0xabc".to_string()),
            message: Some(message.to_string()),
            metadata,
        })
        .expect("event")
    }

    #[test]
    fn appends_and_reads_jsonl_events() {
        let path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-{}.jsonl",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        append_diagnostic_event_to_path(&path, &event("first", serde_json::json!({})))
            .expect("append first");
        append_diagnostic_event_to_path(&path, &event("second", serde_json::json!({})))
            .expect("append second");

        let raw = fs::read_to_string(&path).expect("read raw");
        assert_eq!(raw.lines().count(), 2);
        let events = read_diagnostic_events_from_path(&path).expect("read events");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event, "testEvent");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn sanitizes_sensitive_messages_and_metadata() {
        let raw_tx = format!("0x{}", "a".repeat(180));
        let unprefixed_payload = "b".repeat(128);
        let unprefixed_private_key = "c".repeat(64);
        let api_key = "sk_live_secret";
        let token = "secret-token";
        let bearer = "bearer-secret";
        let private_key = "not-hex-private-key";
        let signature = "sig-secret";
        let raw_tx_value = "raw-signed-transaction";
        let mnemonic_word = "abandon";
        let event = event(
            &format!(
                "failed at endpoint=\"https://key.example/rpc?token=secret\" api_key={api_key} token: {token} Authorization=Bearer {bearer} private_key={private_key} mnemonic: {mnemonic_word} {mnemonic_word} next=value signature={signature} rawTx={raw_tx_value} with {raw_tx} payload={unprefixed_payload} key={unprefixed_private_key}"
            ),
            serde_json::json!({
                "rpcUrl": "https://key.example/rpc?token=secret",
                "privateKey": "0xsecret",
                "signature": raw_tx,
                "nested": {
                    "message": "see http://localhost:8545",
                    "rawPayload": raw_tx,
                }
            }),
        );
        let serialized = serde_json::to_string(&event).expect("serialize");

        assert!(!serialized.contains("key.example"));
        assert!(!serialized.contains("token=secret"));
        assert!(!serialized.contains(&"a".repeat(80)));
        assert!(!serialized.contains(&unprefixed_payload));
        assert!(!serialized.contains(&unprefixed_private_key));
        assert!(!serialized.contains(api_key));
        assert!(!serialized.contains(token));
        assert!(!serialized.contains(bearer));
        assert!(!serialized.contains(private_key));
        assert!(!serialized.contains(signature));
        assert!(!serialized.contains(raw_tx_value));
        assert!(!serialized.contains(&format!("mnemonic: {mnemonic_word}")));
        assert!(serialized.contains("api_key=[redacted]"));
        assert!(serialized.contains("token: [redacted]"));
        assert!(serialized.contains("Authorization=[redacted] [redacted]"));
        assert!(serialized.contains("private_key=[redacted]"));
        assert!(serialized.contains("mnemonic: [redacted] [redacted] next=value"));
        assert!(serialized.contains("signature=[redacted]"));
        assert!(serialized.contains("rawTx=[redacted]"));
        assert!(serialized.contains("[redacted_url]"));
        assert!(serialized.contains("[redacted_hex]"));
        assert!(serialized.contains("[redacted]"));
    }

    #[test]
    fn preserves_structured_tx_hash_while_redacting_long_hex_messages() {
        let tx_hash = format!("0x{}", "d".repeat(64));
        let raw_payload = format!("0x{}", "e".repeat(180));
        let event = DiagnosticEvent::new(DiagnosticEventInput {
            level: DiagnosticLevel::Error,
            category: "test",
            source: "diagnostics_test",
            event: "testEvent",
            chain_id: Some(1),
            account_index: Some(0),
            tx_hash: Some(format!(" {tx_hash}\n")),
            message: Some(format!("blob {raw_payload}")),
            metadata: serde_json::json!({}),
        })
        .expect("event");
        let serialized = serde_json::to_string(&event).expect("serialize");

        assert_eq!(event.tx_hash.as_deref(), Some(tx_hash.as_str()));
        assert!(serialized.contains(&tx_hash));
        assert!(!serialized.contains(&raw_payload));
        assert!(event.message.as_deref().unwrap().contains("[redacted_hex]"));
    }

    #[test]
    fn redacts_mnemonic_value_tail_until_next_key_value_token() {
        let event = event(
            "failed mnemonic=abandon abandon abandon next=value",
            serde_json::json!({}),
        );
        let message = event.message.expect("message");

        assert!(!message.contains("abandon"));
        assert!(message.contains("mnemonic=[redacted] [redacted] [redacted]"));
        assert!(message.contains("next=value"));
    }
}
