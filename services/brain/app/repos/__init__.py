"""Repository layer. Every function takes a required user_id (from gateway
gRPC metadata) as its first argument and filters every query on it — the
tenant boundary is structural: forget the argument and the call won't run."""
