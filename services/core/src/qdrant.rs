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
    fn tenant_filter_is_always_present() {
        let body = search_body("user_a", &[0.1, 0.2], 5);
        let must = &body["filter"]["must"];
        assert_eq!(must[0]["key"], "user_id");
        assert_eq!(must[0]["match"]["value"], "user_a");
        assert_eq!(body["limit"], 5);
    }
}
