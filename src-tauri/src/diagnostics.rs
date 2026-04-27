use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::storage::{diagnostics_path, ensure_app_dir, write_new_file_atomic};

pub const DEFAULT_RECENT_DIAGNOSTIC_EVENT_LIMIT: usize = 200;
const MAX_DIAGNOSTIC_EVENT_LIMIT: usize = 1_000;

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEventQuery {
    pub limit: Option<usize>,
    pub category: Option<String>,
    pub since_timestamp: Option<u64>,
    pub until_timestamp: Option<u64>,
    pub chain_id: Option<u64>,
    pub account: Option<String>,
    pub tx_hash: Option<String>,
    pub level: Option<DiagnosticLevel>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExportScope {
    pub limit: usize,
    pub category: Option<String>,
    pub since_timestamp: Option<u64>,
    pub until_timestamp: Option<u64>,
    pub chain_id: Option<u64>,
    pub account: Option<String>,
    pub tx_hash: Option<String>,
    pub level: Option<DiagnosticLevel>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExportResult {
    pub path: String,
    pub count: usize,
    pub scope: DiagnosticExportScope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticExportFile {
    exported_at: String,
    event_count: usize,
    scope: DiagnosticExportScope,
    sensitive_information_excluded: Vec<&'static str>,
    note: &'static str,
    events: Vec<DiagnosticEvent>,
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
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "Unable to read diagnostics log at {}: {error}",
                path.display()
            ))
        }
    };

    BufReader::new(file)
        .lines()
        .enumerate()
        .map(|(index, line)| {
            let line = line.map_err(|e| {
                format!(
                    "Unable to read diagnostics log at {} line {}: {e}",
                    path.display(),
                    index + 1
                )
            })?;
            serde_json::from_str::<DiagnosticEvent>(&line)
                .map(sanitize_loaded_diagnostic_event)
                .map_err(|e| {
                    format!(
                        "Diagnostics log at {} has invalid JSON on line {}: {e}",
                        path.display(),
                        index + 1
                    )
                })
        })
        .collect()
}

pub fn load_recent_diagnostic_events(
    query: DiagnosticEventQuery,
) -> Result<Vec<DiagnosticEvent>, String> {
    load_recent_diagnostic_events_from_path(&diagnostics_path()?, query)
}

pub fn load_recent_diagnostic_events_from_path(
    path: &Path,
    query: DiagnosticEventQuery,
) -> Result<Vec<DiagnosticEvent>, String> {
    let scope = export_scope_from_query(&query);
    let mut events = read_diagnostic_events_from_path(path)?;
    events.retain(|event| diagnostic_event_matches_query(event, &scope));
    events.sort_by(|left, right| {
        diagnostic_event_timestamp_millis(right)
            .cmp(&diagnostic_event_timestamp_millis(left))
            .then_with(|| right.timestamp.cmp(&left.timestamp))
    });
    events.truncate(scope.limit);
    Ok(events)
}

pub fn export_diagnostic_events(
    query: DiagnosticEventQuery,
) -> Result<DiagnosticExportResult, String> {
    let dir = ensure_app_dir()?;
    let path = diagnostic_export_path(&dir)?;
    export_diagnostic_events_to_path(&diagnostics_path()?, &path, query)
}

pub fn export_diagnostic_events_to_path(
    diagnostics_source_path: &Path,
    export_path: &Path,
    query: DiagnosticEventQuery,
) -> Result<DiagnosticExportResult, String> {
    let scope = export_scope_from_query(&query);
    let events = load_recent_diagnostic_events_from_path(
        diagnostics_source_path,
        DiagnosticEventQuery {
            limit: Some(scope.limit),
            category: scope.category.clone(),
            since_timestamp: scope.since_timestamp,
            until_timestamp: scope.until_timestamp,
            chain_id: scope.chain_id,
            account: scope.account.clone(),
            tx_hash: scope.tx_hash.clone(),
            level: scope.level.clone(),
            status: scope.status.clone(),
        },
    )?;
    let export = DiagnosticExportFile {
        exported_at: now_unix_seconds()?,
        event_count: events.len(),
        scope: scope.clone(),
        sensitive_information_excluded: vec![
            "mnemonic",
            "privateKey",
            "seed",
            "password",
            "signatureMaterial",
            "rawSignedTransaction",
            "fullRpcCredential",
        ],
        note: "Diagnostics events are local troubleshooting metadata only. They are not chain confirmation facts.",
        events,
    };
    let raw = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    write_new_file_atomic(export_path, &raw).map_err(|e| {
        format!(
            "Unable to export diagnostics to {}: {e}",
            export_path.display()
        )
    })?;
    Ok(DiagnosticExportResult {
        path: export_path.display().to_string(),
        count: export.event_count,
        scope,
    })
}

fn diagnostic_export_path(dir: &Path) -> Result<PathBuf, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(dir.join(format!(
        "diagnostics-export-{}-{:09}.json",
        duration.as_secs(),
        duration.subsec_nanos()
    )))
}

fn export_scope_from_query(query: &DiagnosticEventQuery) -> DiagnosticExportScope {
    DiagnosticExportScope {
        limit: query
            .limit
            .unwrap_or(DEFAULT_RECENT_DIAGNOSTIC_EVENT_LIMIT)
            .clamp(1, MAX_DIAGNOSTIC_EVENT_LIMIT),
        category: sanitized_scope_text_filter(query.category.as_deref()),
        since_timestamp: query.since_timestamp,
        until_timestamp: query.until_timestamp,
        chain_id: query.chain_id,
        account: sanitized_scope_text_filter(query.account.as_deref()),
        tx_hash: sanitized_scope_tx_hash_filter(query.tx_hash.as_deref()),
        level: query.level.clone(),
        status: sanitized_scope_text_filter(query.status.as_deref()),
    }
}

fn normalized_filter(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn sanitized_scope_text_filter(value: Option<&str>) -> Option<String> {
    normalized_filter(value).and_then(|value| {
        if is_suspicious_scope_text(&value) {
            return Some("[redacted]".to_string());
        }

        let minimized = minimize_safe_scope_filter_text(&value);
        if minimized.is_empty() {
            None
        } else {
            Some(minimized)
        }
    })
}

fn sanitized_scope_tx_hash_filter(value: Option<&str>) -> Option<String> {
    normalized_filter(value).and_then(|value| {
        if is_suspicious_scope_text(&value) {
            return Some("[redacted]".to_string());
        }

        let compact = sanitize_structured_tx_hash(&value);
        if is_full_tx_hash(&compact) || is_safe_tx_hash_fragment(&compact) {
            return Some(compact);
        }

        Some("[redacted]".to_string())
    })
}

fn is_full_tx_hash(value: &str) -> bool {
    value.len() == 66
        && value.starts_with("0x")
        && value[2..].chars().all(|ch| ch.is_ascii_hexdigit())
}

fn is_safe_tx_hash_fragment(value: &str) -> bool {
    (3..=18).contains(&value.len())
        && value
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() || ch == 'x' || ch == 'X')
}

fn is_suspicious_scope_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("://")
        || lower.contains('@')
        || lower.contains('?')
        || lower.contains("token=")
        || lower.contains("password")
        || lower.contains("seed")
        || lower.contains("mnemonic")
        || lower.contains("private")
        || lower.contains("signature")
        || lower.contains("secret")
        || lower.contains("authorization")
        || lower.contains("bearer")
        || lower.contains("basic ")
        || lower.contains("auth")
        || lower.contains("key=")
        || lower.contains("api_key")
        || lower.contains("apikey")
        || lower.contains("access_token")
        || lower.contains("accesstoken")
        || lower.contains("signedtx")
        || lower.contains("signed transaction")
        || lower.contains("rawtx")
        || lower.contains("raw transaction")
}

fn minimize_safe_scope_filter_text(value: &str) -> String {
    let mut minimized = String::new();
    let mut previous_space = false;
    for ch in value.chars() {
        let next = if ch.is_ascii_alphanumeric() {
            Some(ch)
        } else if matches!(ch, ' ' | '_' | '-' | '.' | ':' | '#' | '*') {
            Some(ch)
        } else {
            None
        };

        let Some(ch) = next else {
            continue;
        };
        if ch.is_whitespace() {
            if previous_space {
                continue;
            }
            previous_space = true;
            minimized.push(' ');
        } else {
            previous_space = false;
            minimized.push(ch);
        }
        if minimized.len() >= 80 {
            minimized.truncate(80);
            minimized.push_str("[truncated]");
            break;
        }
    }

    minimized.trim().to_string()
}

fn sanitize_loaded_diagnostic_event(event: DiagnosticEvent) -> DiagnosticEvent {
    DiagnosticEvent {
        timestamp: sanitize_diagnostic_message(&event.timestamp),
        level: event.level,
        category: sanitize_diagnostic_message(&event.category),
        source: sanitize_diagnostic_message(&event.source),
        event: sanitize_diagnostic_message(&event.event),
        chain_id: event.chain_id,
        account_index: event.account_index,
        tx_hash: event
            .tx_hash
            .map(|value| sanitize_structured_tx_hash(&value)),
        message: event
            .message
            .as_deref()
            .map(sanitize_diagnostic_message)
            .filter(|value| !value.is_empty()),
        metadata: sanitize_metadata(Value::Object(event.metadata)),
    }
}

fn diagnostic_event_matches_query(event: &DiagnosticEvent, scope: &DiagnosticExportScope) -> bool {
    if scope
        .category
        .as_ref()
        .is_some_and(|category| !event.category.eq_ignore_ascii_case(category))
    {
        return false;
    }
    if scope
        .chain_id
        .is_some_and(|chain_id| event.chain_id != Some(chain_id))
    {
        return false;
    }
    if scope
        .level
        .as_ref()
        .is_some_and(|level| &event.level != level)
    {
        return false;
    }
    if scope.since_timestamp.is_some_and(|since| {
        diagnostic_event_timestamp_seconds(event).is_none_or(|timestamp| timestamp < since)
    }) {
        return false;
    }
    if scope.until_timestamp.is_some_and(|until| {
        diagnostic_event_timestamp_seconds(event).is_none_or(|timestamp| timestamp > until)
    }) {
        return false;
    }
    if scope.account.as_ref().is_some_and(|account| {
        !diagnostic_event_account_text(event).contains(&account.to_ascii_lowercase())
    }) {
        return false;
    }
    if scope.tx_hash.as_ref().is_some_and(|tx_hash| {
        !event
            .tx_hash
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase()
            .contains(&tx_hash.to_ascii_lowercase())
    }) {
        return false;
    }
    if scope.status.as_ref().is_some_and(|status| {
        !diagnostic_event_status_text(event).contains(&status.to_ascii_lowercase())
    }) {
        return false;
    }
    true
}

fn diagnostic_event_timestamp_seconds(event: &DiagnosticEvent) -> Option<u64> {
    if event.timestamp.chars().all(|ch| ch.is_ascii_digit()) {
        return event.timestamp.parse::<u64>().ok();
    }
    None
}

fn diagnostic_event_timestamp_millis(event: &DiagnosticEvent) -> u64 {
    diagnostic_event_timestamp_seconds(event).unwrap_or(0) * 1000
}

fn diagnostic_event_account_text(event: &DiagnosticEvent) -> String {
    let mut parts = Vec::new();
    if let Some(index) = event.account_index {
        parts.push(index.to_string());
        parts.push(format!("account {index}"));
    }
    collect_metadata_strings_for_keys(
        &Value::Object(event.metadata.clone()),
        &[
            "account",
            "accountIndex",
            "accountAddress",
            "address",
            "from",
            "sender",
        ],
        &mut parts,
    );
    parts.join(" ").to_ascii_lowercase()
}

fn diagnostic_event_status_text(event: &DiagnosticEvent) -> String {
    let mut parts = vec![format!("{:?}", event.level)];
    collect_metadata_strings_for_keys(
        &Value::Object(event.metadata.clone()),
        &["status", "state", "nextState", "decision", "stage"],
        &mut parts,
    );
    parts.join(" ").to_ascii_lowercase()
}

fn collect_metadata_strings_for_keys(value: &Value, keys: &[&str], output: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                if keys
                    .iter()
                    .any(|candidate| key.eq_ignore_ascii_case(candidate))
                {
                    match value {
                        Value::String(value) => output.push(value.clone()),
                        Value::Number(value) => output.push(value.to_string()),
                        Value::Bool(value) => output.push(value.to_string()),
                        _ => {}
                    }
                }
                collect_metadata_strings_for_keys(value, keys, output);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_metadata_strings_for_keys(item, keys, output);
            }
        }
        _ => {}
    }
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
            RedactMode::NextTwo => {
                sanitized_parts.push("[redacted]".to_string());
                redact_mode = RedactMode::Next;
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
    NextTwo,
    UntilNextKeyValue,
}

fn sanitize_structured_tx_hash(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join("")
}

fn sanitize_message_token(token: &str) -> (String, RedactMode) {
    if let Some(result) = sanitize_secret_key_value_token(token) {
        return result;
    }
    if is_standalone_authorization_key(token) {
        return (sanitize_token(token), RedactMode::NextTwo);
    }
    if is_standalone_auth_scheme(token) {
        return ("[redacted]".to_string(), RedactMode::Next);
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
    } else if is_authorization_message_key(key) {
        RedactMode::NextTwo
    } else {
        RedactMode::Next
    }
}

fn is_standalone_authorization_key(token: &str) -> bool {
    matches!(
        normalize_key_name(trim_auth_token_punctuation(token)).as_str(),
        "authorization" | "auth"
    )
}

fn is_standalone_auth_scheme(token: &str) -> bool {
    matches!(
        normalize_key_name(trim_auth_token_punctuation(token)).as_str(),
        "bearer" | "basic"
    )
}

fn trim_auth_token_punctuation(token: &str) -> &str {
    token.trim_matches(|ch: char| !ch.is_ascii_alphanumeric())
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
        || key.contains("seed")
        || key.contains("privatekey")
        || key.contains("password")
        || key.contains("passphrase")
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

    #[test]
    fn redacts_standalone_auth_scheme_messages_and_metadata_strings() {
        let event = event(
            "request failed Authorization Bearer message-secret Basic message-basic Bearer message-bearer next=value",
            serde_json::json!({
                "safeMessage": "metadata Authorization Bearer metadata-secret Basic metadata-basic Bearer metadata-bearer next=value",
                "nested": {
                    "details": "auth Basic nested-basic"
                }
            }),
        );
        let serialized = serde_json::to_string(&event).expect("serialize");

        assert!(!serialized.contains("message-secret"));
        assert!(!serialized.contains("message-basic"));
        assert!(!serialized.contains("message-bearer"));
        assert!(!serialized.contains("metadata-secret"));
        assert!(!serialized.contains("metadata-basic"));
        assert!(!serialized.contains("metadata-bearer"));
        assert!(!serialized.contains("nested-basic"));
        assert!(serialized.contains("Authorization [redacted] [redacted]"));
        assert!(serialized.contains("[redacted] [redacted]"));
        assert!(serialized.contains("next=value"));
    }

    #[test]
    fn missing_diagnostic_log_reads_as_empty_list() {
        let path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-missing-{}.jsonl",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);

        let events = read_diagnostic_events_from_path(&path).expect("missing is empty");

        assert!(events.is_empty());
    }

    #[test]
    fn invalid_jsonl_returns_line_number() {
        let path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-invalid-{}.jsonl",
            std::process::id()
        ));
        fs::write(&path, "{\"timestamp\":\"1700000000\"}\nnot-json\n").expect("write");

        let error = read_diagnostic_events_from_path(&path).expect_err("invalid jsonl");

        assert!(error.contains("invalid JSON"));
        assert!(error.contains("line 1") || error.contains("line 2"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn load_recent_events_sanitizes_legacy_raw_log_lines_and_filters() {
        let path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-raw-{}.jsonl",
            std::process::id()
        ));
        let raw = serde_json::json!({
            "timestamp": "1700000000",
            "level": "error",
            "category": "rpc",
            "source": "test",
            "event": "rpcFailed",
            "chainId": 1,
            "accountIndex": 2,
            "txHash": " 0xabc\n",
            "message": "failed at https://user:pass@example.invalid/rpc?token=secret mnemonic=abandon abandon next=value rawTx=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "metadata": {
                "stage": "provider",
                "nonce": 7,
                "rpcUrl": "https://example.invalid/rpc?token=secret",
                "privateKey": "0xsecret",
                "nextState": "Dropped"
            }
        });
        fs::write(&path, format!("{raw}\n")).expect("write raw");

        let events = load_recent_diagnostic_events_from_path(
            &path,
            DiagnosticEventQuery {
                category: Some("rpc".to_string()),
                chain_id: Some(1),
                account: Some("2".to_string()),
                tx_hash: Some("0xabc".to_string()),
                level: Some(DiagnosticLevel::Error),
                status: Some("Dropped".to_string()),
                ..DiagnosticEventQuery::default()
            },
        )
        .expect("load");
        let serialized = serde_json::to_string(&events).expect("serialize");

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].tx_hash.as_deref(), Some("0xabc"));
        assert!(!serialized.contains("user:pass"));
        assert!(!serialized.contains("token=secret"));
        assert!(!serialized.contains("abandon"));
        assert!(!serialized.contains("0xaaaaaaaa"));
        assert!(!serialized.contains("0xsecret"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn exports_sanitized_diagnostic_events_with_scope_note() {
        let source_path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-export-source-{}.jsonl",
            std::process::id()
        ));
        let export_path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-export-{}.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&source_path);
        let _ = fs::remove_file(&export_path);
        append_diagnostic_event_to_path(
            &source_path,
            &event(
                "failed password=hunter2 seed=secret https://example.invalid/rpc?token=secret",
                serde_json::json!({
                    "nonce": 9,
                    "stage": "broadcast",
                    "signature": "signed-secret"
                }),
            ),
        )
        .expect("append");

        let result = export_diagnostic_events_to_path(
            &source_path,
            &export_path,
            DiagnosticEventQuery {
                limit: Some(20),
                chain_id: Some(1),
                ..DiagnosticEventQuery::default()
            },
        )
        .expect("export");
        let exported = fs::read_to_string(&export_path).expect("read export");

        assert_eq!(result.count, 1);
        assert!(exported.contains("local troubleshooting metadata only"));
        assert!(exported.contains("sensitiveInformationExcluded"));
        assert!(!exported.contains("hunter2"));
        assert!(!exported.contains("seed=secret"));
        assert!(!exported.contains("token=secret"));
        assert!(!exported.contains("signed-secret"));
        let _ = fs::remove_file(source_path);
        let _ = fs::remove_file(export_path);
    }

    #[test]
    fn export_sanitizes_sensitive_scope_inputs_in_file_and_result() {
        let source_path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-export-scope-source-{}.jsonl",
            std::process::id()
        ));
        let export_path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-export-scope-{}.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&source_path);
        let _ = fs::remove_file(&export_path);
        fs::write(&source_path, "").expect("source");

        let result = export_diagnostic_events_to_path(
            &source_path,
            &export_path,
            DiagnosticEventQuery {
                category: Some(
                    "rpc https://user:pass@example.invalid/rpc?token=scope-secret".to_string(),
                ),
                account: Some("mnemonic=abandon abandon abandon next=value".to_string()),
                tx_hash: Some("seed=scope-seed private_key=scope-private-key".to_string()),
                status: Some(
                    "password=hunter2 signature=scope-signature Authorization Bearer scope-auth-token"
                        .to_string(),
                ),
                ..DiagnosticEventQuery::default()
            },
        )
        .expect("export");
        let exported = fs::read_to_string(&export_path).expect("read export");
        let returned = serde_json::to_string(&result).expect("serialize result");

        for serialized in [exported.as_str(), returned.as_str()] {
            assert!(!serialized.contains("user:pass"));
            assert!(!serialized.contains("token=scope-secret"));
            assert!(!serialized.contains("scope-secret"));
            assert!(!serialized.contains("abandon"));
            assert!(!serialized.contains("scope-seed"));
            assert!(!serialized.contains("scope-private-key"));
            assert!(!serialized.contains("hunter2"));
            assert!(!serialized.contains("scope-signature"));
            assert!(!serialized.contains("scope-auth-token"));
            assert!(!serialized.contains("https://"));
        }
        assert!(returned.contains("[redacted]"));
        let _ = fs::remove_file(source_path);
        let _ = fs::remove_file(export_path);
    }

    #[test]
    fn export_redacts_endpoint_like_scope_without_url_scheme() {
        let source_path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-export-noscheme-source-{}.jsonl",
            std::process::id()
        ));
        let export_path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-export-noscheme-{}.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&source_path);
        let _ = fs::remove_file(&export_path);
        fs::write(&source_path, "").expect("source");

        let expected_tx_hash = format!("0x{}", "a".repeat(64));
        let result = export_diagnostic_events_to_path(
            &source_path,
            &export_path,
            DiagnosticEventQuery {
                category: Some("rpc user:pass@example.invalid/rpc?token=scope-secret".to_string()),
                account: Some("account-1".to_string()),
                tx_hash: Some(expected_tx_hash.clone()),
                status: Some("broadcast".to_string()),
                ..DiagnosticEventQuery::default()
            },
        )
        .expect("export");
        let exported = fs::read_to_string(&export_path).expect("read export");
        let returned = serde_json::to_string(&result).expect("serialize result");

        for serialized in [exported.as_str(), returned.as_str()] {
            assert!(!serialized.contains("scope-secret"));
            assert!(!serialized.contains("user:pass"));
            assert!(!serialized.contains("example.invalid"));
            assert!(!serialized.contains("token="));
        }
        assert_eq!(result.scope.category.as_deref(), Some("[redacted]"));
        assert_eq!(result.scope.account.as_deref(), Some("account-1"));
        assert_eq!(result.scope.status.as_deref(), Some("broadcast"));
        assert_eq!(
            result.scope.tx_hash.as_deref(),
            Some(expected_tx_hash.as_str())
        );
        let _ = fs::remove_file(source_path);
        let _ = fs::remove_file(export_path);
    }

    #[test]
    fn export_redacts_sensitive_tx_hash_scope_short_words() {
        let source_path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-export-txhash-sensitive-source-{}.jsonl",
            std::process::id()
        ));
        let _ = fs::remove_file(&source_path);
        fs::write(&source_path, "").expect("source");

        for (index, sensitive_value) in ["password", "auth", "privatekey", "mnemonic", "signature"]
            .iter()
            .enumerate()
        {
            let export_path = std::env::temp_dir().join(format!(
                "wallet-workbench-diagnostics-export-txhash-sensitive-{}-{}.json",
                std::process::id(),
                index
            ));
            let _ = fs::remove_file(&export_path);

            let result = export_diagnostic_events_to_path(
                &source_path,
                &export_path,
                DiagnosticEventQuery {
                    tx_hash: Some((*sensitive_value).to_string()),
                    ..DiagnosticEventQuery::default()
                },
            )
            .expect("export");
            let exported = fs::read_to_string(&export_path).expect("read export");
            let exported_json: Value = serde_json::from_str(&exported).expect("export json");
            let returned_json = serde_json::to_value(&result).expect("result json");

            assert_eq!(result.scope.tx_hash.as_deref(), Some("[redacted]"));
            assert_eq!(
                exported_json
                    .pointer("/scope/txHash")
                    .and_then(|value| value.as_str()),
                Some("[redacted]")
            );
            assert_eq!(
                returned_json
                    .pointer("/scope/txHash")
                    .and_then(|value| value.as_str()),
                Some("[redacted]")
            );

            let _ = fs::remove_file(export_path);
        }

        let _ = fs::remove_file(source_path);
    }

    #[test]
    fn export_surfaces_write_permission_errors() {
        let source_path = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-export-source-fail-{}.jsonl",
            std::process::id()
        ));
        let file_as_parent = std::env::temp_dir().join(format!(
            "wallet-workbench-diagnostics-export-parent-file-{}",
            std::process::id()
        ));
        fs::write(&source_path, "").expect("source");
        fs::write(&file_as_parent, "not a directory").expect("parent file");
        let export_path = file_as_parent.join("export.json");

        let error = export_diagnostic_events_to_path(
            &source_path,
            &export_path,
            DiagnosticEventQuery::default(),
        )
        .expect_err("write should fail");

        assert!(error.contains("Unable to export diagnostics"));
        let _ = fs::remove_file(source_path);
        let _ = fs::remove_file(file_as_parent);
    }
}
