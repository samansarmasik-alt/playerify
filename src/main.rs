#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audius;
mod cache;
mod extract;
mod providers;
mod resolve;
mod spotify;
mod youtube;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use cache::Cache;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use url::Url;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const DEFAULT_PORT: u16 = 7317;

#[derive(Clone)]
struct AppState {
    http: Client,
    cache: Arc<Mutex<Cache>>,
    audius: Arc<String>,
    spotify_id: Option<String>,
    spotify_secret: Option<String>,
    spotify_token: Arc<Mutex<Option<(Instant, String)>>>,
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    fn upstream(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_GATEWAY, message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

fn api_url(state: &AppState, path: &str, params: &[(&str, &str)]) -> String {
    let mut url = Url::parse(&format!("{}{}", state.audius, path)).expect("valid audius base");
    url.query_pairs_mut()
        .append_pair("app_name", audius::APP_NAME);
    for (key, value) in params {
        url.query_pairs_mut().append_pair(key, value);
    }
    url.into()
}

async fn fetch_json(
    state: &AppState,
    url: &str,
    ttl: u64,
    bearer: Option<&str>,
) -> Result<Value, ApiError> {
    let cached = { state.cache.lock().unwrap().get(url) };
    if let Some(value) = cached {
        return Ok(value);
    }
    let mut request = state.http.get(url).timeout(Duration::from_secs(20));
    if let Some(token) = bearer {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|error| ApiError::upstream(format!("Katalog isteği başarısız: {error}")))?;
    if !response.status().is_success() {
        return Err(ApiError::upstream(format!(
            "Katalog {} döndürdü",
            response.status().as_u16()
        )));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|error| ApiError::upstream(format!("Audius yanıtı okunamadı: {error}")))?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(ApiError::upstream(format!("Audius: {error}")));
    }
    state
        .cache
        .lock()
        .unwrap()
        .insert(url.to_string(), value.clone(), Duration::from_secs(ttl));
    Ok(value)
}

async fn audius_json(state: &AppState, url: &str, ttl: u64) -> Result<Value, ApiError> {
    fetch_json(state, url, ttl, None).await
}

async fn youtube_search(state: &AppState, query: &str, limit: usize) -> Vec<Value> {
    let key = format!("youtube:{}:{}", limit, query.to_lowercase());
    if let Some(cached) = state.cache.lock().unwrap().get(&key) {
        return cached.as_array().cloned().unwrap_or_default();
    }
    let items = youtube::search(&state.http, query, limit).await;
    state
        .cache
        .lock()
        .unwrap()
        .insert(key, Value::Array(items.clone()), Duration::from_secs(300));
    items
}

#[allow(dead_code)]
async fn spotify_token(state: &AppState) -> Option<String> {
    let id = state.spotify_id.as_ref()?;
    let secret = state.spotify_secret.as_ref()?;
    let cached = { state.spotify_token.lock().unwrap().clone() };
    if let Some((expires, token)) = cached {
        if expires > Instant::now() {
            return Some(token);
        }
    }
    let response = state
        .http
        .post("https://accounts.spotify.com/api/token")
        .basic_auth(id, Some(secret))
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body("grant_type=client_credentials")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let payload: Value = response.json().await.ok()?;
    let token = payload.get("access_token")?.as_str()?.to_string();
    let expires_in = payload
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(3600);
    state.spotify_token.lock().unwrap().replace((
        Instant::now() + Duration::from_secs(expires_in.saturating_sub(60)),
        token.clone(),
    ));
    Some(token)
}

fn state_path() -> std::path::PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("playerify").join("state.json")
}

async fn get_state() -> Json<Value> {
    let path = state_path();
    let value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or(Value::Null);
    Json(json!({ "value": value }))
}

#[derive(Deserialize)]
struct StatePayload {
    value: Value,
}

fn merge_state(existing: &Value, incoming: &Value) -> Value {
    if !existing.is_object() || !incoming.is_object() {
        return incoming.clone();
    }
    let mut merged = incoming.clone();

    let mut likes = existing
        .get("likes")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if let Some(items) = incoming.get("likes").and_then(Value::as_object) {
        for (key, value) in items {
            likes.insert(key.clone(), value.clone());
        }
    }
    merged["likes"] = Value::Object(likes);

    let mut playlists: Vec<Value> = Vec::new();
    let mut positions: HashMap<String, usize> = HashMap::new();
    for source in [existing, incoming] {
        if let Some(items) = source.get("playlists").and_then(Value::as_array) {
            for item in items {
                let Some(id) = item.get("id").and_then(Value::as_str) else {
                    continue;
                };
                if id.is_empty() {
                    continue;
                }
                if let Some(&index) = positions.get(id) {
                    playlists[index] = item.clone();
                } else {
                    positions.insert(id.to_string(), playlists.len());
                    playlists.push(item.clone());
                }
            }
        }
    }
    merged["playlists"] = Value::Array(playlists);

    let mut recent: Vec<Value> = Vec::new();
    let mut recent_positions: HashMap<String, usize> = HashMap::new();
    for source in [existing, incoming] {
        if let Some(items) = source.get("recent").and_then(Value::as_array) {
            for item in items {
                let Some(id) = item.get("id").and_then(Value::as_str) else {
                    continue;
                };
                if id.is_empty() {
                    continue;
                }
                if let Some(&index) = recent_positions.get(id) {
                    recent[index] = item.clone();
                } else {
                    recent_positions.insert(id.to_string(), recent.len());
                    recent.push(item.clone());
                }
            }
        }
    }
    recent.sort_by(|left, right| {
        let left = left.get("playedAt").and_then(Value::as_i64).unwrap_or(0);
        let right = right.get("playedAt").and_then(Value::as_i64).unwrap_or(0);
        right.cmp(&left)
    });
    recent.truncate(40);
    merged["recent"] = Value::Array(recent);
    merged
}

async fn put_state(Json(payload): Json<StatePayload>) -> Result<Json<Value>, ApiError> {
    let path = state_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let existing = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let state = match existing {
        Some(existing) => merge_state(&existing, &payload.value),
        None => payload.value,
    };
    let bytes = serde_json::to_vec(&state)
        .map_err(|error| ApiError::new(StatusCode::BAD_REQUEST, format!("Durum yazılamadı: {error}")))?;
    if bytes.len() > 5 * 1024 * 1024 {
        return Err(ApiError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Durum dosyası çok büyük",
        ));
    }
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, bytes)
        .map_err(|error| ApiError::upstream(format!("Durum dosyası yazılamadı: {error}")))?;
    std::fs::rename(&temporary, &path)
        .map_err(|error| ApiError::upstream(format!("Durum dosyası taşınamadı: {error}")))?;
    Ok(Json(json!({ "ok": true })))
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "version": VERSION,
        "build": build_id(),
        "audius": state.audius.as_str(),
        "spotify": state.spotify_id.is_some() && state.spotify_secret.is_some(),
        "providers": ["audius", "itunes", "deezer", "spotify", "youtube"],
    }))
}

async fn home(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let trending_url = api_url(
        &state,
        "/v1/tracks/trending",
        &[("time", "week"), ("limit", "30")],
    );
    let monthly_url = api_url(
        &state,
        "/v1/tracks/trending",
        &[("time", "month"), ("limit", "18")],
    );
    let playlists_url = api_url(&state, "/v1/playlists/trending", &[("limit", "8")]);

    let (trending, monthly, playlists) = tokio::join!(
        audius_json(&state, &trending_url, 300),
        audius_json(&state, &monthly_url, 300),
        audius_json(&state, &playlists_url, 300),
    );

    let trending = trending
        .map(|payload| audius::track_list(&payload["data"]))
        .unwrap_or_default();
    let monthly = monthly
        .map(|payload| audius::track_list(&payload["data"]))
        .unwrap_or_default();
    let playlists = playlists
        .map(|payload| audius::playlist_list(&payload["data"]))
        .unwrap_or_default();

    if trending.is_empty() && monthly.is_empty() && playlists.is_empty() {
        return Err(ApiError::upstream(
            "Audius kataloğuna ulaşılamadı. Bağlantını kontrol edip yeniden dene.",
        ));
    }

    let mut seen = HashSet::new();
    let mut artists = Vec::new();
    for track in trending.iter().chain(monthly.iter()) {
        if let Some(artist) = track.get("artist") {
            if let Some(id) = artist.get("id").and_then(Value::as_str) {
                if seen.insert(id.to_string()) {
                    artists.push(artist.clone());
                }
            }
        }
        if artists.len() >= 12 {
            break;
        }
    }

    Ok(Json(json!({
        "trending": trending,
        "monthly": monthly,
        "playlists": playlists,
        "artists": artists,
        "genres": audius::genre_list(),
    })))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

async fn search(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Value>, ApiError> {
    let raw = query.q.unwrap_or_default();
    let term = raw.trim();
    if term.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Arama boş olamaz"));
    }
    if term.chars().count() > 120 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Arama çok uzun",
        ));
    }

    let tracks_url = api_url(
        &state,
        "/v1/tracks/search",
        &[("query", term), ("limit", "100")],
    );
    let users_url = api_url(
        &state,
        "/v1/users/search",
        &[("query", term), ("limit", "8")],
    );
    let playlists_url = api_url(
        &state,
        "/v1/playlists/search",
        &[("query", term), ("limit", "8")],
    );
    let itunes_hint_url = format!(
        "https://itunes.apple.com/search?term={}&media=music&entity=song&limit=8",
        url_escape(term)
    );
    let deezer_hint_url = format!(
        "https://api.deezer.com/search?q={}&limit=8",
        url_escape(term)
    );

    let (tracks, users, playlists, itunes_hints, deezer_hints) = tokio::join!(
        audius_json(&state, &tracks_url, 120),
        audius_json(&state, &users_url, 120),
        audius_json(&state, &playlists_url, 120),
        fetch_json(&state, &itunes_hint_url, 300, None),
        fetch_json(&state, &deezer_hint_url, 300, None),
    );

    let mut candidates = tracks
        .map(|payload| audius::track_list(&payload["data"]))
        .unwrap_or_default();

    let itunes_payload = itunes_hints.ok();
    let deezer_payload = deezer_hints.ok();

    let mut artist_names: Vec<String> = Vec::new();
    if let Some(payload) = itunes_payload.as_ref() {
        for track in providers::itunes_tracks(payload).iter().take(8) {
            if let Some(name) = track["artist"]["name"].as_str() {
                artist_names.push(name.to_string());
            }
        }
    }
    if let Some(payload) = deezer_payload.as_ref() {
        for track in providers::deezer_tracks(payload).iter().take(8) {
            if let Some(name) = track["artist"]["name"].as_str() {
                artist_names.push(name.to_string());
            }
        }
    }

    let normalized_term = providers::normalize(term);
    let mut artists: Vec<(String, String, usize, usize, usize)> = Vec::new();
    for (position, name) in artist_names.iter().enumerate() {
        for part in name.split(['&', ',', '/']) {
            let cleaned = part
                .split(" feat.")
                .next()
                .unwrap_or(part)
                .split(" feat ")
                .next()
                .unwrap_or(part)
                .trim();
            let key = providers::normalize(cleaned);
            if key.is_empty() {
                continue;
            }
            let query_hits = key
                .split_whitespace()
                .filter(|token| normalized_term.split_whitespace().any(|word| word == *token))
                .count();
            if let Some(entry) = artists.iter_mut().find(|entry| entry.0 == key) {
                entry.2 += 1;
            } else {
                artists.push((key, cleaned.to_string(), 1, position, query_hits));
            }
        }
    }
    artists.sort_by(|left, right| {
        right
            .4
            .cmp(&left.4)
            .then(right.2.cmp(&left.2))
            .then(left.3.cmp(&right.3))
    });
    let hints: Vec<String> = artists
        .into_iter()
        .take(5)
        .map(|(_, display, _, _, _)| display)
        .collect();

    let enriched_info =
        providers::enriched_info(term, itunes_payload.as_ref(), deezer_payload.as_ref());
    let enriched = enriched_info
        .as_ref()
        .map(|(title, artist)| format!("{title} {artist}"));

    if let Some(enriched) = enriched.as_deref() {
        if providers::normalize(enriched) != normalized_term {
            let retry_url = api_url(
                &state,
                "/v1/tracks/search",
                &[("query", enriched), ("limit", "50")],
            );
            if let Ok(payload) = audius_json(&state, &retry_url, 120).await {
                candidates.extend(audius::track_list(&payload["data"]));
            }
        }
    }

    let suggestion = enriched_info.as_ref().and_then(|(title, artist)| {
        let full = providers::normalize(&format!("{title} {artist}"));
        let typo = normalized_term.split_whitespace().any(|token| {
            token.chars().count() >= 4
                && !full
                    .split_whitespace()
                    .any(|word| word == token)
        });
        typo.then(|| {
            json!({
                "label": format!("{title} — {artist}"),
                "query": format!("{title} {artist}"),
            })
        })
    });

    let youtube_query = enriched.clone().unwrap_or_else(|| term.to_string());
    candidates.extend(youtube_search(&state, &youtube_query, 10).await);

    let ranked: Vec<Value> = providers::rank(term, candidates, &hints)
        .into_iter()
        .filter(|track| {
            let source = track.get("source").and_then(Value::as_str).unwrap_or("");
            (source == "audius" || source == "youtube")
                && track.get("playable").and_then(Value::as_bool).unwrap_or(false)
                && !track.get("preview").and_then(Value::as_bool).unwrap_or(false)
        })
        .collect();
    let audius_count = ranked
        .iter()
        .filter(|track| track["source"] == "audius")
        .count();
    let youtube_count = ranked
        .iter()
        .filter(|track| track["source"] == "youtube")
        .count();
    let matches = providers::exact_matches(&ranked, term, 5);
    let suggestion = suggestion.filter(|value| {
        if ranked.is_empty() {
            return true;
        }
        let top_artist = ranked[0]
            .get("artist")
            .and_then(|artist| artist.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let suggested = value.get("query").and_then(Value::as_str).unwrap_or("");
        if top_artist.is_empty() || suggested.is_empty() {
            return true;
        }
        let top = providers::normalize(top_artist);
        let suggested = providers::normalize(suggested);
        top.is_empty() || suggested.contains(&top)
    });

    let users = users
        .ok()
        .and_then(|payload| payload.get("data").cloned())
        .unwrap_or(Value::Null);
    let playlists = playlists
        .ok()
        .and_then(|payload| payload.get("data").cloned())
        .unwrap_or(Value::Null);

    let artists: Vec<Value> = users
        .as_array()
        .map(|items| items.iter().map(audius::artist).collect())
        .unwrap_or_default();

    Ok(Json(json!({
        "query": term,
        "suggestion": suggestion,
        "tracks": ranked,
        "matches": matches,
        "artists": artists,
        "playlists": audius::playlist_list(&playlists),
        "providers": {
            "audius": audius_count,
            "youtube": youtube_count,
        },
    })))
}

#[derive(Deserialize)]
struct SpotifyListQuery {
    url: Option<String>,
}

async fn spotify_list(
    State(state): State<AppState>,
    Query(query): Query<SpotifyListQuery>,
) -> Result<Json<Value>, ApiError> {
    let raw = query.url.unwrap_or_default();
    let (kind, id) = spotify::list_path(&raw).ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Spotify liste veya albüm bağlantısı değil",
        )
    })?;
    let key = format!("spotify-list:{kind}:{id}");
    if let Some(cached) = state.cache.lock().unwrap().get(&key) {
        return Ok(Json(cached));
    }
    let payload = spotify::list(&state.http, &kind, &id)
        .await
        .map_err(|message| ApiError::upstream(message))?;
    state
        .cache
        .lock()
        .unwrap()
        .insert(key, payload.clone(), Duration::from_secs(600));
    Ok(Json(payload))
}

#[derive(Deserialize)]
struct MatchQuery {
    title: Option<String>,
    artist: Option<String>,
    duration: Option<i64>,
}

async fn youtube_match(
    State(state): State<AppState>,
    Query(query): Query<MatchQuery>,
) -> Result<Json<Value>, ApiError> {
    let title = query.title.unwrap_or_default();
    let artist = query.artist.unwrap_or_default();
    let duration = query.duration.unwrap_or(0).max(0);
    let title = title.trim();
    let artist = artist.trim();
    if title.is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Parça adı yok"));
    }
    if title.chars().count() > 200 || artist.chars().count() > 200 {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Sorgu çok uzun"));
    }
    let search_query = if artist.is_empty() {
        title.to_string()
    } else {
        format!("{title} {artist}")
    };
    let candidates = youtube_search(&state, &search_query, 12).await;
    let (matched, confidence, reason) =
        providers::import_match(title, artist, duration, candidates);
    Ok(Json(json!({
        "title": title,
        "artist": artist,
        "query": search_query,
        "match": matched,
        "confidence": confidence,
        "reason": reason,
    })))
}

#[derive(Deserialize)]
struct DiscoverQuery {
    genre: Option<String>,
    time: Option<String>,
    limit: Option<u32>,
}

async fn discover(
    State(state): State<AppState>,
    Query(query): Query<DiscoverQuery>,
) -> Result<Json<Value>, ApiError> {
    let genre = query.genre.unwrap_or_default().trim().to_string();
    let time = match query.time.as_deref() {
        Some("month") => "month",
        Some("all") => "all",
        _ => "week",
    };
    let limit = query.limit.unwrap_or(48).clamp(1, 100).to_string();

    let mut params: Vec<(&str, &str)> = vec![("time", time), ("limit", limit.as_str())];
    if !genre.is_empty() {
        params.push(("genre", genre.as_str()));
    }
    let url = api_url(&state, "/v1/tracks/trending", &params);
    let payload = audius_json(&state, &url, 300).await?;

    Ok(Json(json!({
        "genre": if genre.is_empty() { Value::Null } else { Value::String(genre) },
        "time": time,
        "tracks": audius::track_list(&payload["data"]),
    })))
}

fn data_value(payload: &Value) -> Value {
    let data = &payload["data"];
    if data.is_array() {
        data.get(0).cloned().unwrap_or(Value::Null)
    } else {
        data.clone()
    }
}

async fn track(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if !is_valid_id(&id) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Geçersiz parça kimliği"));
    }
    let url = api_url(&state, &format!("/v1/tracks/{id}"), &[]);
    let payload = audius_json(&state, &url, 600).await?;
    let data = data_value(&payload);
    Ok(Json(json!({ "track": audius::track(&data) })))
}

#[derive(Deserialize)]
struct ArtistQuery {
    sort: Option<String>,
}

async fn artist(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<ArtistQuery>,
) -> Result<Json<Value>, ApiError> {
    if !is_valid_id(&id) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Geçersiz sanatçı kimliği",
        ));
    }
    let sort = match query.sort.as_deref() {
        Some("new") => "date",
        _ => "plays",
    };
    let profile_url = api_url(&state, &format!("/v1/users/{id}"), &[]);
    let tracks_url = api_url(
        &state,
        &format!("/v1/users/{id}/tracks"),
        &[("limit", "50"), ("sort", sort)],
    );

    let (profile, tracks) = tokio::join!(
        audius_json(&state, &profile_url, 600),
        audius_json(&state, &tracks_url, 300),
    );

    let profile = data_value(&profile?);
    let tracks = tracks
        .map(|payload| audius::track_list(&payload["data"]))
        .unwrap_or_default();

    Ok(Json(json!({
        "artist": audius::artist(&profile),
        "tracks": tracks,
        "sort": sort,
    })))
}

async fn playlist(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if !is_valid_id(&id) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "Geçersiz liste kimliği"));
    }
    let detail_url = api_url(&state, &format!("/v1/playlists/{id}"), &[]);
    let tracks_url = api_url(
        &state,
        &format!("/v1/playlists/{id}/tracks"),
        &[("limit", "100")],
    );

    let (detail, tracks) = tokio::join!(
        audius_json(&state, &detail_url, 300),
        audius_json(&state, &tracks_url, 300),
    );

    let detail = data_value(&detail?);
    let tracks = tracks
        .map(|payload| audius::track_list(&payload["data"]))
        .unwrap_or_default();
    let total = detail["track_count"].as_u64().unwrap_or(0) as usize;

    Ok(Json(json!({
        "playlist": audius::playlist(&detail),
        "tracks": tracks,
        "limited": total > tracks.len(),
    })))
}

#[derive(Deserialize)]
struct ResolveQuery {
    url: Option<String>,
}

async fn resolve_link(
    State(state): State<AppState>,
    Query(query): Query<ResolveQuery>,
) -> Result<Json<Value>, ApiError> {
    let raw = query.url.unwrap_or_default();
    resolve::resolve(&state.http, &state.audius, &raw)
        .await
        .map(Json)
        .map_err(|message| ApiError::new(StatusCode::BAD_REQUEST, message))
}

#[derive(Deserialize)]
struct ImageQuery {
    u: Option<String>,
}

async fn image(State(state): State<AppState>, Query(query): Query<ImageQuery>) -> Response {
    let Some(raw) = query.u else {
        return ApiError::new(StatusCode::BAD_REQUEST, "Görsel adresi yok").into_response();
    };
    let Ok(url) = Url::parse(&raw) else {
        return ApiError::new(StatusCode::BAD_REQUEST, "Görsel adresi geçersiz").into_response();
    };
    if url.scheme() != "https" {
        return ApiError::new(StatusCode::BAD_REQUEST, "Yalnızca https görseller").into_response();
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if is_private_host(&host) {
        return ApiError::new(StatusCode::FORBIDDEN, "Bu görsel adresine izin yok").into_response();
    }

    let path = url.path().to_string();
    let mut candidates: Vec<String> = vec![url.to_string()];
    if path.contains("/content/") {
        for base in [
            "https://v.monophonic.digital",
            "https://v.audius.rickyrombo.com",
            "https://val017.open-audio-validator.com",
            "https://audius-figment-1-validator-19.figment.io",
        ] {
            let candidate = format!("{base}{path}");
            if !candidates.contains(&candidate) {
                candidates.push(candidate);
            }
        }
    }

    let mut found: Option<(String, Vec<u8>)> = None;
    for candidate in candidates {
        let response = match state
            .http
            .get(&candidate)
            .header("User-Agent", "playerify/0.1")
            .timeout(Duration::from_secs(12))
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => response,
            _ => continue,
        };
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        if !content_type.starts_with("image/") {
            continue;
        }
        if response.content_length().unwrap_or(0) > 10 * 1024 * 1024 {
            continue;
        }
        if let Ok(bytes) = response.bytes().await {
            if !bytes.is_empty() && bytes.len() <= 10 * 1024 * 1024 {
                found = Some((content_type, bytes.to_vec()));
                break;
            }
        }
    }

    let Some((content_type, bytes)) = found else {
        return ApiError::new(StatusCode::NOT_FOUND, "Görsel bulunamadı").into_response();
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .header("x-content-type-options", "nosniff")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn proxy_audio(
    state: &AppState,
    url: &str,
    headers: &HeaderMap,
    unreachable: &str,
    unavailable: &str,
) -> Response {
    let mut request = state
        .http
        .get(url)
        .header(header::ACCEPT_ENCODING, "identity")
        .header("User-Agent", "playerify/0.1");
    if let Some(range) = headers.get(header::RANGE) {
        request = request.header(header::RANGE, range.clone());
    }

    let upstream = match request.send().await {
        Ok(response) => response,
        Err(_) => {
            return ApiError::upstream(unreachable).into_response();
        }
    };

    let status = upstream.status();
    if !status.is_success() {
        return ApiError::new(StatusCode::NOT_FOUND, unavailable).into_response();
    }

    let mut builder = Response::builder().status(
        StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
    );
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::ETAG,
        header::LAST_MODIFIED,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            builder = builder.header(name, value.clone());
        }
    }

    builder
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .header("x-content-type-options", "nosniff")
        .header("access-control-allow-origin", "*")
        .body(Body::from_stream(upstream.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn stream(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !is_valid_id(&id) {
        return ApiError::new(StatusCode::BAD_REQUEST, "Geçersiz parça kimliği").into_response();
    }
    let url = api_url(&state, &format!("/v1/tracks/{id}/stream"), &[]);
    proxy_audio(
        &state,
        &url,
        &headers,
        "Ses akışına ulaşılamadı",
        "Bu parça şu anda oynatılamıyor",
    )
    .await
}

fn is_valid_youtube_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
}

async fn resolve_youtube_audio(state: &AppState, id: &str) -> Result<String, ApiError> {
    let key = format!("yt-audio:{id}");
    if let Some(cached) = state.cache.lock().unwrap().get(&key) {
        if let Some(url) = cached.as_str() {
            return Ok(url.to_string());
        }
    }
    let video_id = id.to_string();
    let resolved = tokio::task::spawn_blocking(move || extract::resolve_audio(&video_id))
        .await
        .map_err(|error| ApiError::upstream(format!("Ses çıkarıcı kapandı: {error}")))?;
    match resolved {
        Ok(url) => {
            state.cache.lock().unwrap().insert(
                key,
                Value::String(url.clone()),
                Duration::from_secs(3600),
            );
            Ok(url)
        }
        Err(message) => Err(ApiError::upstream(message)),
    }
}

async fn youtube_stream(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if !is_valid_youtube_id(&id) {
        return ApiError::new(StatusCode::BAD_REQUEST, "Geçersiz video kimliği").into_response();
    }
    let mut media = match resolve_youtube_audio(&state, &id).await {
        Ok(url) => url,
        Err(error) => return error.into_response(),
    };
    let mut response = proxy_audio(
        &state,
        &media,
        &headers,
        "YouTube ses akışına ulaşılamadı",
        "YouTube sesi şu anda oynatılamıyor",
    )
    .await;
    if response.status() == StatusCode::NOT_FOUND
        || response.status() == StatusCode::FORBIDDEN
        || response.status() == StatusCode::GONE
    {
        state
            .cache
            .lock()
            .unwrap()
            .remove(&format!("yt-audio:{id}"));
        media = match resolve_youtube_audio(&state, &id).await {
            Ok(url) => url,
            Err(error) => return error.into_response(),
        };
        response = proxy_audio(
            &state,
            &media,
            &headers,
            "YouTube ses akışına ulaşılamadı",
            "YouTube sesi şu anda oynatılamıyor",
        )
        .await;
    }
    response
}

#[derive(Deserialize)]
struct AudioQuery {
    u: Option<String>,
}

fn is_audio_host(host: &str) -> bool {
    host == "audio-ssl.itunes.apple.com"
        || host.ends_with(".mzstatic.com")
        || host.ends_with(".dzcdn.net")
        || host.ends_with(".scdn.co")
        || host.ends_with(".deezer.com")
}

async fn audio_proxy(
    State(state): State<AppState>,
    Query(query): Query<AudioQuery>,
    headers: HeaderMap,
) -> Response {
    let Some(raw) = query.u else {
        return ApiError::new(StatusCode::BAD_REQUEST, "Ses adresi yok").into_response();
    };
    let Ok(url) = Url::parse(&raw) else {
        return ApiError::new(StatusCode::BAD_REQUEST, "Ses adresi geçersiz").into_response();
    };
    if url.scheme() != "https" {
        return ApiError::new(StatusCode::BAD_REQUEST, "Yalnızca https ses").into_response();
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if !is_audio_host(&host) || is_private_host(&host) {
        return ApiError::new(StatusCode::FORBIDDEN, "Bu ses adresine izin yok").into_response();
    }

    let mut request = state
        .http
        .get(url.as_str())
        .header(header::ACCEPT_ENCODING, "identity")
        .header("User-Agent", "playerify/0.1");
    if let Some(range) = headers.get(header::RANGE) {
        request = request.header(header::RANGE, range.clone());
    }

    let upstream = match request.send().await {
        Ok(response) => response,
        Err(_) => return ApiError::upstream("Önizleme akışına ulaşılamadı").into_response(),
    };
    if !upstream.status().is_success() {
        return ApiError::new(StatusCode::NOT_FOUND, "Önizleme bulunamadı").into_response();
    }

    let mut builder = Response::builder().status(
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::OK),
    );
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
        header::ETAG,
        header::LAST_MODIFIED,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            builder = builder.header(name, value.clone());
        }
    }

    builder
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .header("x-content-type-options", "nosniff")
        .header("access-control-allow-origin", "*")
        .body(Body::from_stream(upstream.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn url_escape(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn is_private_host(host: &str) -> bool {
    if host.is_empty() {
        return true;
    }
    if host == "localhost" || host.ends_with(".localhost") || host == "::1" {
        return true;
    }
    if host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
        || host.starts_with("0.")
    {
        return true;
    }
    if let Some(rest) = host.strip_prefix("172.") {
        if let Some(second) = rest.split('.').next() {
            if let Ok(octet) = second.parse::<u8>() {
                if (16..=31).contains(&octet) {
                    return true;
                }
            }
        }
    }
    false
}

#[derive(rust_embed::RustEmbed)]
#[folder = "frontend/"]
struct Assets;

fn serve_asset(path: &str) -> Option<Response> {
    let file = Assets::get(path)?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let cache = if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    let policy = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://open.spotify.com; font-src 'self'; base-uri 'none'; form-action 'none'";
    Response::builder()
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, cache)
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "strict-origin-when-cross-origin")
        .header("content-security-policy", policy)
        .body(Body::from(file.data.into_owned()))
        .ok()
}

async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    if path.contains("..") {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(response) = serve_asset(path) {
        return response;
    }
    if path.contains('.') {
        return StatusCode::NOT_FOUND.into_response();
    }
    serve_asset("index.html").unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
}

struct Config {
    host: String,
    port: u16,
    open: bool,
    web: bool,
}

fn parse_args() -> Config {
    let mut config = Config {
        host: std::env::var("PLAYERIFY_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
        port: std::env::var("PLAYERIFY_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_PORT),
        open: true,
        web: false,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--port" | "-p" => {
                if let Some(value) = args.next() {
                    if let Ok(port) = value.parse() {
                        config.port = port;
                    }
                }
            }
            "--host" => {
                if let Some(value) = args.next() {
                    config.host = value;
                }
            }
            "--web" => config.web = true,
            "--no-open" => config.open = false,
            "--help" | "-h" => {
                println!(
                    "playerify {VERSION}\n\nKullanım: playerify [--port 7317] [--host 127.0.0.1] [--web] [--no-open]\n\n  --web       Arayüzü tarayıcıda aç (WebView2 yerine)\n  --no-open   Yalnızca sunucuyu çalıştır\n\nOrtam değişkenleri:\n  PLAYERIFY_PORT    Dinlenecek port\n  PLAYERIFY_HOST    Bağlanılacak adres\n  PLAYERIFY_AUDIUS  Audius API kökü\n  YTDLP_PATH        Harici yt-dlp yolu"
                );
                std::process::exit(0);
            }
            "--version" | "-V" => {
                println!("playerify {VERSION}");
                std::process::exit(0);
            }
            _ => {}
        }
    }
    config
}

fn build_id() -> String {
    let stamp = std::env::current_exe()
        .ok()
        .and_then(|path| path.metadata().ok())
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("{VERSION}-{stamp}")
}

fn instance_file() -> std::path::PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("playerify").join("port")
}

fn read_instance_port() -> Option<u16> {
    let text = std::fs::read_to_string(instance_file()).ok()?;
    text.trim().parse().ok()
}

fn write_instance_port(port: u16) {
    let path = instance_file();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, port.to_string());
}

fn instance_healthy(port: u16) -> bool {
    let address = format!("127.0.0.1:{port}");
    let Ok(address) = address.parse::<std::net::SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(350)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    let request = "GET /api/health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.take(4096).read_to_string(&mut response);
    response.contains("200 OK")
        && response.contains(&format!("\"build\":\"{}\"", build_id()))
        && response.contains("\"providers\"")
}

#[cfg(target_os = "windows")]
fn log_launch(message: &str) {
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("playerify.log")
    {
        let _ = writeln!(file, "{}", message);
    }
}

fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            let base = std::path::Path::new(&program_files);
            candidates.push(base.join("Microsoft/Edge/Application/msedge.exe"));
            candidates.push(base.join("Google/Chrome/Application/chrome.exe"));
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            let base = std::path::Path::new(&program_files_x86);
            candidates.push(base.join("Microsoft/Edge/Application/msedge.exe"));
            candidates.push(base.join("Google/Chrome/Application/chrome.exe"));
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let base = std::path::Path::new(&local_app_data);
            candidates.push(base.join("Google/Chrome/Application/chrome.exe"));
            candidates.push(base.join("Microsoft/Edge/Application/msedge.exe"));
        }
        log_launch(&format!("open_browser candidates: {:?}", candidates));
        let profile = std::env::var("LOCALAPPDATA")
            .ok()
            .map(|base| std::path::Path::new(&base).join("playerify").join("browser"));
        for candidate in candidates {
            if candidate.exists() {
                let app_argument = format!("--app={url}");
                let mut command = std::process::Command::new(&candidate);
                command
                    .arg(app_argument)
                    .arg("--window-size=1440,960")
                    .arg("--no-first-run")
                    .arg("--no-default-browser-check")
                    .arg("--disable-background-networking")
                    .arg("--disable-component-update")
                    .arg("--disable-sync")
                    .arg("--disable-features=Translate")
                    .arg("--metrics-recording-only");
                if let Some(profile) = &profile {
                    let _ = std::fs::create_dir_all(profile);
                    command.arg(format!("--user-data-dir={}", profile.display()));
                }
                match command.spawn()
                {
                    Ok(_) => {
                        log_launch(&format!("spawned app window: {:?}", candidate));
                        return;
                    }
                    Err(error) => {
                        log_launch(&format!("spawn failed {:?}: {}", candidate, error));
                    }
                }
            } else {
                log_launch(&format!("missing candidate: {:?}", candidate));
            }
        }
        match std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
        {
            Ok(_) => log_launch("fallback browser tab opened"),
            Err(error) => log_launch(&format!("fallback failed: {}", error)),
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

#[cfg(not(target_os = "windows"))]
fn log_launch(_message: &str) {}

fn app_icon() -> Option<tao::window::Icon> {
    let size = 64usize;
    let mut rgba = vec![0u8; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - 31.5;
            let dy = y as f32 - 31.5;
            let distance = (dx * dx + dy * dy).sqrt();
            let index = (y * size + x) * 4;
            let color = if distance < 6.0 {
                [61, 224, 209, 255]
            } else if (26.0..31.0).contains(&distance) {
                [61, 224, 209, 255]
            } else if distance < 26.0 {
                [13, 16, 25, 255]
            } else {
                [0, 0, 0, 0]
            };
            rgba[index..index + 4].copy_from_slice(&color);
        }
    }
    tao::window::Icon::from_rgba(rgba, size as u32, size as u32).ok()
}

fn open_native_window(url: &str) -> bool {
    use tao::event::{Event, WindowEvent};
    use tao::event_loop::{ControlFlow, EventLoop};
    use tao::window::WindowBuilder;
    use wry::{WebContext, WebViewBuilder};

    let data_dir = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("playerify")
        .join("webview2");
    let _ = std::fs::create_dir_all(&data_dir);
    let mut web_context = WebContext::new(Some(data_dir));

    let event_loop = EventLoop::new();
    let window = match WindowBuilder::new()
        .with_title("playerify")
        .with_window_icon(app_icon())
        .with_theme(Some(tao::window::Theme::Dark))
        .with_inner_size(tao::dpi::LogicalSize::new(1440.0, 960.0))
        .with_min_inner_size(tao::dpi::LogicalSize::new(900.0, 600.0))
        .with_visible(false)
        .build(&event_loop)
    {
        Ok(window) => window,
        Err(error) => {
            log_launch(&format!("native window failed: {error}"));
            return false;
        }
    };
    let webview = match WebViewBuilder::new_with_web_context(&mut web_context)
        .with_url(url)
        .with_background_color((17, 16, 19, 255))
        .build(&window)
    {
        Ok(webview) => webview,
        Err(error) => {
            log_launch(&format!("webview2 failed: {error}"));
            return false;
        }
    };
    window.set_visible(true);
    event_loop.run(move |event, _, control_flow| {
        let _ = (&webview, &web_context);
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}

async fn run_server(config: Config, port_sender: std::sync::mpsc::Sender<u16>) {
    let http = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(4)
        .user_agent(format!("playerify/{VERSION}"))
        .build()
        .expect("HTTP istemcisi kurulamadı");

    let audius_base = std::env::var("PLAYERIFY_AUDIUS")
        .unwrap_or_else(|_| "https://api.audius.co".to_string());

    let state = AppState {
        http,
        cache: Arc::new(Mutex::new(Cache::new(160))),
        audius: Arc::new(audius_base.trim_end_matches('/').to_string()),
        spotify_id: std::env::var("SPOTIFY_CLIENT_ID")
            .ok()
            .filter(|value| !value.trim().is_empty()),
        spotify_secret: std::env::var("SPOTIFY_CLIENT_SECRET")
            .ok()
            .filter(|value| !value.trim().is_empty()),
        spotify_token: Arc::new(Mutex::new(None)),
    };

    let api = Router::new()
        .route("/health", get(health))
        .route("/state", get(get_state).post(put_state))
        .route("/home", get(home))
        .route("/search", get(search))
        .route("/spotify/list", get(spotify_list))
        .route("/youtube/match", get(youtube_match))
        .route("/discover", get(discover))
        .route("/tracks/{id}", get(track))
        .route("/tracks/{id}/stream", get(stream))
        .route("/youtube/{id}/stream", get(youtube_stream))
        .route("/audio", get(audio_proxy))
        .route("/artists/{id}", get(artist))
        .route("/playlists/{id}", get(playlist))
        .route("/resolve", get(resolve_link))
        .route("/img", get(image))
        .with_state(state);

    let app = Router::new()
        .nest("/api", api)
        .fallback(static_handler);

    let mut port = config.port;
    let mut listener = None;
    for _ in 0..25 {
        match TcpListener::bind((config.host.as_str(), port)).await {
            Ok(bound) => {
                listener = Some(bound);
                break;
            }
            Err(_) => port = port.saturating_add(1),
        }
    }

    let listener = match listener {
        Some(listener) => listener,
        None => {
            let _ = port_sender.send(0);
            eprintln!("Boş port bulunamadı. --port ile başka bir port dene.");
            return;
        }
    };
    let _ = port_sender.send(port);

    let browser_host = match config.host.as_str() {
        "127.0.0.1" | "::1" | "0.0.0.0" | "::" => "localhost",
        other => other,
    };
    println!("\n  playerify {VERSION}");
    println!("  http://{browser_host}:{port}");

    if let Err(error) = axum::serve(listener, app).await {
        eprintln!("Sunucu kapandı: {error}");
    }
}

fn main() {
    let config = parse_args();
    let existing = read_instance_port().filter(|port| instance_healthy(*port));
    let mut server_started = false;
    let port = if let Some(port) = existing {
        port
    } else {
        let (sender, receiver) = std::sync::mpsc::channel();
        let host = config.host.clone();
        let preferred = config.port;
        let _ = std::thread::Builder::new()
            .name("playerify-server".into())
            .spawn(move || {
                let runtime = tokio::runtime::Builder::new_multi_thread()
                    .worker_threads(2)
                    .enable_all()
                    .build()
                    .expect("tokio çalışma zamanı kurulamadı");
                runtime.block_on(run_server(
                    Config {
                        host,
                        port: preferred,
                        open: false,
                        web: false,
                    },
                    sender,
                ));
            });
        let bound = receiver.recv_timeout(Duration::from_secs(15)).unwrap_or(0);
        if bound == 0 {
            eprintln!("Sunucu başlatılamadı.");
            std::process::exit(1);
        }
        write_instance_port(bound);
        server_started = true;
        bound
    };

    let url = format!("http://localhost:{port}");
    println!("playerify {VERSION} — {url}");

    if !config.open {
        if server_started {
            loop {
                std::thread::park();
            }
        }
        return;
    }

    if config.web {
        open_browser(&url);
        if server_started {
            loop {
                std::thread::park();
            }
        }
        return;
    }

    if open_native_window(&url) {
        return;
    }

    log_launch("native window unavailable; opening browser");
    open_browser(&url);
    if server_started {
        loop {
            std::thread::park();
        }
    }
}
