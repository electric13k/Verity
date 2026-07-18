// Generates the coordinator gRPC client from the shared contracts. Needs
// protoc on PATH (CI installs protobuf-compiler). The node is a pure client:
// no server stubs.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::configure()
        .build_server(false)
        .compile_protos(
            &[
                "../../packages/proto/verity/v1/common.proto",
                "../../packages/proto/verity/v1/compute.proto",
            ],
            &["../../packages/proto"],
        )?;
    println!("cargo:rerun-if-changed=../../packages/proto");
    Ok(())
}
