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
            commands::accounts::save_scanned_account,
            commands::transactions::build_pending_history,
            commands::transactions::cancel_pending_transfer,
            commands::transactions::replace_pending_transfer,
            commands::transactions::submit_native_transfer_command,
            commands::vault::create_vault,
            commands::vault::lock_vault,
            commands::vault::unlock_vault,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
