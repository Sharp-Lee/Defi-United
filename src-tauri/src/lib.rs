pub mod accounts;
pub mod commands;
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
            commands::transactions::build_pending_history,
            commands::transactions::cancel_pending_transfer,
            commands::transactions::load_transaction_history,
            commands::transactions::reconcile_pending_history_command,
            commands::transactions::replace_pending_transfer,
            commands::transactions::submit_native_transfer_command,
            commands::vault::create_vault,
            commands::vault::generate_mnemonic,
            commands::vault::lock_vault,
            commands::vault::unlock_vault,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
