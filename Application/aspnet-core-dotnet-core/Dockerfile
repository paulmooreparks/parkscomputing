#See https://aka.ms/customizecontainer to learn how to customize your debug container and how Visual Studio uses this Dockerfile to build your images for faster debugging.

FROM mcr.microsoft.com/dotnet/sdk:7.0 AS build-env
WORKDIR /app
EXPOSE 80
EXPOSE 443

COPY ../*.sln ./

# Copy the published web app
COPY aspnet-core-dotnet-core/*.csproj ./aspnet-core-dotnet-core/

# Copy the dependencies
COPY aspnet-core-dotnet-core.FunctionalTests/*.csproj ./aspnet-core-dotnet-core.FunctionalTests/
COPY aspnet-core-dotnet-core.UnitTests/*.csproj ./aspnet-core-dotnet-core.UnitTests/
COPY SmartSamCommentsLib/*.csproj ./SmartSamCommentsLib/
COPY SmartSamCommentsApi/*.csproj ./SmartSamCommentsApi/
COPY SmartSamCommentsData/*.csproj ./SmartSamCommentsData/

# Copy everything else and build
COPY aspnet-core-dotnet-core ./aspnet-core-dotnet-core/
COPY aspnet-core-dotnet-core.FunctionalTests ./aspnet-core-dotnet-core.FunctionalTests/
COPY aspnet-core-dotnet-core.UnitTests ./aspnet-core-dotnet-core.UnitTests/
COPY SmartSamCommentsApi/ ./SmartSamCommentsApi/
COPY SmartSamCommentsLib/ ./SmartSamCommentsLib/
COPY SmartSamCommentsData/ ./SmartSamCommentsData/

WORKDIR /app/aspnet-core-dotnet-core
RUN dotnet restore
RUN dotnet publish -c Release -o out

# Run command
FROM mcr.microsoft.com/dotnet/aspnet:7.0
WORKDIR /app
COPY --from=build-env /app/aspnet-core-dotnet-core/out .
ENTRYPOINT ["dotnet", "aspnet-core-dotnet-core.dll"]
