// majlis-media: the app's media service. A local HTTP server (127.0.0.1, random port) behind a
// random per-run key, so nothing else on the machine can drive it. It speaks the Stremio addon
// protocol, ranks streams, and streams torrents to the player with HTTP Range.
// On start it prints one line to stdout: {"ready":true,"port":N,"key":"..."}.
mod addons;
mod rank;
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
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

struct App { key: String, addons: addons::Addons, torrents: torrent::Torrents }
type S = State<Arc<App>>;

fn err(code: StatusCode, msg: impl ToString) -> Response { (code, Json(json!({ "error": msg.to_string() }))).into_response() }
fn ok(key: &str, k: &str) -> bool { !k.is_empty() && k.len() == key.len() && k.bytes().zip(key.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0 }

#[derive(Deserialize)]
struct One { url: String }
#[derive(Deserialize)]
struct Res { addon: String, #[serde(rename = "type")] ty: String, id: String, extra: Option<String> }
#[derive(Deserialize)]
struct Many { addons: Vec<String>, #[serde(rename = "type")] ty: String, id: String, extra: Option<String>, #[serde(default)] prefs: PrefsIn }
#[derive(Deserialize, Default)]
struct PrefsIn { #[serde(default)] max_height: u32, #[serde(default)] debrid_only: bool, #[serde(default)] down_mbps: f64 }
#[derive(Deserialize)]
struct Play { #[serde(rename = "infoHash")] info_hash: String, #[serde(rename = "fileIdx", default)] file_idx: usize, #[serde(default)] sources: Vec<String> }
#[derive(Deserialize)]
struct Stop { #[serde(rename = "infoHash")] info_hash: String }

async fn manifest(State(a): S, Path(k): Path<String>, Json(b): Json<One>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    match a.addons.manifest(&b.url).await { Ok(m) => Json(m).into_response(), Err(e) => err(StatusCode::BAD_GATEWAY, e) }
}

async fn catalog(State(a): S, Path(k): Path<String>, Json(b): Json<Res>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    match a.addons.resource(&b.addon, "catalog", &b.ty, &b.id, b.extra.as_deref(), Duration::from_secs(1800)).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err(StatusCode::BAD_GATEWAY, e),
    }
}

// the first addon (in the user's order) that knows the title
async fn meta(State(a): S, Path(k): Path<String>, Json(b): Json<Many>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    let got = a.addons.gather(&b.addons, "meta", &b.ty, &b.id, None, Duration::from_secs(3600)).await;
    match got.into_iter().find(|(_, r)| r["meta"].is_object()) { Some((_, r)) => Json(r).into_response(), None => err(StatusCode::NOT_FOUND, "no addon knows this title") }
}

async fn streams(State(a): S, Path(k): Path<String>, Json(b): Json<Many>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    let p = rank::Prefs { max_height: if b.prefs.max_height == 0 { 1080 } else { b.prefs.max_height }, debrid_only: b.prefs.debrid_only, down_mbps: b.prefs.down_mbps };
    let mut out = vec![];
    for (m, r) in a.addons.gather(&b.addons, "stream", &b.ty, &b.id, None, Duration::from_secs(120)).await {
        for s in r["streams"].as_array().cloned().unwrap_or_default() {
            // what this player can't use: YouTube ids, external links
            if s["ytId"].is_string() || (s["externalUrl"].is_string() && s["url"].is_null() && s["infoHash"].is_null()) { continue; }
            let f = rank::facts(&s);
            let mut s = s;
            s["addon"] = json!({ "id": m["id"], "name": m["name"] });
            s["majlis"] = json!({ "score": rank::score(&f, &p), "height": f.height, "seeders": f.seeders, "sizeGb": f.size_gb, "direct": f.direct, "hdr": f.hdr });
            out.push(s);
        }
    }
    out.sort_by(|x, y| y["majlis"]["score"].as_f64().partial_cmp(&x["majlis"]["score"].as_f64()).unwrap_or(std::cmp::Ordering::Equal));
    Json(json!({ "streams": out })).into_response()
}

async fn subtitles(State(a): S, Path(k): Path<String>, Json(b): Json<Many>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    let mut out = vec![];
    for (m, r) in a.addons.gather(&b.addons, "subtitles", &b.ty, &b.id, b.extra.as_deref(), Duration::from_secs(1800)).await {
        for mut s in r["subtitles"].as_array().cloned().unwrap_or_default() { s["addon"] = m["name"].clone(); out.push(s); }
    }
    Json(json!({ "subtitles": out })).into_response()
}

async fn play(State(a): S, Path(k): Path<String>, Json(b): Json<Play>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    match a.torrents.open(&b.info_hash, b.file_idx, &b.sources).await {
        Ok(_) => Json(json!({ "path": format!("/{}/s/{}/{}", a.key, b.info_hash.to_ascii_lowercase(), b.file_idx) })).into_response(),
        Err(e) => err(StatusCode::BAD_GATEWAY, e),
    }
}

async fn stop(State(a): S, Path(k): Path<String>, Json(b): Json<Stop>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    match a.torrents.stop(&b.info_hash).await { Ok(()) => Json(json!({ "ok": true })).into_response(), Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e) }
}

async fn stats(State(a): S, Path(k): Path<String>) -> Response {
    if !ok(&a.key, &k) { return err(StatusCode::FORBIDDEN, "key"); }
    Json(a.torrents.stats().await).into_response()
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let dir = std::env::temp_dir().join("majlis-media");
    // a fresh cache each run: whatever a previous run left half-downloaded is of no use
    let _ = std::fs::remove_dir_all(&dir);
    let app = Arc::new(App { key: new_key(), addons: addons::Addons::new(), torrents: torrent::Torrents::new(dir) });
    let router = Router::new()
        .route("/{k}/manifest", post(manifest))
        .route("/{k}/catalog", post(catalog))
        .route("/{k}/meta", post(meta))
        .route("/{k}/streams", post(streams))
        .route("/{k}/subtitles", post(subtitles))
        .route("/{k}/play", post(play))
        .route("/{k}/stop", post(stop))
        .route("/{k}/stats", get(stats))
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
    }
}
