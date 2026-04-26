pub mod accounts;
pub mod commands;
pub mod models;
pub mod session;
pub mod storage;
pub mod vault;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::accounts::derive_account,
            commands::accounts::save_scanned_account,
            commands::vault::create_vault,
            commands::vault::unlock_vault,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
