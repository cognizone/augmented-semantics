use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // WKWebView / WebView2 persist their asset cache in the per-identifier data
      // dir and keep serving the PREVIOUS install's embedded files (entry HTML →
      // content-hashed JS → bundled config JSON) after an in-place update, so a
      // rebuilt app shows the old endpoint list until the cache is wiped by hand.
      // Wipe it automatically, but only when the version changed since last launch
      // — a normal relaunch keeps localStorage (theme, view history) intact — then
      // reload so THIS launch already renders the fresh bundle.
      if let Ok(dir) = app.path().app_data_dir() {
        let marker = dir.join("last-version");
        let current = app.package_info().version.to_string();
        let previous = std::fs::read_to_string(&marker).unwrap_or_default();
        if previous.trim() != current {
          if let Some(win) = app.get_webview_window("main") {
            let _ = win.clear_all_browsing_data();
            let _ = win.eval("location.reload()");
          }
          let _ = std::fs::create_dir_all(&dir);
          let _ = std::fs::write(&marker, &current);
        }
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
