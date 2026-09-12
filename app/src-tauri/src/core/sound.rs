use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SoundEffect {
    Shutter,
    Copy,
    Save,
}

impl SoundEffect {
    pub fn sound_path(self) -> &'static str {
        match self {
            SoundEffect::Shutter => {
                "/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Screen Capture.aif"
            }
            SoundEffect::Copy => {
                "/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Shutter.aif"
            }
            SoundEffect::Save => "/System/Library/Sounds/Funk.aiff",
        }
    }
}

/// Plays a sound effect asynchronously if `enabled` is true.
/// Never blocks the caller and never panics.
pub fn play(effect: SoundEffect, enabled: bool) {
    if !enabled {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        let path = effect.sound_path();
        if Path::new(path).exists() {
            // Spawn a thread to wait for the child process so it doesn't become a zombie
            std::thread::spawn(move || {
                if let Ok(mut child) = std::process::Command::new("afplay")
                    .arg(path)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                {
                    let _ = child.wait();
                }
            });
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = effect;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sound_effect_paths_are_non_empty() {
        assert!(!SoundEffect::Shutter.sound_path().is_empty());
        assert!(!SoundEffect::Copy.sound_path().is_empty());
        assert!(!SoundEffect::Save.sound_path().is_empty());
    }

    #[test]
    fn disabled_sound_is_noop() {
        // Should return immediately without playing
        play(SoundEffect::Shutter, false);
        play(SoundEffect::Copy, false);
        play(SoundEffect::Save, false);
    }
}
