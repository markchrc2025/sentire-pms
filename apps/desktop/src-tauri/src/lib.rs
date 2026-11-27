//! Sentire PMS desktop shell. The launcher page connects to a hub on the network, or turns this
//! PC into the property hub: the installed "Sentire PMS Hub" Windows service starts the bundled
//! database and app as soon as the hub marker file exists (P2.1, P2.2).

use std::path::PathBuf;

fn control_dir() -> PathBuf {
    let base = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".into());
    PathBuf::from(base).join("SentirePMS").join("control")
}

/// Mark this PC as the property hub. The hub service notices within five seconds.
#[tauri::command]
fn enable_hub() -> Result<(), String> {
    let dir = control_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot write {}: {e}", dir.display()))?;
    std::fs::write(dir.join("hub.enabled"), b"enabled by the Sentire PMS app\n").map_err(|e| e.to_string())
}

/// Is this PC set up as the hub?
#[tauri::command]
fn hub_enabled() -> bool {
    control_dir().join("hub.enabled").exists()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![enable_hub, hub_enabled])
        .run(tauri::generate_context!())
        .expect("error while running Sentire PMS");
}
