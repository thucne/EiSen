pub mod mac_adapter;

pub use mac_adapter::MacAdapter;

#[cfg(windows)]
pub struct WindowsAdapter;

#[cfg(windows)]
impl crate::core::capture::ScreenProvider for WindowsAdapter {
    fn capture_display(&self, _display: u32, _out: &std::path::Path) -> Result<(), String> {
        unimplemented!("Windows screen capture adapter is not implemented yet")
    }

    fn active_display(&self) -> u32 {
        0
    }
}
