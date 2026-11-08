use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;

const SEARCH_URL: &str =
    "https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const CLIENT_VERSION: &str = "2.20240701.00.00";

fn runs_text(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(text) = value.get("simpleText").and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    let runs = value.get("runs")?.as_array()?;
    let joined: String = runs
        .iter()
        .filter_map(|run| run.get("text").and_then(Value::as_str))
        .collect();
    let trimmed = joined.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn parse_duration(text: &str) -> i64 {
    let mut total = 0i64;
    for part in text.trim().split(':') {
        let value: i64 = part.trim().parse().unwrap_or(0);
        total = total.saturating_mul(60).saturating_add(value);
    }
    total
}

fn parse_count(text: &str) -> i64 {
    let token = text
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let (digits, multiplier) = if let Some(rest) = token.strip_suffix('b') {
        (rest, 1_000_000_000f64)
    } else if let Some(rest) = token.strip_suffix('m') {
        (rest, 1_000_000f64)
    } else if let Some(rest) = token.strip_suffix('k') {
        (rest, 1_000f64)
    } else {
        (token.as_str(), 1f64)
    };
    let mut cleaned = String::new();
    for character in digits.chars() {
        if character.is_ascii_digit() {
            cleaned.push(character);
        } else if character == ',' || character == '.' {
            if multiplier > 1.0 {
                cleaned.push('.');
            }
        }
    }
    let value: f64 = cleaned.parse().unwrap_or(0.0);
    (value * multiplier).round() as i64
}

fn collect_videos(node: &Value, out: &mut Vec<Value>) {
    match node {
        Value::Object(map) => {
            if let Some(video) = map.get("videoRenderer") {
                out.push(video.clone());
            }
            for value in map.values() {
                collect_videos(value, out);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_videos(item, out);
            }
        }
        _ => {}
    }
}

fn track(video: &Value) -> Option<Value> {
    let id = video.get("videoId")?.as_str()?.to_string();
    if id.is_empty() {
        return None;
    }
    let title = runs_text(video.get("title"))?;
    let author = runs_text(video.get("ownerText"))
        .or_else(|| runs_text(video.get("longBylineText")))
        .unwrap_or_else(|| "YouTube".into());
    let duration = video
        .get("lengthText")
        .and_then(|length| length.get("simpleText"))
        .and_then(Value::as_str)
        .map(parse_duration)
        .unwrap_or(0);
    if duration <= 0 || duration > 3600 {
        return None;
    }
    let thumbnails = video
        .get("thumbnail")
        .and_then(|thumbnail| thumbnail.get("thumbnails"))
        .and_then(Value::as_array);
    let art = thumbnails
        .and_then(|list| list.last())
        .and_then(|item| item.get("url"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let art_sm = thumbnails
        .and_then(|list| list.first())
        .and_then(|item| item.get("url"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let popularity = video
        .get("viewCountText")
        .and_then(|views| views.get("simpleText"))
        .and_then(Value::as_str)
        .map(parse_count)
        .unwrap_or(0);
    let channel_verified = video
        .get("ownerBadges")
        .and_then(Value::as_array)
        .map(|badges| {
            badges.iter().any(|badge| {
                badge
                    .get("metadataBadgeRenderer")
                    .and_then(|renderer| renderer.get("style"))
                    .and_then(Value::as_str)
                    .map(|style| style == "BADGE_STYLE_TYPE_VERIFIED")
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false);

    Some(json!({
        "id": format!("yt:{id}"),
        "source": "youtube",
        "sourceLabel": "YouTube",
        "title": title,
        "artist": {
            "id": Value::Null,
            "name": author,
            "verified": channel_verified,
            "avatar": Value::Null,
        },
        "art": art,
        "artSm": art_sm,
        "duration": duration,
        "fullDuration": duration,
        "genre": Value::Null,
        "bpm": Value::Null,
        "key": Value::Null,
        "plays": popularity,
        "likes": 0,
        "reposts": 0,
        "description": Value::Null,
        "tags": Value::Null,
        "released": Value::Null,
        "permalink": Value::Null,
        "downloadable": false,
        "verified": channel_verified,
        "preview": false,
        "playable": true,
        "stream": Value::Null,
        "external": format!("https://www.youtube.com/watch?v={id}"),
        "album": Value::Null,
        "popularity": popularity,
        "explicit": false,
        "kind": "youtube",
        "videoId": id,
        "author": author,
        "embed": format!("https://www.youtube-nocookie.com/embed/{id}?autoplay=1&rel=0&modestbranding=1&playsinline=1"),
    }))
}

pub async fn search(client: &Client, query: &str, limit: usize) -> Vec<Value> {
    let term = query.trim();
    if term.is_empty() {
        return Vec::new();
    }
    let body = json!({
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": CLIENT_VERSION,
                "hl": "tr",
                "gl": "TR",
            }
        },
        "query": term,
    });
    let response = match client
        .post(SEARCH_URL)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
        .header("Accept-Language", "tr-TR,tr;q=0.9,en;q=0.6")
        .json(&body)
        .timeout(Duration::from_secs(12))
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return Vec::new(),
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    let payload: Value = match response.json().await {
        Ok(payload) => payload,
        Err(_) => return Vec::new(),
    };
    let mut videos = Vec::new();
    collect_videos(&payload, &mut videos);

    let mut out = Vec::new();
    for video in videos.iter() {
        if let Some(mut item) = track(video) {
            item["order"] = json!(out.len());
            out.push(item);
            if out.len() >= limit {
                break;
            }
        }
    }
    out
}
