//! Names used by older portable installations and browser profiles.
//! Preserve their runtime values so existing user data remains accessible.
pub(crate) const PROFILE_DIRECTORY: &str = concat!("better", "box");
pub(crate) const CONFIG_FILE: &str = concat!("better", "box.config.json");
pub(crate) const DATABASE: &str = concat!("better", "box.db");
pub(crate) const MOVE_MARKER: &str = concat!(".better", "box-move.json");
pub(crate) const INSTANCE_LOCK: &str = concat!(".better", "box-instance.lock");
