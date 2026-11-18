// Torrent streaming. librqbit fetches pieces in the order the reader asks for them (its file
// stream prioritises what's right after the read position), so mpv reading over HTTP Range
// requests gets sequential download with seeking for free.
// One torrent per info hash; only the chosen file is downloaded; files live in a temp folder
// and go when the stream is stopped.
use anyhow::{anyhow, Result};
use librqbit::{AddTorrent, AddTorrentOptions, ManagedTorrent, Session, SessionOptions};
use std::collections::HashMap;
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, OnceCell};

pub struct Torrents {
    dir: PathBuf,
    offline: bool, // tests: no DHT, trackers or listening, nothing leaves the machine
    session: OnceCell<Arc<Session>>,
    live: Mutex<HashMap<String, Arc<ManagedTorrent>>>,
    // Downloads page: whole files kept in a folder the viewer chose ("hash:fileIdx" -> torrent)
    saved: Mutex<HashMap<String, Arc<ManagedTorrent>>>,
}

// Trackers come from the addon's `sources` ("tracker:udp://..."); "dht:" entries need nothing.
pub fn magnet(info_hash: &str, sources: &[String]) -> String {
    let mut m = format!("magnet:?xt=urn:btih:{info_hash}");
    for s in sources { if let Some(t) = s.strip_prefix("tracker:") { m.push_str("&tr="); m.push_str(&enc(t)); } }
    m
}

// percent-encoding for a tracker URL inside the magnet (what encodeURIComponent keeps, plus ':')
fn enc(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'():".contains(&b) { o.push(b as char); } else { o.push_str(&format!("%{b:02X}")); }
    }
    o
}

pub fn valid_hash(h: &str) -> bool { h.len() == 40 && h.bytes().all(|b| b.is_ascii_hexdigit()) }

impl Torrents {
    pub fn new(dir: PathBuf) -> Torrents { Torrents { dir, offline: false, session: OnceCell::new(), live: Mutex::new(HashMap::new()), saved: Mutex::new(HashMap::new()) } }

    async fn session(&self) -> Result<Arc<Session>> {
        self.session.get_or_try_init(|| async {
            let _ = std::fs::create_dir_all(&self.dir);
            let mut o = SessionOptions::default();
            o.fastresume = false;
            o.persistence = None;
            // give back to the swarm while watching, without eating the line the stream needs
            o.ratelimits.upload_bps = NonZeroU32::new(1_000_000);
            if self.offline { o.dht = None; o.disable_trackers = true; o.listen = None; }
            Session::new_with_opts(self.dir.clone(), o).await
        }).await.cloned()
    }

    pub async fn open(&self, info_hash: &str, file_idx: usize, sources: &[String]) -> Result<Arc<ManagedTorrent>> {
        let h = info_hash.to_ascii_lowercase();
        if !valid_hash(&h) { return Err(anyhow!("bad info hash")); }
        if let Some(t) = self.live.lock().await.get(&h) { return Ok(t.clone()); }
        // peers we already know ("peer:ip:port"): another Majlis in the same house that has the
        // pieces, so they cross the LAN once instead of the internet twice
        let peers: Vec<std::net::SocketAddr> = sources.iter().filter_map(|s| s.strip_prefix("peer:")?.parse().ok()).collect();
        self.add(h.clone(), AddTorrent::from_url(magnet(&h, sources)), file_idx, peers).await
    }

    async fn add(&self, key: String, what: AddTorrent<'_>, file_idx: usize, peers: Vec<std::net::SocketAddr>) -> Result<Arc<ManagedTorrent>> {
        let s = self.session().await?;
        let opts = AddTorrentOptions { only_files: Some(vec![file_idx]), overwrite: true, initial_peers: (!peers.is_empty()).then_some(peers), ..Default::default() };
        let r = s.add_torrent(what, Some(opts)).await?;
        let t = r.into_handle().ok_or_else(|| anyhow!("torrent not added"))?;
        self.live.lock().await.insert(key, t.clone());
        Ok(t)
    }

    pub async fn get(&self, info_hash: &str) -> Option<Arc<ManagedTorrent>> { self.live.lock().await.get(&info_hash.to_ascii_lowercase()).cloned() }

    pub async fn stop(&self, info_hash: &str) -> Result<()> {
        let Some(t) = self.live.lock().await.remove(&info_hash.to_ascii_lowercase()) else { return Ok(()) };
        if let Some(s) = self.session.get() { s.delete(t.id().into(), true).await?; }
        Ok(())
    }

    // The whole file into `folder` (it stays there: cancel can keep or delete it).
    // shortcut: a torrent already streaming is the same torrent to librqbit, so it keeps the stream's folder; stop the stream first
    pub async fn download(&self, info_hash: &str, file_idx: usize, sources: &[String], folder: &str) -> Result<()> {
        let h = info_hash.to_ascii_lowercase();
        if !valid_hash(&h) { return Err(anyhow!("bad info hash")); }
        let key = format!("{h}:{file_idx}");
        if self.saved.lock().await.contains_key(&key) { return Ok(()); }
        let s = self.session().await?;
        let opts = AddTorrentOptions { only_files: Some(vec![file_idx]), overwrite: true, output_folder: Some(folder.to_string()), ..Default::default() };
        let r = s.add_torrent(AddTorrent::from_url(magnet(&h, sources)), Some(opts)).await?;
        let t = r.into_handle().ok_or_else(|| anyhow!("torrent not added"))?;
        self.saved.lock().await.insert(key, t);
        Ok(())
    }

    pub async fn cancel_download(&self, info_hash: &str, file_idx: usize, delete_files: bool) -> Result<()> {
        let key = format!("{}:{file_idx}", info_hash.to_ascii_lowercase());
        let Some(t) = self.saved.lock().await.remove(&key) else { return Ok(()) };
        if let Some(s) = self.session.get() { s.delete(t.id().into(), delete_files).await?; }
        Ok(())
    }

    pub async fn download_stats(&self) -> serde_json::Value {
        let saved = self.saved.lock().await;
        serde_json::Value::Object(saved.iter().map(|(k, t)| {
            let idx: usize = k.rsplit(':').next().and_then(|x| x.parse().ok()).unwrap_or(0);
            let mut v = serde_json::to_value(t.stats()).unwrap_or_default();
            // where the file lands, once the magnet has resolved (the page plays it from there)
            if let Ok(Some(p)) = t.with_metadata(|m| m.file_infos.get(idx).map(|f| t.output_folder().join(&f.relative_filename))) {
                v["file"] = serde_json::json!(p.to_string_lossy());
            }
            (k.clone(), v)
        }).collect())
    }

    pub async fn stats(&self) -> serde_json::Value {
        let live = self.live.lock().await;
        serde_json::Value::Object(live.iter().map(|(h, t)| (h.clone(), serde_json::to_value(t.stats()).unwrap_or_default())).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    // The whole streaming path with the data already on disk: torrent made from a local file,
    // added offline, read back through the file stream at an offset (what an HTTP Range does).
    #[tokio::test(flavor = "multi_thread")]
    async fn streams_from_disk() {
        let dir = std::env::temp_dir().join(format!("majlis-media-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let data: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(dir.join("film.bin"), &data).unwrap();
        let made = librqbit::create_torrent(&dir.join("film.bin"), librqbit::CreateTorrentOptions { name: None, trackers: vec![], piece_length: Some(262144) }, &librqbit::spawn_utils::BlockingSpawner::new(2)).await.unwrap();
        let t = Torrents { dir: dir.clone(), offline: true, session: OnceCell::new(), live: Mutex::new(HashMap::new()), saved: Mutex::new(HashMap::new()) };
        let h = t.add("test".into(), AddTorrent::from_bytes(made.as_bytes().unwrap()), 0, vec![]).await.unwrap();
        let mut fs = h.clone().stream(0).await.unwrap();
        assert_eq!(fs.len(), 3_000_000);
        fs.seek(std::io::SeekFrom::Start(1_234_567)).await.unwrap();
        let mut buf = vec![0u8; 4096];
        fs.read_exact(&mut buf).await.unwrap();
        assert_eq!(buf, data[1_234_567..1_234_567 + 4096]);
        drop(fs);
        t.stop("test").await.unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn magnets() {
        let h = "a".repeat(40);
        assert!(valid_hash(&h) && !valid_hash("xyz"));
        let m = magnet(&h, &["tracker:udp://t.example:80/announce".into(), "dht:abc".into()]);
        assert_eq!(m, format!("magnet:?xt=urn:btih:{h}&tr=udp:%2F%2Ft.example:80%2Fannounce"));
    }
}
