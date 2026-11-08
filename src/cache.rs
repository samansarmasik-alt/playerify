use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

pub struct Cache {
    map: HashMap<String, (Instant, Value)>,
    order: VecDeque<String>,
    cap: usize,
}

impl Cache {
    pub fn new(cap: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            cap,
        }
    }

    pub fn get(&mut self, key: &str) -> Option<Value> {
        let now = Instant::now();
        match self.map.get(key) {
            Some((expires, value)) if *expires > now => Some(value.clone()),
            Some(_) => {
                self.map.remove(key);
                None
            }
            None => None,
        }
    }

    pub fn remove(&mut self, key: &str) {
        self.map.remove(key);
        self.order.retain(|item| item != key);
    }

    pub fn insert(&mut self, key: String, value: Value, ttl: Duration) {
        let expires = Instant::now() + ttl;
        if self.map.insert(key.clone(), (expires, value)).is_none() {
            self.order.push_back(key);
        }
        while self.map.len() > self.cap {
            match self.order.pop_front() {
                Some(oldest) => {
                    self.map.remove(&oldest);
                }
                None => break,
            }
        }
    }
}
