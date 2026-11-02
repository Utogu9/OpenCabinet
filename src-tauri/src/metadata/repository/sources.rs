//! Resolve repository directories and GitHub submodules without pinning their commits.
use super::*;

#[derive(Deserialize)]
pub(super) struct DirectoryEntry {
    name: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    git_url: Option<String>,
    #[serde(default)]
    submodule_git_url: Option<String>,
}

fn component(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-._".contains(&b))
}

fn submodule_base(entry: &DirectoryEntry) -> Option<String> {
    // Contents listings currently call submodules "file" and omit
    // submodule_git_url, but their git_url points at the child repository's tree.
    if let Some(value) = entry.git_url.as_deref() {
        let url = reqwest::Url::parse(value).ok()?;
        let parts: Vec<_> = url.path_segments()?.collect();
        if url.scheme() == "https"
            && url.host_str() == Some("api.github.com")
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && parts.len() == 6
            && parts[0] == "repos"
            && parts[3] == "git"
            && parts[4] == "trees"
            && component(parts[1])
            && component(parts[2])
        {
            return Some(format!(
                "https://raw.githubusercontent.com/{}/{}/main/",
                parts[1], parts[2]
            ));
        }
    }
    let value = entry.submodule_git_url.as_deref()?;
    let url = reqwest::Url::parse(value).ok()?;
    let parts: Vec<_> = url.path_segments()?.collect();
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || parts.len() != 2
        || !component(parts[0])
    {
        return None;
    }
    let repo = parts[1].strip_suffix(".git").unwrap_or(parts[1]);
    component(repo).then(|| {
        format!(
            "https://raw.githubusercontent.com/{}/{repo}/main/",
            parts[0]
        )
    })
}

pub(super) fn schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS repository_sources(name TEXT PRIMARY KEY,raw_base TEXT NOT NULL)").map_err(err)
}

pub(super) fn indexed(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='repository_sources')",
        [],
        |r| r.get(0),
    )
    .unwrap_or(false)
}

fn default_base(source: &str) -> String {
    format!("{RAW_URL}{}/", url_path(source))
}

pub(super) fn base(conn: &Connection, source: &str) -> Result<String> {
    if !indexed(conn) {
        return Ok(default_base(source));
    }
    Ok(conn
        .query_row(
            "SELECT raw_base FROM repository_sources WHERE name=?1",
            [source],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or_else(|| default_base(source)))
}

pub(super) fn apply(conn: &mut Connection, entries: Vec<DirectoryEntry>) -> Result<()> {
    let tx = conn.transaction().map_err(err)?;
    schema(&tx)?;
    let mut found = 0;
    for entry in entries {
        if !valid_relative(&entry.name) || entry.name.contains('/') || entry.name.starts_with('.') {
            continue;
        }
        let raw = if entry.kind == "dir" {
            Some(default_base(&entry.name))
        } else if matches!(entry.kind.as_str(), "file" | "submodule") {
            submodule_base(&entry)
        } else {
            None
        };
        let Some(raw) = raw else {
            continue;
        };
        let old = base(&tx, &entry.name)?;
        if old != raw {
            // Keep catalog IDs, image identities and cached metadata. Only
            // relocate saved download URLs when a directory becomes a submodule.
            tx.execute("UPDATE image_urls SET url=?1 || substr(url,length(?2)+1) WHERE substr(url,1,length(?2))=?2",
                params![raw, old]).map_err(err)?;
        }
        tx.execute("INSERT OR IGNORE INTO platforms VALUES(?1)", [&entry.name])
            .map_err(err)?;
        tx.execute("INSERT INTO repository_sources VALUES(?1,?2) ON CONFLICT(name) DO UPDATE SET raw_base=excluded.raw_base",
            params![entry.name, raw]).map_err(err)?;
        found += 1;
    }
    if found == 0 {
        return Err(crate::i18n::text("source.invalid").into());
    }
    tx.commit().map_err(err)
}
