use crate::diagnostics::{
    export_diagnostic_events as export_events, load_recent_diagnostic_events, DiagnosticEvent,
    DiagnosticEventQuery, DiagnosticExportResult,
};

#[tauri::command]
pub fn load_diagnostic_events(
    query: Option<DiagnosticEventQuery>,
) -> Result<Vec<DiagnosticEvent>, String> {
    load_recent_diagnostic_events(query.unwrap_or_default())
}

#[tauri::command]
pub fn export_diagnostic_events(
    query: Option<DiagnosticEventQuery>,
) -> Result<DiagnosticExportResult, String> {
    export_events(query.unwrap_or_default())
}
