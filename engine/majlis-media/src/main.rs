// majlis-media: the app's torrent service. A local HTTP server (127.0.0.1, random port) behind a
// random per-run key, so nothing else on the machine can drive it. It streams torrents to the
// player with HTTP Range and downloads whole files for the Downloads page. (Addons, metadata and
// ranking live in the app: app/src/main/media/.)
// On start it prints one line to stdout: {"ready":true,"port":N,"key":"..."}.
mod torrent;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

struct App { key: String, torrents: torrent::Torrents }
type S = State<Arc<App>>;

fn err(code: StatusCode, msg: impl ToString) -> Response { (code, Json(json!({ "error": msg.to_string() }))).into_response() }
fn ok(key: &str, k: &str) -> bool { !k.is_empty() && k.len() == key.len() && k.bytes().zip(key.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0 }

#[derive(Deserialize)]
struct Play { #[serde(rename = "infoHash")] info_hash: String, #[serde(rename = "fileIdx", default)] file_idx: usize, #[serde(default)] sources: Vec<String> }
#[derive(Deserialize)]
struct Stop { #[serde(rename = "infoHash")] info_hash: String, #[serde(default)] delete: bool }

async fn play(State(a): S, Path(k): Path<String>, Json(b): Json<Play>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    match a.torrents.open(&b.info_hash, b.file_idx, &b.sources).await {
        Ok(_) => Json(json!({ "path": format!("/{}/s/{}/{}", a.key, b.info_hash.to_ascii_lowercase(), b.file_idx) })).into_response(),
        Err(e) => err(StatusCode::BAD_GATEWAY, e),
    }
}

async fn stop(State(a): S, Path(k): Path<String>, Json(b): Json<Stop>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    match a.torrents.stop_with_delete(&b.info_hash, b.delete).await { Ok(()) => Json(json!({ "ok": true })).into_response(), Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e) }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Download { info_hash: String, #[serde(default)] file_idx: usize, #[serde(default)] sources: Vec<String>, folder: String }
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Cancel { info_hash: String, #[serde(default)] file_idx: usize, #[serde(default)] delete: bool }

async fn download(State(a): S, Path(k): Path<String>, Json(b): Json<Download>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    match a.torrents.download(&b.info_hash, b.file_idx, &b.sources, &b.folder).await { Ok(()) => Json(json!({ "ok": true })).into_response(), Err(e) => err(StatusCode::BAD_GATEWAY, e) }
}

async fn cancel(State(a): S, Path(k): Path<String>, Json(b): Json<Cancel>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    match a.torrents.cancel_download(&b.info_hash, b.file_idx, b.delete).await { Ok(()) => Json(json!({ "ok": true })).into_response(), Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e) }
}

async fn downloads(State(a): S, Path(k): Path<String>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    Json(a.torrents.download_stats().await).into_response()
}

async fn stats(State(a): S, Path(k): Path<String>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    Json(a.torrents.stats().await).into_response()
}

async fn active(State(a): S, Path(k): Path<String>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    let files = a.torrents.active_files().await;
    Json(json!({ "dir": a.torrents.cache_dir(), "files": files })).into_response()
}

// "bytes=a-b" / "bytes=a-" / "bytes=-n" -> (start, end inclusive)
fn range(h: Option<&str>, len: u64) -> Option<(u64, u64)> {
    let r = h?.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = r.split_once('-')?;
    let (s, e) = match (a.trim(), b.trim()) {
        ("", n) => { let n: u64 = n.parse().ok()?; (len.saturating_sub(n), len.checked_sub(1)?) }
        (s, "") => (s.parse().ok()?, len.checked_sub(1)?),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(len.checked_sub(1)?)),
    };
    (s <= e && e < len).then_some((s, e))
}

async fn stream(State(a): S, Path((k, ih, idx)): Path<(String, String, usize)>, headers: HeaderMap) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    let Some(t) = a.torrents.get(&ih).await else { return err(StatusCode::NOT_FOUND, "not playing") };
    let mut fs = match t.stream(idx).await { Ok(f) => f, Err(e) => return err(StatusCode::BAD_GATEWAY, e) };
    let len = fs.len();
    let want = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let (start, end, code) = match want {
        Some(_) => match range(want, len) { Some((s, e)) => (s, e, StatusCode::PARTIAL_CONTENT), None => return (StatusCode::RANGE_NOT_SATISFIABLE, [(header::CONTENT_RANGE, format!("bytes */{len}"))]).into_response() },
        None => (0, len.saturating_sub(1), StatusCode::OK),
    };
    if start > 0 { if let Err(e) = fs.seek(std::io::SeekFrom::Start(start)).await { return err(StatusCode::INTERNAL_SERVER_ERROR, e); } }
    let n = if len == 0 { 0 } else { end - start + 1 };
    let body = Body::from_stream(tokio_util::io::ReaderStream::with_capacity(fs.take(n), 256 * 1024));
    let mut r = Response::builder().status(code).header(header::ACCEPT_RANGES, "bytes").header(header::CONTENT_LENGTH, n).header(header::CONTENT_TYPE, "application/octet-stream");
    if code == StatusCode::PARTIAL_CONTENT { r = r.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}")); }
    r.body(body).unwrap_or_else(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))
}

fn new_key() -> String {
    let mut b = [0u8; 24];
    getrandom::fill(&mut b).expect("random");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn resolve_cache_dir(args: &[String], env_dir: Option<String>) -> (std::path::PathBuf, bool) {
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--cache-dir" && i + 1 < args.len() {
            let p = args[i + 1].trim();
            if !p.is_empty() { return (std::path::PathBuf::from(p), true); }
        } else if let Some(rest) = args[i].strip_prefix("--cache-dir=") {
            let p = rest.trim();
            if !p.is_empty() { return (std::path::PathBuf::from(p), true); }
        }
        i += 1;
    }
    if let Some(p) = env_dir.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        return (std::path::PathBuf::from(p), true);
    }
    (std::env::temp_dir().join("majlis-media"), false)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (dir, _is_custom) = resolve_cache_dir(&args, std::env::var("MAJLIS_CACHE_DIR").ok());
    let _ = std::fs::create_dir_all(&dir);
    let app = Arc::new(App { key: new_key(), torrents: torrent::Torrents::new(dir) });
    let router = Router::new()
        .route("/{k}/play", post(play))
        .route("/{k}/stop", post(stop))
        .route("/{k}/stats", get(stats))
        .route("/{k}/active", get(active))
        .route("/{k}/download", post(download))
        .route("/{k}/download-cancel", post(cancel))
        .route("/{k}/downloads", get(downloads))
        .route("/{k}/s/{ih}/{idx}", get(stream))
        .with_state(app.clone());
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    println!("{}", json!({ "ready": true, "port": l.local_addr()?.port(), "key": app.key }));
    // the app owns us: when its end of stdin closes, we go too
    tokio::spawn(async { let mut b = [0u8; 64]; let mut i = tokio::io::stdin(); while matches!(i.read(&mut b).await, Ok(n) if n > 0) {} std::process::exit(0); });
    axum::serve(l, router).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges() {
        assert_eq!(range(Some("bytes=0-"), 100), Some((0, 99)));
        assert_eq!(range(Some("bytes=10-19"), 100), Some((10, 19)));
        assert_eq!(range(Some("bytes=90-500"), 100), Some((90, 99)));
        assert_eq!(range(Some("bytes=-10"), 100), Some((90, 99)));
        assert_eq!(range(Some("bytes=100-"), 100), None);
        assert_eq!(range(Some("items=0-1"), 100), None);
        assert!(ok("abc", "abc") && !ok("abc", "abd") && !ok("abc", ""));
        let (p1, c1) = resolve_cache_dir(&["majlis-media".into(), "--cache-dir".into(), "C:\\cache".into()], None);
        assert!(c1 && p1 == std::path::PathBuf::from("C:\\cache"));
        let (p2, c2) = resolve_cache_dir(&["majlis-media".into()], Some("C:\\env-cache".into()));
        assert!(c2 && p2 == std::path::PathBuf::from("C:\\env-cache"));
        let (_, c3) = resolve_cache_dir(&["majlis-media".into()], None);
        assert!(!c3);
    }
}
