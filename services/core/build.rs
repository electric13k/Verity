// Generates Rust gRPC stubs from the shared contracts. Needs protoc on PATH
// (CI installs protobuf-compiler; see packages/proto/generate.sh for the
// Go/Python side, which is committed instead).
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .build_client(false)
        .compile(
            &[
                "../../packages/proto/verity/v1/common.proto",
                "../../packages/proto/verity/v1/core.proto",
            ],
            &["../../packages/proto"],
        )?;
    println!("cargo:rerun-if-changed=../../packages/proto");
    Ok(())
}
