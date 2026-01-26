# download_youtube_playlist_telegram_bot

A Telegram bot for downloading YouTube playlists.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with your bot token:
   ```
   BOT_TOKEN=your_telegram_bot_token
   ```

3. Build and run:
   ```bash
   npm run build
   npm start
   ```

## Features

- Downloads YouTube videos and playlists
- Supports both video (MP4) and audio (MP3) formats
- Automatically splits large files (>49MB) into parts for Telegram upload
- Shows progress with video number and part info: `[1/5] Video Title (Part 1/3)`
