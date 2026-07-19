//! Qdrant search proxy. THE tenant law lives here: every query body gets a
//! mandatory `user_id == <tenant>` payload filter, built exclusively from
//! gRPC metadata. No metadata → no query (fail closed).

use serde_json::{json, Value};
use tonic::metadata::MetadataMap;
use tonic::Status;

/// Extract the tenant user id from gRPC metadata; absent/empty fails closed.
pub fn tenant_user_id(metadata: &MetadataMap) -> Result<String, Status> {
    metadata
        .get("x-verity-user-id")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| Status::unauthenticated("missing tenant context"))
}

/// Validate a Qdrant collection name before it is interpolated into the REST
/// URL path. Restricting to `^[A-Za-z0-9_-]{1,128}$` stops a caller-supplied
/// name from reshaping the request path (injecting `/`, `?`, `#`, `..`) and
/// hitting a different Qdrant endpoint. Cheaper than pulling in `regex`.
pub fn valid_collection_name(name: &str) -> bool {
    (1..=128).contains(&name.len())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Build the Qdrant search body. The tenant filter is unconditional — there
/// is deliberately no way to call this without a user id.
pub fn search_body(user_id: &str, vector: &[f32], limit: u32) -> Value {
    json!({
        "vector": vector,
        "limit": limit,
        "with_payload": true,
        "filter": {
            "must": [
                { "key": "user_id", "match": { "value": user_id } }
            ]
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_metadata_fails_closed() {
        let md = MetadataMap::new();
        let err = tenant_user_id(&md).unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unauthenticated);
    }

    #[test]
    fn empty_user_id_fails_closed() {
        let mut md = MetadataMap::new();
        md.insert("x-verity-user-id", "".parse().unwrap());
        assert!(tenant_user_id(&md).is_err());
    }

    #[test]
    fn collection_name_validation() {
        // Accepted: alphanumerics, underscore, hyphen, up to 128 chars.
        assert!(valid_collection_name("memories"));
        assert!(valid_collection_name("user_123-vectors"));
        assert!(valid_collection_name(&"a".repeat(128)));
        // Rejected: empty, over-length, and any path/query-reshaping char.
        assert!(!valid_collection_name(""));
        assert!(!valid_collection_name(&"a".repeat(129)));
        assert!(!valid_collection_name("memories/points/scroll"));
        assert!(!valid_collection_name("memories?limit=9999"));
        assert!(!valid_collection_name("../other"));
        assert!(!valid_collection_name("has space"));
        assert!(!valid_collection_name("emoji😀"));
    }

    #[test]
    fn tenant_filter_is_always_present() {
        let body = search_body("user_a", &[0.1, 0.2], 5);
        let must = &body["filter"]["must"];
        assert_eq!(must[0]["key"], "user_id");
        assert_eq!(must[0]["match"]["value"], "user_a");
        assert_eq!(body["limit"], 5);
    }
}
