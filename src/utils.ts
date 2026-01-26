import commandExists from 'command-exists';
import fs from 'fs-extra';
import path from 'path';

export async function checkSystemDependencies() {
    try {
        await commandExists('ffmpeg');
        await commandExists('yt-dlp');
        console.log('System dependencies (ffmpeg, yt-dlp) are present.');
    } catch (error) {
        console.error('Missing system dependencies!');
        console.error('Please ensure both "ffmpeg" and "yt-dlp" are installed and in your PATH.');
        process.exit(1);
    }
}

export async function ensureDownloadDir(dir: string) {
    await fs.ensureDir(dir);
}

export function sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9 \u0600-\u06FF.-]/g, '').trim();
}
