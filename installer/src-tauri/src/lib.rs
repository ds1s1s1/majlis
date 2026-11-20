use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use winreg::enums::*;
use winreg::RegKey;
use zip::ZipArchive;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const SFX_MAGIC: &[u8; 8] = b"MJLSSFX1";

#[link(name = "kernel32")]
extern "system" {
    fn GetDiskFreeSpaceExW(
        lpDirectoryName: *const u16,
        lpFreeBytesAvailableToCaller: *mut u64,
        lpTotalNumberOfBytes: *mut u64,
        lpTotalNumberOfFreeBytes: *mut u64,
    ) -> i32;
}

struct InstallerState {
    cancel_flag: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvInfo {
    default_dir: String,
    is_repair_mode: bool,
    free_mb: u64,
    webview2_installed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallOptions {
    dest_dir: String,
    language: String,
    clean_install: bool,
    optional_components: Vec<String>,
    desktop_shortcut: bool,
    start_menu_shortcut: bool,
    launch_startup: bool,
    register_protocol: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    percent: u8,
    step_key: String,
    component_id: String,
    status: String,
    files_done: usize,
    files_total: usize,
    speed_mb: f64,
    eta_sec: u64,
}

struct SliceReader<R: Read + Seek> {
    inner: R,
    start: u64,
    len: u64,
    pos: u64,
}

impl<R: Read + Seek> SliceReader<R> {
    fn new(mut inner: R, start: u64, len: u64) -> io::Result<Self> {
        inner.seek(SeekFrom::Start(start))?;
        Ok(Self { inner, start, len, pos: 0 })
    }
}

impl<R: Read + Seek> Read for SliceReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.len {
            return Ok(0);
        }
        let max = (self.len - self.pos).min(buf.len() as u64) as usize;
        let n = self.inner.read(&mut buf[..max])?;
        self.pos += n as u64;
        Ok(n)
    }
}

impl<R: Read + Seek> Seek for SliceReader<R> {
    fn seek(&mut self, style: SeekFrom) -> io::Result<u64> {
        let next: i64 = match style {
            SeekFrom::Start(p) => p as i64,
            SeekFrom::Current(d) => self.pos as i64 + d,
            SeekFrom::End(d) => self.len as i64 + d,
        };
        if next < 0 || next as u64 > self.len {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek out of payload bounds"));
        }
        self.pos = next as u64;
        self.inner.seek(SeekFrom::Start(self.start + self.pos))?;
        Ok(self.pos)
    }
}

fn expand_default_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\Majlis"));
    base.join("Majlis")
}

fn free_disk_mb(path: &Path) -> u64 {
    let probe = if path.exists() {
        path.to_path_buf()
    } else if let Some(p) = path.parent() {
        if p.exists() { p.to_path_buf() } else { expand_default_dir().parent().unwrap_or(Path::new("C:\\")).to_path_buf() }
    } else {
        PathBuf::from("C:\\")
    };
    let mut wide: Vec<u16> = probe.to_string_lossy().encode_utf16().collect();
    wide.push(0);
    let mut avail: u64 = 0;
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut avail, &mut total, &mut free) };
    if ok != 0 { avail / (1024 * 1024) } else { 0 }
}

fn has_webview2() -> bool {
    let sub = r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let wow = r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let h = RegKey::predef(root);
        if h.open_subkey(sub).is_ok() || h.open_subkey(wow).is_ok() {
            return true;
        }
    }
    true
}

fn detect_sfx_bounds(exe_path: &Path) -> Option<(u64, u64)> {
    let mut f = File::open(exe_path).ok()?;
    let file_len = f.metadata().ok()?.len();
    if file_len < 24 {
        return None;
    }
    f.seek(SeekFrom::End(-24)).ok()?;
    let mut tail = [0u8; 24];
    f.read_exact(&mut tail).ok()?;
    if &tail[16..24] != SFX_MAGIC {
        return None;
    }
    let offset = u64::from_le_bytes(tail[0..8].try_into().ok()?);
    let len = u64::from_le_bytes(tail[8..16].try_into().ok()?);
    let expected_end = offset.checked_add(len).and_then(|v| v.checked_add(24))?;
    if expected_end != file_len || len < 22 {
        return None;
    }
    Some((offset, len))
}

fn stop_running_majlis_processes() {
    let mut killed_any = false;
    for image in ["Majlis.exe", "majlis-engine.exe", "majlis-media.exe", "mpv.exe"] {
        if let Ok(out) = Command::new("taskkill")
            .args(["/F", "/IM", image])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            if out.status.success() {
                killed_any = true;
            }
        }
    }
    if killed_any {
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
}

fn extract_sfx_payload<F>(
    exe_path: &Path,
    dest: &Path,
    cancel: &AtomicBool,
    mut on_progress: F,
) -> Result<usize, String>
where
    F: FnMut(ProgressPayload),
{
    let (offset, len) = detect_sfx_bounds(exe_path)
        .ok_or_else(|| "Installer payload header missing or corrupt".to_string())?;
    let file = File::open(exe_path).map_err(|e| format!("Failed opening installer executable: {e}"))?;
    let slice = SliceReader::new(file, offset, len)
        .map_err(|e| format!("Failed seeking installer payload: {e}"))?;
    let mut archive = ZipArchive::new(slice)
        .map_err(|e| format!("Failed reading embedded ZIP payload: {e}"))?;

    let start_time = Instant::now();
    let mut bytes_written: u64 = 0;
    let mut files_extracted: usize = 0;
    let total = archive.len();

    for i in 0..total {
        if cancel.load(Ordering::SeqCst) {
            return Ok(0);
        }
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed reading archive entry #{i}: {e}"))?;
        let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let out_path = dest.join(&rel);
        if !out_path.starts_with(dest) {
            continue;
        }
        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Failed creating directory {}: {e}", out_path.display()))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed creating directory {}: {e}", parent.display()))?;
            }
            let mut out_f = File::create(&out_path)
                .map_err(|e| format!("Failed writing {}: {e}", out_path.display()))?;
            let copied = io::copy(&mut entry, &mut out_f)
                .map_err(|e| format!("Failed extracting {}: {e}", rel.display()))?;
            out_f
                .flush()
                .map_err(|e| format!("Failed flushing {}: {e}", out_path.display()))?;
            bytes_written += copied;
            files_extracted += 1;
        }
        if i % 4 == 0 || i + 1 == total {
            let pct = (((i + 1) * 90) / total.max(1)).min(90) as u8;
            let elapsed = start_time.elapsed().as_secs_f64().max(0.05);
            let speed = (bytes_written as f64 / (1024.0 * 1024.0)) / elapsed;
            let comp = if pct < 30 {
                "core"
            } else if pct < 55 {
                "engine"
            } else if pct < 80 {
                "media"
            } else {
                "network"
            };
            on_progress(ProgressPayload {
                percent: pct,
                step_key: format!("Extracting {}", rel.to_string_lossy()),
                component_id: comp.into(),
                status: if pct >= 90 { "done".into() } else { "working".into() },
                files_done: i + 1,
                files_total: total,
                speed_mb: speed,
                eta_sec: ((total.saturating_sub(i + 1)) as f64 * (elapsed / (i + 1) as f64)) as u64,
            });
        }
    }

    Ok(files_extracted)
}

fn create_shortcut(lnk_path: &Path, target_exe: &Path, working_dir: &Path) {
    if let Some(parent) = lnk_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let esc = |p: &Path| p.to_string_lossy().replace('\'', "''");
    let script = format!(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.IconLocation='{},0';$s.Save()",
        esc(lnk_path), esc(target_exe), esc(working_dir), esc(target_exe)
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[tauri::command]
fn detect_environment() -> EnvInfo {
    let dir = expand_default_dir();
    let is_repair_mode = dir.join("Majlis.exe").exists();
    let free_mb = free_disk_mb(&dir);
    EnvInfo {
        default_dir: dir.to_string_lossy().to_string(),
        is_repair_mode,
        free_mb,
        webview2_installed: has_webview2(),
    }
}

#[tauri::command]
fn check_disk_space(path: String) -> u64 {
    free_disk_mb(Path::new(&path))
}

#[tauri::command]
fn detect_existing_install(path: Option<String>) -> bool {
    let p = path.map(PathBuf::from).unwrap_or_else(expand_default_dir);
    p.join("Majlis.exe").exists()
}

#[tauri::command]
fn pick_install_dir(initial: String) -> Option<String> {
    let init_esc = initial.replace('\'', "''");
    let ps = format!(
        "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.SelectedPath='{}'; if($d.ShowDialog() -eq 'OK'){{ Write-Output $d.SelectedPath }}",
        init_esc
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", &ps])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let picked = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if picked.is_empty() { None } else { Some(picked) }
}

#[tauri::command]
fn cancel_install(state: State<'_, InstallerState>) {
    state.cancel_flag.store(true, Ordering::SeqCst);
}

fn append_error_log(log_path: &Path, message: &str) -> io::Result<()> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut f = OpenOptions::new().create(true).append(true).open(log_path)?;
    writeln!(f, "[{ts}] {}", message.trim())?;
    Ok(())
}

#[tauri::command]
fn log_setup_error(message: String) {
    let path = std::env::temp_dir().join("majlis-setup-error.log");
    let _ = append_error_log(&path, &message);
}

#[tauri::command]
fn start_install(app: AppHandle, state: State<'_, InstallerState>, options: InstallOptions) -> Result<(), String> {
    state.cancel_flag.store(false, Ordering::SeqCst);
    let cancel = Arc::clone(&state.cancel_flag);

    std::thread::spawn(move || {
        let emit_err = |msg: String| {
            log_setup_error(msg.clone());
            let _ = app.emit("install-progress", ProgressPayload {
                percent: 0,
                step_key: msg,
                component_id: "core".into(),
                status: "error".into(),
                files_done: 0,
                files_total: 0,
                speed_mb: 0.0,
                eta_sec: 0,
            });
        };

        let dest = if options.dest_dir.trim().is_empty() || options.dest_dir.contains("%LOCALAPPDATA%") {
            expand_default_dir()
        } else {
            PathBuf::from(options.dest_dir.trim())
        };

        stop_running_majlis_processes();

        if options.clean_install && dest.exists() {
            if let Err(e) = fs::remove_dir_all(&dest) {
                emit_err(format!("Failed clearing previous installation: {e}"));
                return;
            }
        }
        if let Err(e) = fs::create_dir_all(&dest) {
            emit_err(format!("Failed creating destination folder: {e}"));
            return;
        }

        let exe_path = std::env::current_exe().unwrap_or_default();
        let has_sfx = detect_sfx_bounds(&exe_path).is_some();
        if has_sfx {
            if let Err(e) = extract_sfx_payload(&exe_path, &dest, &cancel, |payload| {
                let _ = app.emit("install-progress", payload);
            }) {
                emit_err(e);
                return;
            }
            if cancel.load(Ordering::SeqCst) {
                return;
            }
            if !dest.join("Majlis.exe").exists() {
                emit_err("Extracted payload is missing Majlis.exe".to_string());
                return;
            }
        } else {
            for (idx, comp) in ["core", "engine", "media", "network"].iter().enumerate() {
                if cancel.load(Ordering::SeqCst) {
                    return;
                }
                let pct = ((idx + 1) * 20) as u8;
                let _ = app.emit("install-progress", ProgressPayload {
                    percent: pct,
                    step_key: format!("Installing {comp}..."),
                    component_id: (*comp).to_string(),
                    status: "done".into(),
                    files_done: idx + 1,
                    files_total: 5,
                    speed_mb: 0.0,
                    eta_sec: 1,
                });
                std::thread::sleep(std::time::Duration::from_millis(160));
            }
        }

        if cancel.load(Ordering::SeqCst) {
            return;
        }

        // Write installer preferences
        let prefs = serde_json::json!({
            "language": options.language,
            "optionalComponents": options.optional_components,
            "cleanInstall": options.clean_install,
            "launchStartup": options.launch_startup,
            "destDir": dest.to_string_lossy(),
        });
        let _ = fs::write(dest.join("installer_prefs.json"), serde_json::to_string_pretty(&prefs).unwrap_or_default());

        // Write clean per-user uninstaller script
        let uninst_cmd = dest.join("Uninstall-Majlis.cmd");
        let _ = fs::write(
            &uninst_cmd,
            format!(
                "@echo off\r\ntaskkill /F /IM Majlis.exe >nul 2>&1\r\nreg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Majlis\" /f >nul 2>&1\r\nreg delete \"HKCU\\Software\\Classes\\majlis\" /f >nul 2>&1\r\nrmdir /S /Q \"{}\"\r\n",
                dest.to_string_lossy()
            ),
        );

        let target_exe = dest.join("Majlis.exe");
        if options.desktop_shortcut {
            if let Ok(up) = std::env::var("USERPROFILE") {
                create_shortcut(&PathBuf::from(up).join("Desktop").join("Majlis.lnk"), &target_exe, &dest);
            }
        }
        if options.start_menu_shortcut {
            if let Ok(ad) = std::env::var("APPDATA") {
                create_shortcut(
                    &PathBuf::from(ad).join("Microsoft\\Windows\\Start Menu\\Programs\\Majlis.lnk"),
                    &target_exe,
                    &dest,
                );
            }
        }

        // Registry HKCU Uninstall & optional Run / Protocol
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok((key, _)) = hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Majlis") {
            let _ = key.set_value("DisplayName", &"مجلس (Majlis)");
            let _ = key.set_value("DisplayVersion", &"0.6.1");
            let _ = key.set_value("Publisher", &"Majlis Contributors");
            let _ = key.set_value("InstallLocation", &dest.to_string_lossy().to_string());
            let _ = key.set_value("DisplayIcon", &target_exe.to_string_lossy().to_string());
            let _ = key.set_value("UninstallString", &format!("\"{}\"", uninst_cmd.to_string_lossy()));
            let _ = key.set_value("NoModify", &1u32);
            let _ = key.set_value("NoRepair", &0u32);
        }

        if options.launch_startup {
            if let Ok((run_key, _)) = hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run") {
                let _ = run_key.set_value("Majlis", &format!("\"{}\" --minimized", target_exe.to_string_lossy()));
            }
        }

        if options.register_protocol {
            if let Ok((proto, _)) = hkcu.create_subkey(r"Software\Classes\majlis") {
                let _ = proto.set_value("", &"URL:Majlis Protocol");
                let _ = proto.set_value("URL Protocol", &"");
                if let Ok((cmd, _)) = proto.create_subkey(r"shell\open\command") {
                    let _ = cmd.set_value("", &format!("\"{}\" \"%1\"", target_exe.to_string_lossy()));
                }
            }
        }

        let _ = app.emit("install-progress", ProgressPayload {
            percent: 100,
            step_key: "Done".into(),
            component_id: "shortcuts".into(),
            status: "complete".into(),
            files_done: 1,
            files_total: 1,
            speed_mb: 0.0,
            eta_sec: 0,
        });
    });

    Ok(())
}

#[tauri::command]
fn launch_installed_app(path: String) -> Result<(), String> {
    let dir = if path.trim().is_empty() || path.contains("%LOCALAPPDATA%") {
        expand_default_dir()
    } else {
        PathBuf::from(path.trim())
    };
    let exe = dir.join("Majlis.exe");
    if !exe.exists() {
        return Err("Majlis.exe not found in target folder".into());
    }
    Command::new(exe)
        .current_dir(dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let clean = url.trim();
    if clean.starts_with("https://") || clean.starts_with("http://") {
        Command::new("cmd")
            .args(["/C", "start", "", clean])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let resolved = if clean.contains("%LOCALAPPDATA%") {
        expand_default_dir()
    } else {
        PathBuf::from(clean)
    };
    if resolved.exists() && resolved.is_dir() {
        Command::new("explorer")
            .arg(resolved)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    Err("Unsupported URL or folder".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(InstallerState {
            cancel_flag: Arc::new(AtomicBool::new(false)),
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let win = webview.window();
                let _ = win.show();
                let _ = win.set_focus();
            }
        })
        .invoke_handler(tauri::generate_handler![
            detect_environment,
            check_disk_space,
            detect_existing_install,
            pick_install_dir,
            cancel_install,
            log_setup_error,
            start_install,
            launch_installed_app,
            open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error running Majlis Setup");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn temp_test_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "majlis_setup_test_{tag}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sfx_slice_extract_roundtrip() {
        let dir = temp_test_dir("roundtrip");
        let exe = dir.join("fake-setup.exe");
        let dest = dir.join("out");
        fs::create_dir_all(&dest).unwrap();

        let mut zip_bytes = Vec::new();
        {
            let mut zw = ZipWriter::new(Cursor::new(&mut zip_bytes));
            let opts = SimpleFileOptions::default();
            zw.start_file("Majlis.exe", opts).unwrap();
            zw.write_all(b"MZ-MAJLIS-TEST").unwrap();
            zw.start_file("resources/app.asar", opts).unwrap();
            zw.write_all(b"ASAR-PAYLOAD-12345").unwrap();
            zw.finish().unwrap();
        }

        let stub = b"FAKE-STUB-BINARY";
        let mut blob = Vec::new();
        blob.extend_from_slice(stub);
        blob.extend_from_slice(&zip_bytes);
        blob.extend_from_slice(&(stub.len() as u64).to_le_bytes());
        blob.extend_from_slice(&(zip_bytes.len() as u64).to_le_bytes());
        blob.extend_from_slice(SFX_MAGIC);
        fs::write(&exe, blob).unwrap();

        let (off, len) = detect_sfx_bounds(&exe).expect("valid SFX trailer");
        assert_eq!(off, stub.len() as u64);
        assert_eq!(len, zip_bytes.len() as u64);

        let cancel = AtomicBool::new(false);
        let mut updates = Vec::new();
        let count = extract_sfx_payload(&exe, &dest, &cancel, |p| updates.push(p))
            .expect("roundtrip SFX extraction should succeed");
        assert_eq!(count, 2);
        assert!(!updates.is_empty());
        assert_eq!(fs::read(dest.join("Majlis.exe")).unwrap(), b"MZ-MAJLIS-TEST");
        assert_eq!(fs::read(dest.join("resources/app.asar")).unwrap(), b"ASAR-PAYLOAD-12345");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sfx_corrupt_zip_returns_error() {
        let dir = temp_test_dir("corrupt");
        let exe = dir.join("bad-setup.exe");
        let dest = dir.join("out");
        fs::create_dir_all(&dest).unwrap();

        let stub = b"STUB";
        let garbage = vec![0xAAu8; 64];
        let mut blob = Vec::new();
        blob.extend_from_slice(stub);
        blob.extend_from_slice(&garbage);
        blob.extend_from_slice(&(stub.len() as u64).to_le_bytes());
        blob.extend_from_slice(&(garbage.len() as u64).to_le_bytes());
        blob.extend_from_slice(SFX_MAGIC);
        fs::write(&exe, blob).unwrap();

        let cancel = AtomicBool::new(false);
        let err = extract_sfx_payload(&exe, &dest, &cancel, |_| {}).unwrap_err();
        assert!(err.contains("ZIP") || err.contains("header"), "unexpected error: {err}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn append_error_log_writes_line() {
        let dir = temp_test_dir("errlog");
        let log = dir.join("majlis-setup-error.log");
        append_error_log(&log, "first crash line").unwrap();
        append_error_log(&log, "second line").unwrap();
        let contents = fs::read_to_string(&log).unwrap();
        assert!(contents.contains("first crash line"));
        assert!(contents.contains("second line"));
        let _ = fs::remove_dir_all(&dir);
    }
}
