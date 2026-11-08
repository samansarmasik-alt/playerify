use reqwest::Client;
use serde_json::{json, Value};
use url::Url;

use crate::audius::{track, APP_NAME};

fn encode(input: &str) -> String {
    url::form_urlencoded::byte_serialize(input.as_bytes()).collect()
}

fn youtube_id(url: &Url) -> Option<String> {
    let host = url.host_str()?.to_ascii_lowercase();
    let candidate = if host == "youtu.be" {
        url.path().trim_matches('/').to_string()
    } else if host.ends_with("youtube.com") {
        if let Some(v) = url
            .query_pairs()
            .find(|(key, _)| key == "v")
            .map(|(_, value)| value.to_string())
        {
            v
        } else {
            let mut parts = url.path_segments()?.filter(|p| !p.is_empty());
            match (parts.next(), parts.next()) {
                (Some("shorts") | Some("embed") | Some("live"), Some(id)) => id.to_string(),
                _ => return None,
            }
        }
    } else {
        return None;
    };
    let valid = candidate.len() == 11
        && candidate
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    valid.then_some(candidate)
}

fn youtube_playlist(url: &Url) -> Option<String> {
    let host = url.host_str()?.to_ascii_lowercase();
    if !host.ends_with("youtube.com") {
        return None;
    }
    let list = url
        .query_pairs()
        .find(|(key, _)| key == "list")
        .map(|(_, value)| value.to_string())?;
    let valid = list.len() >= 10
        && list
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_');
    valid.then_some(list)
}

fn spotify_path(url: &Url) -> Option<(String, String)> {
    let host = url.host_str()?.to_ascii_lowercase();
    if host != "open.spotify.com" && host != "play.spotify.com" {
        return None;
    }
    let mut parts = url.path_segments()?.filter(|p| !p.is_empty());
    let mut first = parts.next()?;
    if first == "embed" {
        first = parts.next()?;
    }
    if first.starts_with("intl-") {
        first = parts.next()?;
    }
    let kind = first.to_string();
    let id = parts.next()?.to_string();
    let allowed = ["track", "album", "playlist", "artist", "episode", "show"];
    if !allowed.contains(&kind.as_str()) || id.is_empty() {
        return None;
    }
    Some((kind, id))
}

fn spotify_artists(html: &str) -> Option<String> {
    let marker = "\"artists\":[";
    let start = html.find(marker)? + marker.len();
    let rest = &html[start..];
    let end = rest.find(']')?;
    let block = &rest[..end];
    let mut names: Vec<String> = Vec::new();
    let mut cursor = block;
    while let Some(position) = cursor.find("\"name\":\"") {
        let after = &cursor[position + 8..];
        let Some(close) = after.find('"') else { break };
        let name = after[..close].replace("\\\"", "\"");
        if !name.is_empty() {
            names.push(name);
        }
        cursor = &after[close..];
    }
    if names.is_empty() {
        None
    } else {
        Some(names.join(", "))
    }
}

fn spotify_duration(html: &str) -> Option<i64> {
    let marker = "\"duration\":";
    let start = html.find(marker)? + marker.len();
    let digits: String = html[start..]
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();
    let milliseconds: i64 = digits.parse().ok()?;
    (milliseconds > 0).then_some(milliseconds / 1000)
}

async fn spotify_track_meta(client: &Client, id: &str) -> Option<(String, i64)> {
    let response = client
        .get(format!("https://open.spotify.com/embed/track/{id}"))
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        )
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let html = response.text().await.ok()?;
    let artists = spotify_artists(&html)?;
    Some((artists, spotify_duration(&html).unwrap_or(0)))
}

async fn oembed(client: &Client, endpoint: &str) -> Option<Value> {
    let response = client
        .get(endpoint)
        .header("User-Agent", "playerify/0.1")
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

pub async fn resolve(
    client: &Client,
    audius_base: &str,
    raw: &str,
) -> Result<Value, String> {
    let input = raw.trim();
    if input.is_empty() {
        return Err("Boş bağlantı".into());
    }
    let parsed = match Url::parse(input) {
        Ok(url) => url,
        Err(_) => return Ok(json!({ "kind": "search", "query": input })),
    };
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();

    if host == "audius.co" || host.ends_with(".audius.co") {
        let endpoint = format!(
            "{}/v1/resolve?url={}&app_name={}",
            audius_base,
            encode(input),
            APP_NAME
        );
        let response = client
            .get(endpoint)
            .header("User-Agent", "playerify/0.1")
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err("Bu Audius bağlantısı çözümlenemedi".into());
        }
        let payload: Value = response.json().await.map_err(|error| error.to_string())?;
        if let Some(data) = payload.get("data") {
            return Ok(json!({ "kind": "audius", "track": track(data) }));
        }
        return Err("Audius yanıtı beklenen biçimde değil".into());
    }

    if host == "deezer.com" || host.ends_with(".deezer.com") {
        let mut segments: Vec<String> = parsed
            .path_segments()
            .map(|segments| {
                segments
                    .filter(|part| !part.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        if segments.len() >= 3
            && segments[0].len() == 2
            && segments[0].chars().all(|character| character.is_ascii_alphabetic())
        {
            segments.remove(0);
        }
        if segments.len() >= 2
            && segments[0] == "track"
            && segments[1].chars().all(|character| character.is_ascii_digit())
        {
            let endpoint = format!("https://api.deezer.com/track/{}", segments[1]);
            if let Ok(response) = client
                .get(endpoint)
                .timeout(std::time::Duration::from_secs(15))
                .send()
                .await
            {
                if let Ok(payload) = response.json::<Value>().await {
                    let wrapped = json!({ "data": [payload] });
                    if let Some(track) = crate::providers::deezer_tracks(&wrapped).into_iter().next() {
                        return Ok(json!({ "kind": "deezer", "track": track }));
                    }
                }
            }
        }
        return Ok(json!({ "kind": "search", "query": input }));
    }

    if host == "music.apple.com" || host == "itunes.apple.com" || host.ends_with(".music.apple.com")
    {
        let segments: Vec<String> = parsed
            .path_segments()
            .map(|segments| {
                segments
                    .filter(|part| !part.is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let country = segments
            .first()
            .filter(|part| part.len() == 2 && part.chars().all(|character| character.is_ascii_alphabetic()))
            .map(|part| part.to_lowercase())
            .unwrap_or_else(|| "us".to_string());
        let track_id = parsed
            .query_pairs()
            .find(|(key, _)| key == "i")
            .map(|(_, value)| value.to_string())
            .or_else(|| {
                segments
                    .iter()
                    .position(|part| part.as_str() == "song")
                    .and_then(|index| segments.get(index + 1).cloned())
            })
            .or_else(|| {
                segments
                    .iter()
                    .rev()
                    .find(|part| !part.is_empty() && part.chars().all(|character| character.is_ascii_digit()))
                    .cloned()
            });
        if let Some(track_id) = track_id {
            let endpoint = format!(
                "https://itunes.apple.com/lookup?id={}&country={}&entity=song&limit=25",
                encode(&track_id),
                encode(&country)
            );
            if let Ok(response) = client
                .get(endpoint)
                .timeout(std::time::Duration::from_secs(15))
                .send()
                .await
            {
                if let Ok(payload) = response.json::<Value>().await {
                    if let Some(track) = crate::providers::itunes_tracks(&payload).into_iter().next() {
                        return Ok(json!({ "kind": "itunes", "track": track }));
                    }
                }
            }
        }
        return Ok(json!({ "kind": "search", "query": input }));
    }

    if let Some(video_id) = youtube_id(&parsed) {
        let oembed_url = format!(
            "https://www.youtube.com/oembed?url={}&format=json",
            encode(&format!("https://www.youtube.com/watch?v={video_id}"))
        );
        let meta = oembed(client, &oembed_url).await;
        let title = meta
            .as_ref()
            .and_then(|m| m.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("YouTube videosu");
        let author = meta
            .as_ref()
            .and_then(|m| m.get("author_name"))
            .and_then(Value::as_str)
            .unwrap_or("YouTube");
        let thumbnail = meta
            .as_ref()
            .and_then(|m| m.get("thumbnail_url"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"));
        return Ok(json!({
            "kind": "youtube",
            "videoId": video_id,
            "title": title,
            "author": author,
            "thumbnail": thumbnail,
            "url": input,
            "embed": format!("https://www.youtube-nocookie.com/embed/{video_id}?autoplay=1&rel=0&modestbranding=1"),
        }));
    }

    if let Some(playlist_id) = youtube_playlist(&parsed) {
        return Ok(json!({
            "kind": "youtube_playlist",
            "playlistId": playlist_id,
            "title": "YouTube listesi",
            "url": input,
            "embed": format!("https://www.youtube-nocookie.com/embed/videoseries?list={playlist_id}&autoplay=1&rel=0"),
        }));
    }

    if let Some((kind, id)) = spotify_path(&parsed) {
        let oembed_url = format!("https://open.spotify.com/oembed?url={}", encode(input));
        let meta = oembed(client, &oembed_url).await;
        let title = meta
            .as_ref()
            .and_then(|m| m.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("Spotify");
        let thumbnail = meta
            .as_ref()
            .and_then(|m| m.get("thumbnail_url"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let (artist, duration) = if kind == "track" {
            match spotify_track_meta(client, &id).await {
                Some((artist, duration)) => (Value::String(artist), duration),
                None => (Value::Null, 0),
            }
        } else {
            (Value::Null, 0)
        };
        return Ok(json!({
            "kind": "spotify",
            "spotifyType": kind,
            "spotifyId": id,
            "title": title,
            "artist": artist,
            "duration": duration,
            "thumbnail": thumbnail,
            "url": input,
            "embed": format!("https://open.spotify.com/embed/{kind}/{id}?theme=0"),
        }));
    }

    Ok(json!({ "kind": "search", "query": input }))
}
