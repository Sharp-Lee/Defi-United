pub mod accounts;
pub mod commands;
pub mod diagnostics;
pub mod models;
pub mod session;
pub mod storage;
pub mod transactions;
pub mod vault;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::accounts::derive_account,
            commands::accounts::load_accounts,
            commands::accounts::save_account_sync_error,
            commands::accounts::save_scanned_account,
            commands::config::load_app_config,
            commands::config::remember_validated_rpc,
            commands::diagnostics::export_diagnostic_events,
            commands::diagnostics::load_diagnostic_events,
            commands::token_watchlist::add_watchlist_token,
            commands::token_watchlist::edit_watchlist_token,
            commands::token_watchlist::load_token_watchlist_state,
            commands::token_watchlist::remove_watchlist_token,
            commands::token_watchlist::upsert_erc20_balance_snapshot,
            commands::token_watchlist::upsert_token_metadata_cache,
            commands::token_watchlist::upsert_token_scan_state,
            commands::token_scanner::scan_erc20_balance,
            commands::token_scanner::scan_watchlist_balances,
            commands::token_scanner::scan_watchlist_token_metadata,
            commands::transactions::build_pending_history,
            commands::transactions::cancel_pending_transfer,
            commands::transactions::dismiss_history_recovery_intent_command,
            commands::transactions::inspect_transaction_history_storage,
            commands::transactions::load_history_recovery_intents_command,
            commands::transactions::load_transaction_history,
            commands::transactions::quarantine_transaction_history,
            commands::transactions::recover_broadcasted_history_record_command,
            commands::transactions::reconcile_pending_history_command,
            commands::transactions::replace_pending_transfer,
            commands::transactions::review_dropped_history_record_command,
            commands::transactions::submit_erc20_transfer_command,
            commands::transactions::submit_native_transfer_command,
            commands::vault::create_vault,
            commands::vault::lock_vault,
            commands::vault::unlock_vault,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
