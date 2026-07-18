//! Work executors. The consensus criterion is byte-identical output from
//! temp-0 seed-7 inference, so an executor must be deterministic in its
//! (model, prompt) inputs for two honest nodes to agree.
//!
//! Two implementations:
//!   - Dev: no model runtime; a pure, deterministic transform. Used when no
//!     OLLAMA_HOST is configured, so the network is exercisable anywhere.
//!   - Ollama: env-gated real inference against a local Ollama host with
//!     temperature 0 and seed 7. Degrades gracefully — an unreachable host
//!     yields an error the daemon logs and skips, never a crash.

use sha2::{Digest, Sha256};

pub enum Executor {
    Dev,
    Ollama { host: String },
}

impl Executor {
    /// Pick an executor from the environment. OLLAMA_HOST present → real
    /// inference; absent → the deterministic dev executor.
    pub fn from_env() -> Self {
        match std::env::var("OLLAMA_HOST").ok().filter(|v| !v.is_empty()) {
            Some(host) => Executor::Ollama { host },
            None => Executor::Dev,
        }
    }

    pub fn mode(&self) -> &'static str {
        match self {
            Executor::Dev => "dev",
            Executor::Ollama { .. } => "ollama",
        }
    }

    pub async fn execute(&self, model: &str, prompt: &str) -> Result<String, String> {
        match self {
            Executor::Dev => Ok(dev_output(model, prompt)),
            Executor::Ollama { host } => ollama_output(host, model, prompt).await,
        }
    }
}

/// Deterministic stand-in for a temp-0 seed-7 completion: a stable function
/// of (model, prompt) so two dev nodes produce byte-identical output.
fn dev_output(model: &str, prompt: &str) -> String {
    let mut h = Sha256::new();
    h.update(model.as_bytes());
    h.update([0u8]);
    h.update(prompt.as_bytes());
    let d = hex::encode(h.finalize());
    format!("[verity-dev v1] model={model} temp=0 seed=7 :: {d}")
}

/// Real inference via Ollama's generate API, pinned to temperature 0 / seed 7
/// for determinism. Any transport or status failure is returned as an error
/// (the daemon logs it and moves on).
async fn ollama_output(host: &str, model: &str, prompt: &str) -> Result<String, String> {
    let url = format!("{}/api/generate", host.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "options": { "temperature": 0, "seed": 7 }
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ollama unreachable: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("ollama status {}", resp.status()));
    }
    let parsed: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("ollama parse error: {e}"))?;
    parsed["response"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "ollama response missing 'response' field".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_output_is_deterministic() {
        // Two independent nodes with the same input must agree byte-for-byte.
        assert_eq!(dev_output("m", "hello"), dev_output("m", "hello"));
        assert_ne!(dev_output("m", "hello"), dev_output("m", "world"));
        assert_ne!(dev_output("m1", "hello"), dev_output("m2", "hello"));
    }
}
