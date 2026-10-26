//! Keep the existing WebView2 profile when upgrading a development installation.
//! User libraries are portable and are resolved independently by storage.rs.
use std::path::{Path, PathBuf};

fn previous_profile(local_data: &Path) -> Option<PathBuf> {
    let directory = local_data.join(crate::profile_compat::PROFILE_DIRECTORY);
    directory.is_dir().then_some(directory)
}

pub fn legacy_webview_directory() -> Option<PathBuf> {
    previous_profile(&PathBuf::from(std::env::var_os("LOCALAPPDATA")?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_reuses_an_existing_profile_without_creating_or_moving_it() {
        let root = tempfile_root();
        std::fs::create_dir_all(&root).unwrap();
        assert!(previous_profile(&root).is_none());
        let legacy = root.join(crate::profile_compat::PROFILE_DIRECTORY);
        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("profile-test"), b"preferences").unwrap();
        assert_eq!(previous_profile(&root), Some(legacy.clone()));
        assert_eq!(std::fs::read(legacy.join("profile-test")).unwrap(), b"preferences");
        assert!(!root.join("opencabinet").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    fn tempfile_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/branding-tests").join(format!(
            "{}-{}", std::process::id(), std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ))
    }
}
