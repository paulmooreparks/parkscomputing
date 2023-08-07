FROM mcr.microsoft.com/dotnet/sdk:7.0 AS build-env
WORKDIR /app

COPY ../*.sln ./

# Copy the published web app
COPY aspnet-core-dotnet-core/*.csproj ./aspnet-core-dotnet-core/

# Copy the dependencies
COPY aspnet-core-dotnet-core.FunctionalTests/*.csproj ./aspnet-core-dotnet-core.FunctionalTests/
COPY aspnet-core-dotnet-core.UnitTests/*.csproj ./aspnet-core-dotnet-core.UnitTests/
COPY SmartSamCommentsLib/*.csproj ./SmartSamCommentsLib/
COPY SmartSamCommentsApi/*.csproj ./SmartSamCommentsApi/

# Copy everything else and build
COPY aspnet-core-dotnet-core ./aspnet-core-dotnet-core/
COPY aspnet-core-dotnet-core.FunctionalTests ./aspnet-core-dotnet-core.FunctionalTests/
COPY aspnet-core-dotnet-core.UnitTests ./aspnet-core-dotnet-core.UnitTests/
COPY SmartSamCommentsApi/ ./SmartSamCommentsApi/
COPY SmartSamCommentsLib/ ./SmartSamCommentsLib/

WORKDIR /app/aspnet-core-dotnet-core
RUN dotnet restore
RUN dotnet publish -c Release -o out

# Run command
FROM mcr.microsoft.com/dotnet/aspnet:7.0
WORKDIR /app
COPY --from=build-env /app/aspnet-core-dotnet-core/out .
ENTRYPOINT ["dotnet", "aspnet-core-dotnet-core.dll"]