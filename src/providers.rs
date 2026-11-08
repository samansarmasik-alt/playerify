use serde_json::{json, Value};
use std::collections::HashSet;

const PENALTIES: &[(&str, i32)] = &[
    ("type beat", 160),
    ("instrumental", 90),
    ("karaoke", 160),
    ("backing track", 160),
    ("reaction", 160),
    ("nightcore", 160),
    ("sped up", 140),
    ("speed up", 140),
    ("slowed", 120),
    ("reverb", 90),
    ("8d", 130),
    ("tribute", 100),
    ("made famous", 120),
    ("originally performed", 140),
    ("lullaby", 120),
    ("for babies", 140),
    ("piano version", 90),
    ("cover", 45),
    ("remix", 30),
];

pub fn normalize(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars().flat_map(char::to_lowercase) {
        match ch {
            '\u{0300}'..='\u{036f}' => {}
            'ı' | 'î' | 'í' | 'ì' | 'ï' => out.push('i'),
            'ş' => out.push('s'),
            'ğ' => out.push('g'),
            'ü' | 'û' | 'ú' | 'ù' => out.push('u'),
            'ö' | 'ô' | 'ó' | 'ò' | 'õ' => out.push('o'),
            'ç' => out.push('c'),
            'â' | 'á' | 'à' | 'ä' | 'ã' | 'å' => out.push('a'),
            'é' | 'è' | 'ê' | 'ë' => out.push('e'),
            'ñ' => out.push('n'),
            'ý' | 'ÿ' => out.push('y'),
            'ø' => out.push('o'),
            'ß' => out.push_str("ss"),
            'æ' => out.push_str("ae"),
            'œ' => out.push_str("oe"),
            'ł' => out.push('l'),
            '&' => out.push(' '),
            '\'' | '’' | '`' | '´' => out.push(' '),
            c if c.is_alphanumeric() => out.push(c),
            _ => out.push(' '),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn edit_distance(left: &str, right: &str) -> usize {
    let left: Vec<char> = left.chars().collect();
    let right: Vec<char> = right.chars().collect();
    if left.is_empty() {
        return right.len();
    }
    if right.is_empty() {
        return left.len();
    }
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0usize; right.len() + 1];
    for (row, left_char) in left.iter().enumerate() {
        current[0] = row + 1;
        for (column, right_char) in right.iter().enumerate() {
            let cost = if left_char == right_char { 0 } else { 1 };
            let deletion = previous[column + 1] + 1;
            let insertion = current[column] + 1;
            let substitution = previous[column] + cost;
            current[column + 1] = deletion.min(insertion).min(substitution);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

fn is_adjacent_transposition(left: &str, right: &str) -> bool {
    let left: Vec<char> = left.chars().collect();
    let right: Vec<char> = right.chars().collect();
    if left.len() != right.len() {
        return false;
    }
    let mut differences = Vec::new();
    for (index, (a, b)) in left.iter().zip(right.iter()).enumerate() {
        if a != b {
            differences.push(index);
            if differences.len() > 2 {
                return false;
            }
        }
    }
    differences.len() == 2
        && differences[0] + 1 == differences[1]
        && left[differences[0]] == right[differences[1]]
        && left[differences[1]] == right[differences[0]]
}

fn token_fuzzy(token: &str, text: &str) -> bool {
    let length = token.chars().count();
    if length < 4 {
        return false;
    }
    let allowance = if length <= 6 { 1 } else { 2 };
    text.split_whitespace().any(|word| {
        (word.chars().count().abs_diff(length) <= allowance
            && edit_distance(token, word) <= allowance)
            || is_adjacent_transposition(token, word)
    })
}

fn text_matches(text: &str, token: &str) -> bool {
    text.contains(token) || token_fuzzy(token, text)
}

fn phrase_matches(text: &str, phrase: &str) -> bool {
    text.contains(phrase)
        || (!phrase.is_empty()
            && phrase
                .split_whitespace()
                .all(|token| text_matches(text, token)))
}

fn all_tokens_match(text: &str, tokens: &[&str]) -> bool {
    tokens.iter().all(|token| text_matches(text, token))
}

fn string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn nested_string(value: &Value, keys: &[&str]) -> Option<String> {
    let mut cursor = value;
    for key in keys {
        cursor = cursor.get(key)?;
    }
    cursor.as_str().map(str::to_string)
}

fn number(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn provider_track(
    id: String,
    source: &str,
    source_label: &str,
    title: String,
    artist: String,
    art: Option<String>,
    art_sm: Option<String>,
    duration: i64,
    genre: Option<String>,
    released: Option<String>,
    album: Option<String>,
    preview: Option<String>,
    external: Option<String>,
    explicit: bool,
    popularity: i64,
) -> Value {
    json!({
        "id": id,
        "source": source,
        "sourceLabel": source_label,
        "title": title,
        "artist": {
            "id": Value::Null,
            "name": artist,
            "verified": false,
            "avatar": Value::Null,
        },
        "art": art,
        "artSm": art_sm,
        "duration": duration,
        "genre": genre,
        "bpm": Value::Null,
        "key": Value::Null,
        "plays": 0,
        "likes": 0,
        "description": Value::Null,
        "tags": Value::Null,
        "released": released,
        "permalink": Value::Null,
        "verified": false,
        "preview": preview.is_some(),
        "playable": preview.is_some(),
        "stream": preview,
        "external": external,
        "album": album,
        "explicit": explicit,
        "popularity": popularity,
    })
}

pub fn itunes_tracks(payload: &Value) -> Vec<Value> {
    let Some(items) = payload.get("results").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .enumerate()
        .filter_map(|(order, item)| {
            let title = string(item, "trackName")?;
            let artist = string(item, "artistName").unwrap_or_else(|| "Bilinmeyen".into());
            let track_id = number(item, "trackId");
            if track_id == 0 {
                return None;
            }
            let art100 = string(item, "artworkUrl100");
            let art = art100.as_ref().map(|url| url.replace("100x100bb", "600x600bb"));
            let duration = (number(item, "trackTimeMillis") / 1000).max(0);
            let preview = string(item, "previewUrl");
            let has_preview = preview.is_some();
            let external = string(item, "trackViewUrl");
            let mut track = provider_track(
                format!("itunes:{track_id}"),
                "itunes",
                "Apple Music",
                title,
                artist,
                art,
                art100,
                duration,
                string(item, "primaryGenreName"),
                string(item, "releaseDate"),
                string(item, "collectionName"),
                preview,
                external,
                item.get("trackExplicitness")
                    .and_then(Value::as_str)
                    .map(|value| value == "explicit")
                    .unwrap_or(false),
                0,
            );
            track["order"] = json!(order);
            track["fullDuration"] = json!(duration);
            if has_preview {
                track["duration"] = json!(30);
            }
            Some(track)
        })
        .collect()
}

pub fn deezer_tracks(payload: &Value) -> Vec<Value> {
    let Some(items) = payload.get("data").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .enumerate()
        .filter_map(|(order, item)| {
            let title = string(item, "title")?;
            let artist = nested_string(item, &["artist", "name"]).unwrap_or_else(|| "Bilinmeyen".into());
            let track_id = number(item, "id");
            if track_id == 0 {
                return None;
            }
            let album = item.get("album");
            let art = album
                .and_then(|album| nested_string(album, &["cover_xl"]))
                .or_else(|| album.and_then(|album| nested_string(album, &["cover_big"])));
            let art_sm = album
                .and_then(|album| nested_string(album, &["cover_medium"]))
                .or_else(|| album.and_then(|album| nested_string(album, &["cover_small"])));
            let duration = number(item, "duration").max(0);
            let preview = string(item, "preview");
            let has_preview = preview.is_some();
            let mut track = provider_track(
                format!("deezer:{track_id}"),
                "deezer",
                "Deezer",
                title,
                artist,
                art,
                art_sm,
                duration,
                None,
                None,
                album.and_then(|album| nested_string(album, &["title"])),
                preview,
                string(item, "link"),
                item.get("explicit_lyrics").and_then(Value::as_bool).unwrap_or(false),
                number(item, "rank"),
            );
            track["order"] = json!(order);
            track["fullDuration"] = json!(duration);
            if has_preview {
                track["duration"] = json!(30);
            }
            Some(track)
        })
        .collect()
}

#[allow(dead_code)]
pub fn spotify_tracks(payload: &Value) -> Vec<Value> {
    let Some(items) = payload
        .get("tracks")
        .and_then(|tracks| tracks.get("items"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let title = string(item, "name")?;
            let id = string(item, "id")?;
            let artist = item
                .get("artists")
                .and_then(Value::as_array)
                .and_then(|artists| artists.first())
                .and_then(|artist| string(artist, "name"))
                .unwrap_or_else(|| "Bilinmeyen".into());
            let images = item
                .get("album")
                .and_then(|album| album.get("images"))
                .and_then(Value::as_array);
            let art = images
                .and_then(|images| images.first())
                .and_then(|image| string(image, "url"));
            let art_sm = images
                .and_then(|images| images.last())
                .and_then(|image| string(image, "url"));
            let duration = number(item, "duration_ms") / 1000;
            let preview = string(item, "preview_url");
            let has_preview = preview.is_some();
            let mut track = provider_track(
                format!("spotify:{id}"),
                "spotify",
                "Spotify",
                title,
                artist,
                art,
                art_sm,
                duration,
                None,
                item.get("album").and_then(|album| string(album, "release_date")),
                item.get("album").and_then(|album| string(album, "name")),
                preview,
                nested_string(item, &["external_urls", "spotify"]),
                item.get("explicit").and_then(Value::as_bool).unwrap_or(false),
                number(item, "popularity"),
            );
            track["fullDuration"] = json!(duration);
            if has_preview {
                track["duration"] = json!(30);
            }
            Some(track)
        })
        .collect()
}

fn token_in_query(token: &str, tokens: &[&str]) -> bool {
    tokens.iter().any(|query_token| {
        *query_token == token
            || (query_token.chars().count() >= 4
                && token.chars().count() >= 4
                && edit_distance(query_token, token) <= 2)
    })
}

pub fn enriched_info(
    term: &str,
    itunes: Option<&Value>,
    deezer: Option<&Value>,
) -> Option<(String, String)> {
    let normalized = normalize(term);
    if normalized.is_empty() {
        return None;
    }
    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    if tokens.is_empty() {
        return None;
    }

    let mut candidates: Vec<(String, String)> = Vec::new();
    if let Some(payload) = itunes {
        for track in itunes_tracks(payload).iter().take(8) {
            let title = track.get("title").and_then(Value::as_str).unwrap_or("");
            let artist = track
                .get("artist")
                .and_then(|artist| artist.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !title.is_empty() && !artist.is_empty() {
                candidates.push((title.to_string(), artist.to_string()));
            }
        }
    }
    if let Some(payload) = deezer {
        for track in deezer_tracks(payload).iter().take(8) {
            let title = track.get("title").and_then(Value::as_str).unwrap_or("");
            let artist = track
                .get("artist")
                .and_then(|artist| artist.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if !title.is_empty() && !artist.is_empty() {
                candidates.push((title.to_string(), artist.to_string()));
            }
        }
    }

    let mut artist_tokens: HashSet<String> = HashSet::new();
    for (_, artist) in candidates.iter() {
        for part in artist.split(['&', ',', '/']) {
            let cleaned = part
                .split(" feat.")
                .next()
                .unwrap_or(part)
                .split(" feat ")
                .next()
                .unwrap_or(part)
                .trim();
            let artist_normalized = normalize(cleaned);
            if artist_normalized.is_empty() {
                continue;
            }
            let parts: Vec<&str> = artist_normalized.split_whitespace().collect();
            let present = parts
                .iter()
                .filter(|token| token_in_query(token, &tokens))
                .count();
            if present > 0 && present == parts.len() {
                for token in parts {
                    artist_tokens.insert(token.to_string());
                }
            }
        }
    }
    let mut title_tokens: Vec<&str> = tokens
        .iter()
        .copied()
        .filter(|token| !artist_tokens.contains(*token))
        .collect();
    if title_tokens.is_empty() {
        title_tokens = tokens.clone();
    }
    let title_query = title_tokens.join(" ");

    let mut best: Option<(i32, String, String)> = None;
    for (title, artist) in candidates {
        let title_normalized = normalize(&title);
        if title_normalized.is_empty() {
            continue;
        }
        let matched = title_tokens
            .iter()
            .filter(|token| text_matches(&title_normalized, token))
            .count();
        if matched as f64 / (title_tokens.len() as f64) < 0.6 {
            continue;
        }
        let mut score = (matched as f64 / title_tokens.len() as f64 * 80.0) as i32;
        if title_normalized == title_query {
            score += 120;
        } else if title_normalized.starts_with(&title_query) {
            score += 60;
        } else if title_normalized.contains(&title_query) {
            score += 40;
        } else if phrase_matches(&title_normalized, &title_query) {
            score += 30;
        }
        let extra = title_normalized
            .split_whitespace()
            .count()
            .saturating_sub(title_query.split_whitespace().count());
        score -= extra as i32 * 3;
        let artist_normalized = normalize(&artist);
        if artist_tokens
            .iter()
            .any(|token| artist_normalized.split_whitespace().any(|part| part == token))
        {
            score += 40;
        }
        for (word, penalty) in [
            ("sleep version", 160),
            ("karaoke", 160),
            ("instrumental", 120),
            ("nightcore", 160),
            ("slowed", 120),
            ("sped up", 120),
            ("cover", 110),
            ("remix", 50),
            ("live", 70),
            ("version", 40),
            ("edit", 40),
        ] {
            if title_normalized.contains(word) && !normalized.contains(word) {
                score -= penalty;
            }
        }
        if best
            .as_ref()
            .map(|(best_score, _, _)| score > *best_score)
            .unwrap_or(true)
        {
            best = Some((score, title, artist));
        }
    }
    best.map(|(_, title, artist)| (title, artist))
}

pub fn exact_matches(tracks: &[Value], query: &str, limit: usize) -> Vec<Value> {
    let normalized = normalize(query);
    let mut out = Vec::new();
    for track in tracks {
        if out.len() >= limit {
            break;
        }
        let playable = track
            .get("playable")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !playable {
            continue;
        }
        let title = normalize(track.get("title").and_then(Value::as_str).unwrap_or(""));
        if title == normalized {
            out.push(track.clone());
        }
    }
    out
}

fn contains_phrase(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    format!(" {haystack} ").contains(&format!(" {needle} "))
}

fn has_word(haystack: &str, word: &str) -> bool {
    haystack.split_whitespace().any(|part| part == word)
}

const IMPORT_JUNK_WORDS: &[&str] = &[
    "cover",
    "karaoke",
    "instrumental",
    "nightcore",
    "slowed",
    "reaction",
    "tribute",
    "lullaby",
    "mashup",
    "medley",
    "remix",
    "edit",
    "live",
    "mix",
];

const IMPORT_JUNK_PHRASES: &[&str] = &[
    "sped up",
    "speed up",
    "8d audio",
    "piano version",
    "backing track",
    "ai cover",
    "1 hour",
    "extended version",
    "full album",
    "loop",
];

fn import_junk(candidate_title: &str, source_title: &str) -> bool {
    for word in IMPORT_JUNK_WORDS {
        if has_word(candidate_title, word) && !has_word(source_title, word) {
            return true;
        }
    }
    for phrase in IMPORT_JUNK_PHRASES {
        if candidate_title.contains(phrase) && !source_title.contains(phrase) {
            return true;
        }
    }
    false
}

fn artist_matches_import(source_artist: &str, parts: &[String], haystack: &str) -> bool {
    if source_artist.is_empty() {
        return true;
    }
    if contains_phrase(haystack, source_artist) {
        return true;
    }
    parts.iter().any(|part| {
        !part.is_empty() && contains_phrase(haystack, part)
    })
}

pub fn import_match(
    title: &str,
    artist: &str,
    duration: i64,
    tracks: Vec<Value>,
) -> (Option<Value>, &'static str, String) {
    let source_title = normalize(title);
    if source_title.is_empty() {
        return (None, "none", "Başlık boş".into());
    }
    let source_artist = normalize(artist);
    let mut artist_parts: Vec<String> = Vec::new();
    for part in artist.split(['&', ',', '/', '+']) {
        let cleaned = part
            .split(" feat")
            .next()
            .unwrap_or(part)
            .split(" with ")
            .next()
            .unwrap_or(part)
            .split(" and ")
            .next()
            .unwrap_or(part)
            .trim();
        let normalized = normalize(cleaned);
        if !normalized.is_empty() {
            artist_parts.push(normalized);
        }
    }

    let tokens: Vec<&str> = source_title.split_whitespace().collect();
    let mut best: Option<(i32, Value, &'static str)> = None;
    let mut reason = "Eşleşme bulunamadı".to_string();

    for track in tracks {
        let candidate_title = normalize(track.get("title").and_then(Value::as_str).unwrap_or(""));
        let candidate_artist = normalize(
            track
                .get("artist")
                .and_then(|artist| artist.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(""),
        );
        let candidate_duration = track.get("duration").and_then(Value::as_i64).unwrap_or(0);
        if candidate_title.is_empty() {
            continue;
        }
        if candidate_duration > 0 && (candidate_duration < 25 || candidate_duration > 1800) {
            reason = "Uygun süreli kayıt bulunamadı".into();
            continue;
        }
        if import_junk(&candidate_title, &source_title) {
            reason = "Yalnızca kapak/remiks/live videolar bulundu".into();
            continue;
        }

        let channel_match = artist_matches_import(&source_artist, &artist_parts, &candidate_artist);
        let title_artist_match =
            artist_matches_import(&source_artist, &artist_parts, &candidate_title);
        if !channel_match && !title_artist_match {
            reason = "Sanatçı eşleşmedi".into();
            continue;
        }

        let strong = contains_phrase(&candidate_title, &source_title);
        let matched = tokens
            .iter()
            .filter(|token| contains_phrase(&candidate_title, token))
            .count();
        let coverage = matched as f64 / (tokens.len().max(1) as f64);
        if !strong && coverage < 0.85 {
            reason = "Başlık eşleşmedi".into();
            continue;
        }

        let mut score = if strong {
            80
        } else {
            (coverage * 55.0) as i32
        };
        if channel_match {
            score += 85;
        } else {
            score += 20;
            if candidate_title.contains("lyrics") {
                score -= 15;
            }
        }
        if candidate_title.contains("official audio") || candidate_title.contains("official video") {
            score += 18;
        }
        if candidate_artist.ends_with("topic") {
            score += 14;
        }
        if track.get("verified").and_then(Value::as_bool).unwrap_or(false) {
            score += 10;
        }
        let order = track
            .get("order")
            .and_then(Value::as_i64)
            .unwrap_or(12)
            .clamp(0, 20);
        score += ((12 - order).max(0) * 2) as i32;
        let views = track
            .get("popularity")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        if views > 0 {
            score += ((views as f64 + 1.0).ln() * 2.5) as i32;
        }
        if duration > 0 && candidate_duration > 0 {
            let difference = (duration - candidate_duration).abs();
            if difference <= 10 {
                score += 30;
            } else if difference <= 35 {
                score += 12;
            } else if difference > 90 {
                score -= 40;
            }
        }

        let confidence = if strong && channel_match {
            "high"
        } else {
            "medium"
        };
        match &best {
            Some((best_score, _, _)) if *best_score >= score => {}
            _ => best = Some((score, track, confidence)),
        }
    }

    match best {
        Some((_, track, confidence)) => (Some(track), confidence, String::new()),
        None => (None, "none", reason),
    }
}

#[allow(dead_code)]
pub fn match_key(track: &Value) -> String {
    let title = normalize(track.get("title").and_then(Value::as_str).unwrap_or(""));
    let artist = normalize(
        track
            .get("artist")
            .and_then(|artist| artist.get("name"))
            .and_then(Value::as_str)
            .unwrap_or(""),
    );
    format!("{title}|{artist}")
}

pub fn rank(query: &str, tracks: Vec<Value>, hints: &[String]) -> Vec<Value> {
    let normalized_query = normalize(query);
    let tokens: Vec<&str> = normalized_query.split_whitespace().collect();
    if tokens.is_empty() {
        return Vec::new();
    }

    let artist_tokens: HashSet<String> = hints
        .iter()
        .flat_map(|hint| {
            normalize(hint)
                .split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect();
    let mut title_tokens: Vec<&str> = tokens
        .iter()
        .copied()
        .filter(|token| !artist_tokens.contains(*token))
        .collect();
    if title_tokens.is_empty() {
        title_tokens = tokens.clone();
    }
    let title_query = title_tokens.join(" ");

    let mut scored: Vec<(i32, Value)> = Vec::new();
    for track in tracks {
        let title = normalize(track.get("title").and_then(Value::as_str).unwrap_or(""));
        let artist = normalize(
            track
                .get("artist")
                .and_then(|artist| artist.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(""),
        );
        let album = normalize(track.get("album").and_then(Value::as_str).unwrap_or(""));
        let haystack = format!("{title} {artist}");
        if title.is_empty() {
            continue;
        }

        let mut fuzzy_hits = 0usize;
        let mut matched = 0usize;
        for token in &tokens {
            if haystack.contains(*token) {
                matched += 1;
            } else if token_fuzzy(token, &haystack) {
                matched += 1;
                fuzzy_hits += 1;
            }
        }
        if matched == 0 {
            continue;
        }
        let coverage = matched as f64 / tokens.len() as f64;
        let threshold = if tokens.len() >= 3 { 0.6 } else { 0.5 };
        if coverage < threshold {
            continue;
        }

        let artist_matches_hint = hints.iter().any(|hint| {
            let normalized_hint = normalize(hint);
            !normalized_hint.is_empty() && artist.contains(&normalized_hint)
        });
        let trusted_exact = hints.is_empty() || artist_matches_hint;

        let mut score = (coverage * 190.0) as i32;
        score -= fuzzy_hits as i32 * 8;
        if title == normalized_query {
            score += if trusted_exact { 900 } else { 120 };
        } else if title.starts_with(&normalized_query) {
            score += if trusted_exact { 400 } else { 120 };
        } else if title.contains(&normalized_query) {
            score += 280;
        }
        let fuzzy_title = title != normalized_query
            && title.split_whitespace().count() == tokens.len()
            && all_tokens_match(&title, &tokens);
        if fuzzy_title {
            score += 260;
        }
        if !title_query.is_empty()
            && title_query != normalized_query
            && phrase_matches(&title, &title_query)
        {
            score += 320;
        }
        if artist == normalized_query {
            score += 340;
        } else if artist.contains(&normalized_query) {
            score += 130;
        } else if phrase_matches(&artist, &normalized_query) {
            score += 100;
        }
        if tokens.iter().all(|token| title.contains(*token)) {
            score += 170;
        } else if all_tokens_match(&title, &tokens) {
            score += 130;
        }
        if album.contains(&normalized_query) {
            score += 25;
        }

        for (index, hint) in hints.iter().enumerate() {
            let normalized_hint = normalize(hint);
            if normalized_hint.is_empty() {
                continue;
            }
            if artist.contains(&normalized_hint) {
                score += if index == 0 { 900 } else { 220 };
                break;
            }
            if title.contains(&normalized_hint) {
                score += 80;
            }
        }

        let source = track.get("source").and_then(Value::as_str).unwrap_or("");
        if source != "audius" {
            let order = track
                .get("order")
                .and_then(Value::as_i64)
                .unwrap_or(30)
                .clamp(0, 30);
            score += (150 - order * 5).max(0) as i32;
        }
        if track.get("verified").and_then(Value::as_bool).unwrap_or(false) {
            score += 35;
        }
        if source == "audius" {
            score += 40;
        }
        if source == "youtube" {
            score += 15;
            if title.contains("official audio") || title.contains("official video") {
                score += 22;
            }
            if artist.ends_with("topic") {
                score += 18;
            }
        }
        if track.get("playable").and_then(Value::as_bool).unwrap_or(true) {
            score += 25;
        }
        let popularity = track
            .get("popularity")
            .and_then(Value::as_i64)
            .unwrap_or_else(|| track.get("plays").and_then(Value::as_i64).unwrap_or(0));
        if popularity > 0 {
            score += match source {
                "deezer" => ((popularity as f64 / 1_000_000.0) * 190.0) as i32,
                "spotify" => popularity.clamp(0, 100) as i32 * 3,
                "audius" => ((popularity as f64 + 1.0).ln() * 8.0) as i32,
                "youtube" => ((popularity as f64 + 1.0).ln() * 4.0) as i32,
                _ => ((popularity as f64 + 1.0).ln() * 6.0) as i32,
            };
        }
        let duration = track.get("duration").and_then(Value::as_i64).unwrap_or(0);
        if (45..=900).contains(&duration) {
            score += 14;
        }

        let query_has = |word: &str| normalized_query.contains(word);
        for &(word, penalty) in PENALTIES {
            if title.contains(word) && !query_has(word) {
                score -= penalty;
            }
        }

        scored.push((score, track));
    }

    scored.sort_by(|left, right| right.0.cmp(&left.0));

    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for (score, mut track) in scored {
        let title = normalize(track.get("title").and_then(Value::as_str).unwrap_or(""));
        let artist = normalize(
            track
                .get("artist")
                .and_then(|artist| artist.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(""),
        );
        let source = track.get("source").and_then(Value::as_str).unwrap_or("");
        let key = format!("{source}|{title}|{artist}");
        if !seen.insert(key) {
            continue;
        }
        track["score"] = json!(score);
        out.push(track);
        if out.len() >= 60 {
            break;
        }
    }
    out
}
