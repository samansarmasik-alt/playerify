use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

const YTDLP_BYTES: &[u8] = include_bytes!("../yt-dlp.exe");

fn is_binary(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && meta.len() > 1_000_000)
        .unwrap_or(false)
}

fn embedded_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(
        PathBuf::from(base)
            .join("playerify")
            .join("bin")
            .join(format!("yt-dlp-{}.exe", YTDLP_BYTES.len())),
    )
}

fn ensure_embedded() -> Option<PathBuf> {
    let path = embedded_path()?;
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() == YTDLP_BYTES.len() as u64 {
            return Some(path);
        }
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    if std::fs::write(&temporary, YTDLP_BYTES).is_err() {
        let _ = std::fs::remove_file(&temporary);
        return None;
    }
    if std::fs::rename(&temporary, &path).is_ok() {
        return Some(path);
    }
    let _ = std::fs::remove_file(&temporary);
    std::fs::metadata(&path)
        .map(|meta| meta.len() == YTDLP_BYTES.len() as u64)
        .unwrap_or(false)
        .then_some(path)
}

fn find_ytdlp() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("YTDLP_PATH") {
        let custom = custom.trim();
        if !custom.is_empty() {
            return Some(PathBuf::from(custom));
        }
    }
    if let Some(path) = ensure_embedded() {
        return Some(path);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["yt-dlp.exe", "yt-dlp"] {
                let candidate = dir.join(name);
                if is_binary(&candidate) {
                    return Some(candidate);
                }
            }
        }
    }
    for name in ["yt-dlp.exe", "yt-dlp"] {
        let candidate = PathBuf::from(name);
        if is_binary(&candidate) {
            return Some(candidate);
        }
    }
    None
}

static YTDLP: OnceLock<Option<PathBuf>> = OnceLock::new();

pub fn ytdlp_path() -> PathBuf {
    YTDLP.get_or_init(find_ytdlp)
        .clone()
        .unwrap_or_else(|| PathBuf::from("yt-dlp.exe"))
}

pub fn resolve_audio(video_id: &str) -> Result<String, String> {
    let target = format!("https://www.youtube.com/watch?v={video_id}");
    let mut command = Command::new(ytdlp_path());
    command
        .arg("--no-playlist")
        .arg("--no-warnings")
        .arg("--no-progress")
        .arg("--no-continue")
        .arg("-f")
        .arg("bestaudio[ext=m4a]/bestaudio")
        .arg("-g")
        .arg(&target);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let output = command
        .output()
        .map_err(|error| format!("yt-dlp başlatılamadı: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let line = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("bilinmeyen hata");
        return Err(format!("Ses çıkarılamadı: {line}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("http"))
        .map(str::to_string)
        .ok_or_else(|| "Ses adresi alınamadı".to_string())
}
