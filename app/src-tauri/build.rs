fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    let host = std::env::var("HOST").unwrap_or_default();
    if target.contains("windows") && !host.contains("windows") {
        let _ = std::panic::catch_unwind(tauri_build::build);
    } else {
        tauri_build::build();
    }
}
