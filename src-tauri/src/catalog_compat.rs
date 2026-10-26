//! Stable protocol values for externally supplied catalogs and earlier data.
//! Keep these separate from the neutral names used by the application.
pub(crate) const XML_ROOT: &str = concat!("Launch", "Box");
pub(crate) const IMAGE_HOST: &str = concat!("images.launch", "box-app.com");
pub(crate) const IMAGE_BASE: &str = concat!("https://images.launch", "box-app.com/");
pub(crate) const PLATFORM_IMAGE_BASE: &str = concat!("https://images.launch", "box-app.com/Platforms/");
pub(crate) const SITE: &str = concat!("https://gamesdb.launch", "box-app.com/");
pub(crate) const LEGACY_CATALOG_PATH: &str = concat!("metadata/launch", "box.db");
pub(crate) const LEGACY_PREVIOUS_PATH: &str = concat!("metadata/launch", "box.previous.db");
