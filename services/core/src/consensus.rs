//! Swarm consensus verification (M7, ported v1 verify logic).
//!
//! Model: redundancy-2. Every work unit is assigned to two nodes with
//! DIFFERENT owners (sybil pair guard). Inference runs temp-0 seed-7, so
//! honest nodes produce byte-identical output; consensus is digest
//! equality. Agreement credits both nodes; disagreement credits neither
//! and flags the unit for reassignment.

/// One node's completed result for a work unit.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkResult {
    pub node_id: String,
    pub owner_id: String,
    pub result_digest: String,
}

#[derive(Debug, PartialEq)]
pub enum Verdict {
    /// Digests agree — the digest is canonical; both nodes earn credit.
    Verified { digest: String },
    /// Digests differ — no credit, unit reassigned.
    Conflicted,
}

#[derive(Debug, PartialEq)]
pub enum PairError {
    /// Both assignments belong to one owner — a single party could forge
    /// consensus. The pair is invalid regardless of results.
    SybilPair,
    /// A digest is missing/empty — the unit isn't complete yet.
    Incomplete,
}

pub const CREDIT_PER_VERIFIED_UNIT: i64 = 10;

/// Validates the assignment pair, then compares digests.
pub fn verify_pair(a: &WorkResult, b: &WorkResult) -> Result<Verdict, PairError> {
    if a.owner_id == b.owner_id {
        return Err(PairError::SybilPair);
    }
    if a.result_digest.is_empty() || b.result_digest.is_empty() {
        return Err(PairError::Incomplete);
    }
    if a.result_digest == b.result_digest {
        Ok(Verdict::Verified {
            digest: a.result_digest.clone(),
        })
    } else {
        Ok(Verdict::Conflicted)
    }
}

/// Ledger deltas for a verdict: (node_id, delta, reason).
pub fn credit_deltas(a: &WorkResult, b: &WorkResult, verdict: &Verdict) -> Vec<(String, i64, &'static str)> {
    match verdict {
        Verdict::Verified { .. } => vec![
            (a.node_id.clone(), CREDIT_PER_VERIFIED_UNIT, "verified_unit"),
            (b.node_id.clone(), CREDIT_PER_VERIFIED_UNIT, "verified_unit"),
        ],
        // No penalty on first conflict: an honest node can be paired with a
        // faulty one; repeated-conflict scoring is daemon-side telemetry.
        Verdict::Conflicted => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(node: &str, owner: &str, digest: &str) -> WorkResult {
        WorkResult {
            node_id: node.into(),
            owner_id: owner.into(),
            result_digest: digest.into(),
        }
    }

    #[test]
    fn agreement_verifies_and_credits_both() {
        let a = result("n1", "alice", "abc123");
        let b = result("n2", "bob", "abc123");
        let verdict = verify_pair(&a, &b).unwrap();
        assert_eq!(verdict, Verdict::Verified { digest: "abc123".into() });
        let deltas = credit_deltas(&a, &b, &verdict);
        assert_eq!(deltas.len(), 2);
        assert!(deltas.iter().all(|(_, d, r)| *d == CREDIT_PER_VERIFIED_UNIT && *r == "verified_unit"));
    }

    #[test]
    fn disagreement_conflicts_and_credits_nobody() {
        let a = result("n1", "alice", "abc123");
        let b = result("n2", "bob", "zzz999");
        let verdict = verify_pair(&a, &b).unwrap();
        assert_eq!(verdict, Verdict::Conflicted);
        assert!(credit_deltas(&a, &b, &verdict).is_empty());
    }

    #[test]
    fn same_owner_pair_is_rejected_even_when_agreeing() {
        let a = result("n1", "alice", "abc123");
        let b = result("n2", "alice", "abc123");
        assert_eq!(verify_pair(&a, &b).unwrap_err(), PairError::SybilPair);
    }

    #[test]
    fn missing_digest_is_incomplete() {
        let a = result("n1", "alice", "");
        let b = result("n2", "bob", "abc123");
        assert_eq!(verify_pair(&a, &b).unwrap_err(), PairError::Incomplete);
    }
}
