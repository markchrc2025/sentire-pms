//! Sentire PMS desktop shell (P0.7). Opens the launcher, which connects to the property hub.
//! The hub service manager (bundled Node.js and Postgres as a Windows service), pairing,
//! printing and the signed updater arrive in Phase 2 and Phase 9.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Sentire PMS");
}
