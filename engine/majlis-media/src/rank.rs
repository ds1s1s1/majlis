// Picking the stream to play out of what the addons return. Addons describe streams in free text
// (Torrentio: "👤 312 💾 4.2 GB ⚙️ ..."), so the facts that matter are read out of name/title:
// resolution, seeders, size, debrid ("RD+", "[AD+]"...) and the release kind (CAM/TS are useless).
use serde_json::Value;

#[derive(Debug, Default, PartialEq)]
pub struct Facts { pub height: u32, pub seeders: u32, pub size_gb: f64, pub direct: bool, pub cam: bool, pub hdr: bool }

pub fn facts(s: &Value) -> Facts {
    let text = format!("{} {} {}", s["name"].as_str().unwrap_or(""), s["title"].as_str().unwrap_or(""), s["description"].as_str().unwrap_or("")).to_lowercase();
    let height = if text.contains("2160p") || text.contains("4k") || text.contains("uhd") { 2160 }
        else if text.contains("1440p") { 1440 } else if text.contains("1080p") { 1080 }
        else if text.contains("720p") { 720 } else if text.contains("480p") || text.contains(" sd ") || text.contains("[sd]") { 480 } else { 0 };
    let seeders = after(&text, "👤").or_else(|| after(&text, "seeders:")).map(|n| n as u32).unwrap_or(0);
    let size_gb = size(&text);
    // a URL stream plays at once (debrid / direct HTTP); an infoHash needs peers first
    let direct = s["url"].as_str().map(|u| u.starts_with("http")).unwrap_or(false);
    let cam = ["hdcam", "camrip", " cam ", "[cam]", "telesync", " ts ", "hdts", "hdtc"].iter().any(|k| text.contains(k));
    let hdr = text.contains("hdr") || text.contains("dolby vision") || text.contains(" dv ");
    Facts { height, seeders, size_gb, direct, cam, hdr }
}

// the first number after `mark`
fn after(text: &str, mark: &str) -> Option<f64> {
    let i = text.find(mark)? + mark.len();
    let num: String = text[i..].trim_start().chars().take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',').filter(|c| *c != ',').collect();
    num.parse().ok()
}

fn size(text: &str) -> f64 {
    for (unit, mul) in [(" gb", 1.0), (" mb", 1.0 / 1024.0), ("gb", 1.0), ("mb", 1.0 / 1024.0)] {
        if let Some(i) = text.find(unit) {
            let head: String = text[..i].chars().rev().take_while(|c| c.is_ascii_digit() || *c == '.').collect::<Vec<_>>().into_iter().rev().collect();
            if let Ok(v) = head.parse::<f64>() { return v * mul; }
        }
    }
    0.0
}

pub struct Prefs { pub max_height: u32, pub debrid_only: bool, pub down_mbps: f64 }

// Higher is better. Order of importance: plays at all, plays now, the wanted quality, healthy swarm.
pub fn score(f: &Facts, p: &Prefs) -> f64 {
    if f.cam { return -1e6; }
    if p.debrid_only && !f.direct { return -1e6; }
    let mut s = 0.0;
    if f.direct { s += 5000.0; }
    let h = if f.height == 0 { 720 } else { f.height };
    // the wanted height is best; above it costs (bandwidth), below it costs more (picture)
    s += if h <= p.max_height { h as f64 } else { p.max_height as f64 - (h - p.max_height) as f64 * 0.5 };
    if !f.direct { s += (f.seeders as f64 + 1.0).log2() * 120.0 - if f.seeders == 0 { 1500.0 } else { 0.0 }; }
    // a file whose average bitrate the line can't carry stalls: assume ~2 h of film
    if f.size_gb > 0.0 && p.down_mbps > 0.0 {
        let need_mbps = f.size_gb * 8192.0 / 7200.0;
        if need_mbps > p.down_mbps * 0.8 { s -= (need_mbps - p.down_mbps * 0.8) * 150.0; }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_torrentio_style_text() {
        let f = facts(&json!({ "name": "Torrentio\n1080p", "title": "Film.2024.1080p.WEB-DL\n👤 312 💾 4.2 GB ⚙️ ThePirateBay", "infoHash": "ab" }));
        assert_eq!((f.height, f.seeders, f.direct, f.cam), (1080, 312, false, false));
        assert!((f.size_gb - 4.2).abs() < 1e-9);
        let rd = facts(&json!({ "name": "[RD+] Torrentio 4k", "title": "Film 2160p HDR\n💾 18.5 GB", "url": "https://x.example/a.mkv" }));
        assert!(rd.direct && rd.hdr && rd.height == 2160);
        assert!(facts(&json!({ "title": "Film 2024 HDCAM x264" })).cam);
        assert_eq!(facts(&json!({ "title": "a 700 MB file" })).size_gb, 700.0 / 1024.0);
    }

    #[test]
    fn ranks_playable_over_pretty() {
        let p = Prefs { max_height: 1080, debrid_only: false, down_mbps: 20.0 };
        let good = facts(&json!({ "title": "1080p 👤 200 💾 3 GB", "infoHash": "a" }));
        let dead = facts(&json!({ "title": "1080p 👤 0 💾 3 GB", "infoHash": "b" }));
        let huge = facts(&json!({ "title": "2160p 👤 400 💾 60 GB", "infoHash": "c" }));
        let cam = facts(&json!({ "title": "HDCAM 1080p 👤 900", "infoHash": "d" }));
        let rd = facts(&json!({ "title": "720p", "url": "https://x/y.mp4" }));
        assert!(score(&good, &p) > score(&dead, &p));
        assert!(score(&good, &p) > score(&huge, &p));
        assert!(score(&good, &p) > score(&cam, &p));
        assert!(score(&rd, &p) > score(&good, &p));
        let only = Prefs { debrid_only: true, ..p };
        assert!(score(&good, &only) < 0.0);
    }
}
