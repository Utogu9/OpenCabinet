//! Observe the launched process tree, including wrappers which exit before their game.
#[cfg(target_os = "linux")]
use std::{
    collections::{HashMap, HashSet},
    fs,
    time::{Duration, Instant},
};

pub type ErrorOutput = std::sync::Arc<std::sync::Mutex<Vec<u8>>>;
pub fn capture_errors(mut stream: std::process::ChildStderr) -> ErrorOutput {
    let output = ErrorOutput::default();
    let writer = output.clone();
    std::thread::spawn(move || {
        use std::io::Read;
        let mut chunk = [0u8; 4096];
        while let Ok(count) = stream.read(&mut chunk) {
            if count == 0 {
                break;
            }
            if let Ok(mut bytes) = writer.lock() {
                bytes.extend_from_slice(&chunk[..count]);
                let excess = bytes.len().saturating_sub(32768);
                if excess > 0 {
                    bytes.drain(..excess);
                }
            } else {
                break;
            }
        }
    });
    output
}
pub fn error_text(output: &Option<ErrorOutput>) -> String {
    output
        .as_ref()
        .and_then(|output| {
            output
                .lock()
                .ok()
                .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        })
        .unwrap_or_default()
}

#[derive(Debug)]
pub struct Identity {
    pub parent: u32,
    pub group: u32,
    pub start: u64,
    pub zombie: bool,
}
#[cfg(not(target_os = "linux"))]
pub struct Session;
#[cfg(not(target_os = "linux"))]
impl Session {
    pub fn new(_: u32, _: String) -> Self {
        Self
    }
    pub fn poll(&mut self, child_running: bool) -> bool {
        child_running
    }
    pub fn elapsed(&self) -> std::time::Duration {
        std::time::Duration::ZERO
    }
}
pub fn parse_stat(stat: &str) -> Option<Identity> {
    // comm may contain spaces and parentheses; fields after its final ')' are stable.
    let fields: Vec<_> = stat.rsplit_once(')')?.1.split_whitespace().collect();
    Some(Identity {
        parent: fields.get(1)?.parse().ok()?,
        group: fields.get(2)?.parse().ok()?,
        start: fields.get(19)?.parse().ok()?,
        zombie: matches!(*fields.first()?, "Z" | "X"),
    })
}
#[cfg(target_os = "linux")]
struct Process {
    id: u32,
    identity: Identity,
    environment: Vec<u8>,
    name: String,
}
#[cfg(target_os = "linux")]
fn snapshot() -> Option<Vec<Process>> {
    Some(
        fs::read_dir("/proc")
            .ok()?
            .flatten()
            .filter_map(|entry| {
                let id = entry.file_name().to_str()?.parse().ok()?;
                let path = entry.path();
                let identity = parse_stat(&fs::read_to_string(path.join("stat")).ok()?)?;
                let name = fs::read_to_string(path.join("comm"))
                    .unwrap_or_default()
                    .trim()
                    .to_lowercase();
                Some(Process {
                    id,
                    identity,
                    environment: fs::read(path.join("environ")).unwrap_or_default(),
                    name,
                })
            })
            .collect(),
    )
}
#[cfg(target_os = "linux")]
fn variable(process: &Process, key: &str, value: &str) -> bool {
    let expected = format!("{key}={value}");
    process
        .environment
        .split(|b| *b == 0)
        .any(|part| part == expected.as_bytes())
}
#[cfg(target_os = "linux")]
fn infrastructure(name: &str) -> bool {
    [
        "wineserver",
        "steam",
        "steamwebhelper",
        "steamservice",
        "pressure-vessel",
        "reaper",
        "pv-bwrap",
    ]
    .iter()
    .any(|n| name == *n)
}
#[cfg(target_os = "linux")]
pub fn steam_running(id: u32) -> Option<bool> {
    Some(snapshot()?.iter().any(|p| {
        !p.identity.zombie
            && !infrastructure(&p.name)
            && (variable(p, "SteamAppId", &id.to_string())
                || variable(p, "SteamGameId", &id.to_string()))
    }))
}
#[cfg(target_os = "linux")]
pub struct Session {
    group: u32,
    token: String,
    known: HashMap<u32, u64>,
    started: Instant,
    last_seen: Instant,
}
#[cfg(target_os = "linux")]
impl Session {
    pub fn new(pid: u32, token: String) -> Self {
        let now = Instant::now();
        Self {
            group: pid,
            token,
            known: HashMap::new(),
            started: now,
            last_seen: now,
        }
    }
    pub fn elapsed(&self) -> Duration {
        self.last_seen.duration_since(self.started)
    }
    pub fn poll(&mut self, child_running: bool) -> bool {
        let Some(processes) = snapshot() else {
            if child_running {
                self.last_seen = Instant::now();
            }
            return child_running;
        };
        let mut related: HashSet<u32> = processes
            .iter()
            .filter(|p| {
                p.identity.group == self.group
                    || variable(p, "OPENCABINET_SESSION", &self.token)
                    || self.known.get(&p.id) == Some(&p.identity.start)
            })
            .map(|p| p.id)
            .collect();
        loop {
            let old = related.len();
            for p in &processes {
                if related.contains(&p.identity.parent) {
                    related.insert(p.id);
                }
            }
            if old == related.len() {
                break;
            }
        }
        let running = processes
            .iter()
            .any(|p| related.contains(&p.id) && !p.identity.zombie && !infrastructure(&p.name));
        for p in &processes {
            if related.contains(&p.id) {
                self.known.insert(p.id, p.identity.start);
            }
        }
        if running || child_running {
            self.last_seen = Instant::now();
            true
        } else {
            self.last_seen.elapsed() < Duration::from_secs(2)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stat_names_do_not_shift_pid_or_start_time() {
        let parsed = parse_stat(&format!(
            "42 (game (demo)) S 12 42 {}987 0",
            "0 ".repeat(16)
        ))
        .unwrap();
        assert_eq!(parsed.parent, 12);
        assert_eq!(parsed.group, 42);
        assert_eq!(parsed.start, 987);
        assert!(!parsed.zombie);
        assert!(parse_stat("invalid").is_none());
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn game_outlives_its_launcher_and_unrelated_processes_do_not_extend_it() {
        use std::os::unix::process::CommandExt;
        let token = format!("test-{}", std::process::id());
        let mut child = std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 1 & exit 0"])
            .env("OPENCABINET_SESSION", &token)
            .process_group(0)
            .spawn()
            .unwrap();
        let mut unrelated = std::process::Command::new("/bin/sleep")
            .arg("10")
            .spawn()
            .unwrap();
        let mut session = Session::new(child.id(), token);
        std::thread::sleep(Duration::from_millis(100));
        assert!(child.try_wait().unwrap().is_some());
        assert!(session.poll(false));
        let deadline = Instant::now() + Duration::from_secs(8);
        while session.poll(false) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }
        let still_running = session.poll(false);
        unrelated.kill().unwrap();
        unrelated.wait().unwrap();
        assert!(!still_running);
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn steam_tracking_observes_only_the_requested_app_environment() {
        let id = 2_000_000_013;
        let mut game = std::process::Command::new("/bin/sleep")
            .arg("10")
            .env("SteamGameId", id.to_string())
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(steam_running(id), Some(true));
        assert_eq!(steam_running(id + 1), Some(false));
        game.kill().unwrap();
        game.wait().unwrap();
        assert_eq!(steam_running(id), Some(false));
    }
}
