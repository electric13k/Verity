module github.com/electric13k/verity/services/gateway

go 1.25.0

require github.com/gofiber/fiber/v3 v3.4.0

require (
	github.com/andybalholm/brotli v1.2.2 // indirect
	github.com/gabriel-vasile/mimetype v1.4.13 // indirect
	github.com/go-playground/locales v0.14.1 // indirect
	github.com/go-playground/universal-translator v0.18.1 // indirect
	github.com/gofiber/schema v1.8.0 // indirect
	github.com/gofiber/utils/v2 v2.1.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/klauspost/compress v1.19.0 // indirect
	github.com/leodido/go-urn v1.4.0 // indirect
	github.com/mattn/go-colorable v0.1.15 // indirect
	github.com/mattn/go-isatty v0.0.22 // indirect
	github.com/philhofer/fwd v1.2.0 // indirect
	github.com/tinylib/msgp v1.6.4 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fasthttp v1.72.0 // indirect
	golang.org/x/crypto v0.53.0 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sys v0.46.0 // indirect
	golang.org/x/text v0.38.0 // indirect
	golang.org/x/time v0.5.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20241015192408-796eee8c2d53 // indirect
	google.golang.org/protobuf v1.36.0 // indirect
)

require (
	github.com/MicahParks/jwkset v0.5.19
	github.com/MicahParks/keyfunc/v3 v3.3.5
	github.com/electric13k/verity/packages/proto/gen/go v0.0.0
	github.com/go-playground/validator/v10 v10.30.3
	github.com/golang-jwt/jwt/v5 v5.3.1
	google.golang.org/grpc v1.69.2
)

replace github.com/electric13k/verity/packages/proto/gen/go => ../../packages/proto/gen/go
