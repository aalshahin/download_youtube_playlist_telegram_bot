import execa from 'execa';
import path from 'path';
import fs from 'fs-extra';
import { sanitizeFilename } from './utils';

export interface VideoMetadata {
    id: string;
    title: string;
    url: string;
    duration?: number;
}

export class Downloader {
    constructor(private downloadDir: string) { }

    async getPlaylistMetadata(url: string): Promise<VideoMetadata[]> {
        // -J: dump JSON, --flat-playlist: don't download videos, just list them
        const { stdout } = await execa('yt-dlp', ['-J', '--flat-playlist', url]);
        const data = JSON.parse(stdout);

        if (data._type === 'playlist') {
            return data.entries.map((entry: any) => ({
                id: entry.id,
                title: entry.title,
                url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`, // entry.url might be missing in flat-playlist
                duration: entry.duration
            }));
        } else {
            // Single video
            return [{
                id: data.id,
                title: data.title,
                url: data.webpage_url,
                duration: data.duration
            }];
        }
    }

    async downloadVideo(url: string, title: string, isAudio: boolean = false): Promise<string> {
        const sanitizedTitle = sanitizeFilename(title);
        // ext will be mp3 for audio, mp4 for video
        const ext = isAudio ? 'mp3' : 'mp4';
        const outputPath = path.join(this.downloadDir, `${sanitizedTitle}.${ext}`);

        console.log(`Downloading: ${title} [${isAudio ? 'Audio' : 'Video'}]`);

        try {
            const args = [
                '-o', outputPath,
                url
            ];

            if (isAudio) {
                // Extract audio, convert to mp3, best quality
                args.unshift('-x', '--audio-format', 'mp3', '--audio-quality', '0');
            } else {
                // Video logic: best quality mp4
                args.unshift('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4');
            }

            await execa('yt-dlp', args);

            // Check file size after download
            const stats = await fs.stat(outputPath);
            const sizeMB = stats.size / (1024 * 1024);

            console.log(`Downloaded ${sanitizedTitle}: ${sizeMB.toFixed(2)}MB`);

            return outputPath;
        } catch (error) {
            console.error(`Error downloading ${title}:`, error);
            throw error;
        }
    }
}
