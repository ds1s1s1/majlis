// Stremio addon protocol client. An addon is a base URL; its manifest says which resources
// (catalog, meta, stream, subtitles) it serves, for which types and which id prefixes. Responses
// stay plain JSON end to end, so any field an addon sends (now or later) reaches the app intact.
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct Addons {
    http: reqwest::Client,
    cache: Mutex<HashMap<String, (Instant, Value)>>,
}

pub fn base(url: &str) -> String {
    url.trim().trim_end_matches("/manifest.json").trim_end_matches('/').replacen("stremio://", "https://", 1)
}

// path segments as Stremio's own client writes them (encodeURIComponent)
pub fn enc(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'():".contains(&b) { o.push(b as char); } else { o.push_str(&format!("%{b:02X}")); }
    }
    o
}

// Does this manifest serve `resource` for `ty`/`id`? Resources are either names ("stream") or
// objects with their own types/idPrefixes; the manifest-level ones apply otherwise.
pub fn serves(m: &Value, resource: &str, ty: &str, id: &str) -> bool {
    let strs = |v: &Value| v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>());
    let Some(list) = m["resources"].as_array() else { return false };
    for r in list {
        let (name, types, prefixes) = match r {
            Value::String(n) => (n.as_str(), strs(&m["types"]), strs(&m["idPrefixes"])),
            Value::Object(_) => (r["name"].as_str().unwrap_or(""), strs(&r["types"]).or_else(|| strs(&m["types"])), strs(&r["idPrefixes"]).or_else(|| strs(&m["idPrefixes"]))),
            _ => continue,
        };
        if name != resource { continue; }
        if let Some(t) = types { if !t.iter().any(|x| x == ty) { continue; } }
        if let Some(p) = prefixes { if !p.is_empty() && !p.iter().any(|x| id.starts_with(x.as_str())) { continue; } }
        return true;
    }
    false
}

impl Addons {
    pub fn new() -> Addons {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(12)).user_agent("Majlis").build().expect("http client");
        Addons { http, cache: Mutex::new(HashMap::new()) }
    }

    async fn get(&self, url: &str, ttl: Duration) -> Result<Value> {
        if let Some((t, v)) = self.cache.lock().unwrap().get(url) { if t.elapsed() < ttl { return Ok(v.clone()); } }
        let r = self.http.get(url).send().await?;
        if !r.status().is_success() { return Err(anyhow!("{} from {url}", r.status())); }
        let v: Value = r.json().await?;
        let mut c = self.cache.lock().unwrap();
        if c.len() > 2000 { c.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(60)); }
        c.insert(url.to_string(), (Instant::now(), v.clone()));
        Ok(v)
    }

    pub async fn manifest(&self, url: &str) -> Result<Value> {
        let m = self.get(&format!("{}/manifest.json", base(url)), Duration::from_secs(3600)).await?;
        if m["id"].as_str().is_none() || !m["resources"].is_array() { return Err(anyhow!("not a Stremio addon manifest")); }
        Ok(m)
    }

    pub async fn resource(&self, addon: &str, resource: &str, ty: &str, id: &str, extra: Option<&str>, ttl: Duration) -> Result<Value> {
        let extra = extra.filter(|e| !e.is_empty()).map(|e| format!("/{e}")).unwrap_or_default();
        self.get(&format!("{}/{}/{}/{}{}.json", base(addon), resource, enc(ty), enc(id), extra), ttl).await
    }

    // Ask every addon that serves it, all at once; a slow or dead addon only costs its own answer.
    pub async fn gather(&self, addons: &[String], resource: &str, ty: &str, id: &str, extra: Option<&str>, ttl: Duration) -> Vec<(Value, Value)> {
        let jobs = addons.iter().map(|a| async move {
            let m = self.manifest(a).await.ok()?;
            if !serves(&m, resource, ty, id) { return None; }
            let r = tokio::time::timeout(Duration::from_secs(10), self.resource(a, resource, ty, id, extra, ttl)).await.ok()?.ok()?;
            Some((m, r))
        });
        futures::future::join_all(jobs).await.into_iter().flatten().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn manifest_routing() {
        let m = json!({ "id": "x", "types": ["movie", "series"], "idPrefixes": ["tt"],
            "resources": ["catalog", { "name": "stream", "types": ["movie"], "idPrefixes": ["tt", "kitsu"] }, "meta"] });
        assert!(serves(&m, "stream", "movie", "tt0111161"));
        assert!(!serves(&m, "stream", "series", "tt0111161:1:1"));
        assert!(serves(&m, "meta", "series", "tt0944947"));
        assert!(!serves(&m, "meta", "movie", "kitsu:1"));
        assert!(!serves(&m, "subtitles", "movie", "tt1"));
    }

    #[test]
    fn urls() {
        assert_eq!(base("https://v3-cinemeta.strem.io/manifest.json"), "https://v3-cinemeta.strem.io");
        assert_eq!(base("stremio://a.example/x/manifest.json"), "https://a.example/x");
        assert_eq!(enc("tt0944947:1:2"), "tt0944947:1:2");
        assert_eq!(enc("genre=Sci-Fi & Fantasy"), "genre%3DSci-Fi%20%26%20Fantasy");
    }
}
