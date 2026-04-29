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
            commands::abi_caller::call_read_only_abi_function,
            commands::abi_caller::list_managed_abi_functions,
            commands::abi_caller::preview_managed_abi_calldata,
            commands::abi_caller::submit_abi_write_call_command,
            commands::abi_registry::delete_abi_cache_entry,
            commands::abi_registry::fetch_explorer_abi,
            commands::abi_registry::import_abi_payload,
            commands::abi_registry::load_abi_registry_state,
            commands::abi_registry::mark_abi_cache_stale,
            commands::abi_registry::paste_abi_payload,
            commands::abi_registry::remove_abi_data_source_config,
            commands::abi_registry::upsert_abi_cache_entry,
            commands::abi_registry::upsert_abi_data_source_config,
            commands::abi_registry::validate_abi_payload,
            commands::accounts::derive_account,
            commands::accounts::load_accounts,
            commands::accounts::save_account_sync_error,
            commands::accounts::save_scanned_account,
            commands::config::load_app_config,
            commands::config::remember_validated_rpc,
            commands::diagnostics::export_diagnostic_events,
            commands::diagnostics::load_diagnostic_events,
            commands::raw_calldata::submit_raw_calldata_command,
            commands::token_watchlist::add_watchlist_token,
            commands::token_watchlist::edit_watchlist_token,
            commands::token_watchlist::load_token_watchlist_state,
            commands::token_watchlist::remove_watchlist_token,
            commands::token_watchlist::upsert_allowance_snapshot,
            commands::token_watchlist::upsert_approval_watchlist_entry,
            commands::token_watchlist::upsert_asset_scan_job,
            commands::token_watchlist::upsert_asset_snapshot,
            commands::token_watchlist::upsert_erc20_balance_snapshot,
            commands::token_watchlist::upsert_nft_approval_snapshot,
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
            commands::transactions::submit_erc20_batch_command,
            commands::transactions::submit_erc20_transfer_command,
            commands::transactions::submit_native_batch_command,
            commands::transactions::submit_native_transfer_command,
            commands::vault::create_vault,
            commands::vault::lock_vault,
            commands::vault::unlock_vault,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
