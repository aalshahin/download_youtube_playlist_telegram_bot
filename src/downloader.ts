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

        console.log(`\n${'='.repeat(80)}`);
        console.log(`📥 Downloading: ${title}`);
        console.log(`   Type: ${isAudio ? 'Audio (MP3)' : 'Video (MP4)'}`);
        console.log(`${'='.repeat(80)}\n`);

        try {
            const args = [
                '-o', outputPath,
                '--newline',  // Output progress on new lines for better console display
                url
            ];

            if (isAudio) {
                // Extract audio, convert to mp3, best quality
                args.unshift('-x', '--audio-format', 'mp3', '--audio-quality', '0');
            } else {
                // Video logic: best quality mp4
                args.unshift('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4');
            }

            // Stream output to console for real-time progress
            const subprocess = execa('yt-dlp', args);

            // Throttle progress updates to every 5 seconds
            let lastProgressTime = 0;
            const PROGRESS_INTERVAL = 5000; // 5 seconds
            let lastProgressLine = '';

            // Pipe stdout and stderr to console
            subprocess.stdout?.on('data', (data) => {
                const output = data.toString();
                const now = Date.now();

                // yt-dlp outputs progress lines that start with [download]
                if (output.includes('[download]')) {
                    // Extract percentage if available
                    const lines = output.split('\n').filter((line: string) => line.trim());
                    for (const line of lines) {
                        if (line.includes('%')) {
                            lastProgressLine = line.trim();
                            // Only show progress every 5 seconds
                            if (now - lastProgressTime >= PROGRESS_INTERVAL) {
                                // Use \r to overwrite the same line
                                process.stdout.write(`\r  ${lastProgressLine}`.padEnd(100));
                                lastProgressTime = now;
                            }
                        } else if (line.includes('100%') || line.includes('has already been downloaded')) {
                            // Show completion on new line
                            process.stdout.write(`\r  ${line.trim()}`.padEnd(100) + '\n');
                        }
                    }
                } else {
                    // Show non-progress output immediately (like "Merging formats", etc.)
                    // Clear the progress line first, then show the message
                    if (lastProgressLine) {
                        process.stdout.write('\r' + ' '.repeat(100) + '\r');
                        lastProgressLine = '';
                    }
                    process.stdout.write(`  ${output}`);
                }
            });

            subprocess.stderr?.on('data', (data) => {
                process.stderr.write(`  ${data.toString()}`);
            });

            await subprocess;

            // Clear the progress line after completion
            if (lastProgressLine) {
                process.stdout.write('\r' + ' '.repeat(100) + '\r');
            }

            // Check file size after download
            const stats = await fs.stat(outputPath);
            const sizeMB = stats.size / (1024 * 1024);

            console.log(`\n✅ Completed: ${sanitizedTitle} (${sizeMB.toFixed(2)} MB)`);
            console.log(`${'='.repeat(80)}\n`);

            return outputPath;
        } catch (error) {
            console.error(`\n❌ Error downloading ${title}:`, error);
            console.log(`${'='.repeat(80)}\n`);
            throw error;
        }
    }
}
