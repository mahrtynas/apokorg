//! apokorg desktop shell. Starts the server sidecar, waits for its `READY <port>` line, then
//! opens the UI with the API URL injected before the page loads. The sidecar is killed when
//! the app exits, and on Windows it also sits in a kill-on-close job object, so it dies with
//! the app even if the app crashes or is killed.

mod sidecar;

use sidecar::Sidecar;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Where the UI looks for the server when built without `VITE_API_URL`. In dev the server
/// runs here (see scripts/dev-services.ts) and no sidecar is started.
const DEFAULT_API_URL: &str = "http://127.0.0.1:4517";

pub fn run() {
    let app = tauri::Builder::default()
        // Must be the first plugin: a second launch just focuses the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let api_url = if use_sidecar() {
                let data_dir = app.path().app_data_dir()?;
                let sidecar = Sidecar::start(&data_dir, mock_mode()).inspect_err(|err| {
                    sidecar::show_error(&format!("The apokorg server failed to start.\n\n{err}"))
                })?;
                let url = format!("http://127.0.0.1:{}", sidecar.port);
                app.manage(sidecar);
                url
            } else {
                DEFAULT_API_URL.to_string()
            };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("apokorg")
                .inner_size(1280.0, 860.0)
                .min_inner_size(800.0, 600.0)
                .initialization_script(init_script(&api_url))
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the apokorg app");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(sidecar) = app.try_state::<Sidecar>() {
                sidecar.stop();
            }
        }
    });
}

/// Release builds always run the sidecar. Debug builds use the dev server unless
/// `APOKORG_SIDECAR=1` (which needs `pnpm build:sidecar` and a build without tauri.dev.json).
fn use_sidecar() -> bool {
    !cfg!(debug_assertions) || std::env::var("APOKORG_SIDECAR").as_deref() == Ok("1")
}

/// Mock mode, the hidden switch: `APOKORG_MOCK=1` or `apokorg.exe --mock`.
fn mock_mode() -> bool {
    std::env::var("APOKORG_MOCK").as_deref() == Ok("1") || std::env::args().any(|a| a == "--mock")
}

/// Runs before any page script. Exposes the API URL as `window.__APOKORG_API_URL__`, and,
/// because the UI bakes its API URL in at build time, rewrites fetches aimed at the default
/// URL to the sidecar's actual port.
fn init_script(api_url: &str) -> String {
    format!(
        r#"(() => {{
  const api = "{api_url}";
  const fallback = "{DEFAULT_API_URL}";
  window.__APOKORG_API_URL__ = api;
  if (api === fallback) return;
  const fetch = window.fetch.bind(window);
  window.fetch = (input, init) =>
    fetch(
      typeof input === "string" && input.startsWith(fallback)
        ? api + input.slice(fallback.length)
        : input,
      init,
    );
}})();"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_script_sets_the_api_url() {
        let script = init_script("http://127.0.0.1:50123");
        assert!(script.contains(r#"const api = "http://127.0.0.1:50123";"#));
        assert!(script.contains(r#"const fallback = "http://127.0.0.1:4517";"#));
    }
}
