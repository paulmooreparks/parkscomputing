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

# Run command
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
EXPOSE 8080
COPY --from=build-env /app/parkscomputing-engine/out .
# Outside wwwroot, which the content volume covers; the edit origin serves
# these to a signed-in admin only (Identity/SshController.cs).
COPY --from=ssh-build /out/ /app/ssh/
ENTRYPOINT ["dotnet", "ParksComputing.Engine.dll"]
