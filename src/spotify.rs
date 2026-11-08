use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;
use url::Url;

pub fn list_path(raw: &str) -> Option<(String, String)> {
    let url = Url::parse(raw.trim()).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    if host != "open.spotify.com" && host != "play.spotify.com" {
        return None;
    }
    let mut parts = url.path_segments()?.filter(|part| !part.is_empty());
    let mut first = parts.next()?;
    if first == "embed" {
        first = parts.next()?;
    }
    if first.starts_with("intl-") {
        first = parts.next()?;
    }
    let kind = first.to_string();
    let id = parts.next()?.to_string();
    if !matches!(kind.as_str(), "playlist" | "album") || id.is_empty() {
        return None;
    }
    Some((kind, id))
}

fn next_data(html: &str) -> Option<&str> {
    let marker = html.find("__NEXT_DATA__")?;
    let open = html[marker..].find('>')? + marker + 1;
    let close = html[open..].find("</script>")? + open;
    Some(&html[open..close])
}

pub async fn list(client: &Client, kind: &str, id: &str) -> Result<Value, String> {
    let url = format!("https://open.spotify.com/embed/{kind}/{id}");
    let response = client
        .get(&url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        )
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| format!("Spotify listesi alınamadı: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Spotify liste isteği {} döndürdü",
            response.status().as_u16()
        ));
    }
    let html = response
        .text()
        .await
        .map_err(|error| format!("Spotify yanıtı okunamadı: {error}"))?;
    let raw = next_data(&html).ok_or_else(|| "Spotify liste verisi bulunamadı".to_string())?;
    let payload: Value = serde_json::from_str(raw)
        .map_err(|error| format!("Spotify liste verisi okunamadı: {error}"))?;
    let entity = &payload["props"]["pageProps"]["state"]["data"]["entity"];

    let name = entity["name"]
        .as_str()
        .or_else(|| entity["title"].as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Spotify listesi");
    let subtitle = entity["subtitle"].as_str().unwrap_or("");
    let art = entity["coverArt"]["sources"]
        .as_array()
        .and_then(|sources| sources.last())
        .and_then(|source| source["url"].as_str())
        .map(str::to_string);

    let tracks: Vec<Value> = entity["trackList"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let title = item["title"].as_str()?.trim();
                    if title.is_empty() {
                        return None;
                    }
                    let artist = item["subtitle"].as_str().unwrap_or("").trim();
                    let duration = item["duration"].as_i64().unwrap_or(0).max(0) / 1000;
                    Some(json!({
                        "id": item["uri"].as_str().unwrap_or(""),
                        "title": title,
                        "artist": artist,
                        "duration": duration,
                    }))
                })
                .take(120)
                .collect()
        })
        .unwrap_or_default();

    Ok(json!({
        "kind": "spotify_list",
        "spotifyType": kind,
        "spotifyId": id,
        "name": name,
        "subtitle": subtitle,
        "art": art,
        "url": format!("https://open.spotify.com/{kind}/{id}"),
        "embed": format!("https://open.spotify.com/embed/{kind}/{id}?theme=0"),
        "tracks": tracks,
    }))
}
