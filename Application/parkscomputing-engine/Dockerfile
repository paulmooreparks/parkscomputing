#See https://aka.ms/customizecontainer to learn how to customize your debug container and how Visual Studio uses this Dockerfile to build your images for faster debugging.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build-env
WORKDIR /app
# Default runtime port now 8080 (set via ASPNETCORE_URLS); expose for documentation
EXPOSE 8080

COPY ../*.sln ./

# Copy the published web app
COPY parkscomputing-engine/*.csproj ./parkscomputing-engine/

# Copy the dependencies (tests not required for runtime image, omitted)
COPY SmartSamCommentsLib/*.csproj ./SmartSamCommentsLib/
COPY SmartSamCommentsApi/*.csproj ./SmartSamCommentsApi/
COPY SmartSamCommentsData/*.csproj ./SmartSamCommentsData/


# Copy everything else and build
COPY parkscomputing-engine ./parkscomputing-engine/
# (Test project sources omitted from runtime image)
COPY SmartSamCommentsApi/ ./SmartSamCommentsApi/
COPY SmartSamCommentsLib/ ./SmartSamCommentsLib/
COPY SmartSamCommentsData/ ./SmartSamCommentsData/

# Copy all static site content from wwwroot (populated from W:/) into the image
COPY parkscomputing-engine/wwwroot ./parkscomputing-engine/wwwroot/

WORKDIR /app/parkscomputing-engine
RUN dotnet restore
RUN dotnet publish -c Release -o out

# Run command
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
EXPOSE 8080
COPY --from=build-env /app/parkscomputing-engine/out .
ENTRYPOINT ["dotnet", "ParksComputing.Engine.dll"]
