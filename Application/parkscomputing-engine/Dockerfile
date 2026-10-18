#See https://aka.ms/customizecontainer to learn how to customize your debug container and how Visual Studio uses this Dockerfile to build your images for faster debugging.

# The web terminal's SSH client, Go compiled to WebAssembly (ssh-wasm/,
# Architecture/admin-and-identity-design.md, A16), with Go's own loader for
# it from the same toolchain. The toolchain is pinned so a rebuild makes the
# same client; the modules are pinned by ssh-wasm/go.sum.
FROM golang:1.26.8 AS ssh-build
WORKDIR /src
COPY ssh-wasm/go.mod ssh-wasm/go.sum ./
RUN go mod download
COPY ssh-wasm/*.go ./
RUN GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o /out/ssh.wasm . \
 && gzip -9 -k /out/ssh.wasm \
 && cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" /out/wasm_exec.js
COPY ssh-wasm/web/ /out/

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build-env
WORKDIR /app
# Default runtime port now 8080 (set via ASPNETCORE_URLS); expose for documentation
EXPOSE 8080

COPY ../*.sln ./

# Copy the published web app
COPY parkscomputing-engine/*.csproj ./parkscomputing-engine/

# Copy the dependencies (tests not required for runtime image, omitted)
#COPY SmartSamCommentsLib/*.csproj ./SmartSamCommentsLib/
#COPY SmartSamCommentsApi/*.csproj ./SmartSamCommentsApi/
#COPY SmartSamCommentsData/*.csproj ./SmartSamCommentsData/


# Copy everything else and build
COPY parkscomputing-engine ./parkscomputing-engine/
# (Test project sources omitted from runtime image)
#COPY SmartSamCommentsApi/ ./SmartSamCommentsApi/
#COPY SmartSamCommentsLib/ ./SmartSamCommentsLib/
#COPY SmartSamCommentsData/ ./SmartSamCommentsData/

# Copy all static site content from wwwroot (populated from W:/) into the image
COPY parkscomputing-engine/wwwroot ./parkscomputing-engine/wwwroot/

WORKDIR /app/parkscomputing-engine
RUN dotnet restore
RUN dotnet publish -c Release -o out

# The Codex CLI, for the staff's Chat (Chat/CodexHost.cs): the release's
# Linux package, pinned, which the chat runs as an app server. The package
# rather than the bare binary, since Codex reaches MCP tools through its
# code-mode host, which must sit beside it (bin/codex-code-mode-host),
# and brings its own bubblewrap and ripgrep. The voice resources are left
# out. CODEX_HOME (docker-compose.yml) says where its sign-in lives.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS codex-fetch
ARG CODEX_VERSION=rust-v0.163.0
RUN curl -fsSL -o /tmp/codex.tar.gz "https://github.com/openai/codex/releases/download/${CODEX_VERSION}/codex-package-x86_64-unknown-linux-musl.tar.gz" \
    && mkdir -p /codex && tar -xzf /tmp/codex.tar.gz -C /codex --exclude='codex-resources/voice' \
    && chmod +x /codex/bin/* /codex/codex-path/* /codex/codex-resources/bwrap && rm /tmp/codex.tar.gz

# Run command
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
EXPOSE 8080
COPY --from=build-env /app/parkscomputing-engine/out .
COPY --from=codex-fetch /codex/ /app/codex/
# Outside wwwroot, which the content volume covers; the edit origin serves
# these to a signed-in admin only (Identity/SshController.cs).
COPY --from=ssh-build /out/ /app/ssh/
ENTRYPOINT ["dotnet", "ParksComputing.Engine.dll"]
