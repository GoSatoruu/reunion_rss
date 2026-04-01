# Server Deployment Guide

Now that the application is configured with Docker and pushed to the GitHub Container Registry (GHCR), you can deploy it on your server. Any new commit pushed to the `main` branch will automatically trigger a rebuild and update on your server via Watchtower.

## Prerequisites on your Server
1. Install Docker and Docker Compose.
2. If your repository or the GHCR image is set to **Private**, you will need to log into GHCR from your server:
   ```bash
   echo "<YOUR_GITHUB_PERSONAL_ACCESS_TOKEN>" | docker login ghcr.io -u <YOUR_GITHUB_USERNAME> --password-stdin
   ```
   *Note: Ensure your Personal Access Token has `read:packages` permission.*

## Deployment Steps
1. Create a folder on your server for the app.
2. Copy the `docker-compose.yml` file from your repository into that folder.
3. Start the application:
   ```bash
   docker-compose up -d
   ```

## How Auto-Updates Work
The `docker-compose.yml` file includes a `watchtower` container. Every 5 minutes, it checks the GitHub Container Registry (`ghcr.io/gosatoruu/reunion_rss:latest`) for a new version of the image. When GitHub Actions finishes building a new commit, Watchtower downloads it and gracefully restarts your `web` container, bringing your new changes live with zero effort!
