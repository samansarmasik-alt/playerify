use serde_json::{json, Value};

pub const APP_NAME: &str = "PLAYERIFY";

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn text_capped(value: &Value, key: &str, cap: usize) -> Option<String> {
    text(value, key).map(|s| {
        if s.chars().count() > cap {
            let mut out: String = s.chars().take(cap).collect();
            out.push('…');
            out
        } else {
            s
        }
    })
}

fn number(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn float(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn boolean(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn artwork(value: &Value, size: &str) -> Option<String> {
    value
        .get("artwork")
        .and_then(|art| art.get(size))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn profile_picture(value: &Value) -> Option<String> {
    value
        .get("profile_picture")
        .and_then(|pic| pic.get("480x480"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn cover_photo(value: &Value) -> Option<String> {
    value
        .get("cover_photo")
        .and_then(|pic| pic.get("640x"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub fn artist(value: &Value) -> Value {
    json!({
        "id": text(value, "id"),
        "name": text(value, "name").unwrap_or_else(|| "Bilinmeyen sanatçı".into()),
        "handle": text(value, "handle"),
        "verified": boolean(value, "is_verified"),
        "avatar": profile_picture(value),
        "cover": cover_photo(value),
        "bio": text_capped(value, "bio", 1200),
        "followers": number(value, "follower_count"),
        "tracks": number(value, "track_count"),
        "location": text(value, "location"),
        "permalink": text(value, "permalink"),
    })
}

pub fn track(value: &Value) -> Value {
    let user = value.get("user").filter(|u| !u.is_null());
    let verified = user.map(|u| boolean(u, "is_verified")).unwrap_or(false);
    let streamable = boolean(value, "is_streamable")
        && boolean(value, "is_available")
        && !boolean(value, "is_delete")
        && value
            .get("access")
            .and_then(|access| access.get("stream"))
            .and_then(Value::as_bool)
            .unwrap_or(true);
    json!({
        "id": text(value, "id"),
        "title": text(value, "title").unwrap_or_else(|| "Adsız parça".into()),
        "artist": user.map(artist),
        "art": artwork(value, "1000x1000").or_else(|| artwork(value, "480x480")),
        "artSm": artwork(value, "480x480").or_else(|| artwork(value, "150x150")),
        "duration": number(value, "duration"),
        "fullDuration": number(value, "duration"),
        "genre": text(value, "genre"),
        "bpm": float(value, "bpm"),
        "key": text(value, "musical_key"),
        "plays": number(value, "play_count"),
        "likes": number(value, "favorite_count"),
        "reposts": number(value, "repost_count"),
        "description": text_capped(value, "description", 2400),
        "tags": text(value, "tags"),
        "released": text(value, "release_date"),
        "permalink": text(value, "permalink"),
        "downloadable": boolean(value, "is_downloadable"),
        "verified": verified,
        "source": "audius",
        "sourceLabel": "Audius",
        "preview": false,
        "playable": streamable,
        "stream": Value::Null,
        "external": text(value, "permalink").map(|permalink| format!("https://audius.co{permalink}")),
        "album": Value::Null,
        "popularity": number(value, "play_count"),
        "explicit": false,
    })
}

pub fn playlist(value: &Value) -> Value {
    json!({
        "id": text(value, "id"),
        "name": text(value, "playlist_name").unwrap_or_else(|| "Adsız liste".into()),
        "art": artwork(value, "1000x1000"),
        "artSm": artwork(value, "480x480"),
        "trackCount": number(value, "track_count"),
        "description": text_capped(value, "description", 1200),
        "isAlbum": boolean(value, "is_album"),
        "permalink": text(value, "permalink"),
        "user": value.get("user").filter(|u| !u.is_null()).map(artist),
    })
}

pub fn track_list(data: &Value) -> Vec<Value> {
    data.as_array()
        .map(|items| items.iter().map(track).collect())
        .unwrap_or_default()
}

pub fn playlist_list(data: &Value) -> Vec<Value> {
    data.as_array()
        .map(|items| items.iter().map(playlist).collect())
        .unwrap_or_default()
}

pub fn genre_list() -> Vec<&'static str> {
    vec![
        "Electronic",
        "Hip-Hop/Rap",
        "Pop",
        "Rock",
        "R&B/Soul",
        "Alternative",
        "House",
        "Techno",
        "Dubstep",
        "Drum & Bass",
        "Lo-Fi",
        "Ambient",
        "Trap",
        "Jazz",
    ]
}
