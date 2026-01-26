import commandExists from 'command-exists';
import fs from 'fs-extra';
import path from 'path';
import execa from 'execa';

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

const MAX_FILE_SIZE_MB = 49; // Keep under 50MB Telegram limit

export interface SplitResult {
    parts: string[];
    wasSplit: boolean;
}

export async function getVideoDuration(filePath: string): Promise<number> {
    const { stdout } = await execa('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath
    ]);
    return parseFloat(stdout);
}

export async function splitFileIfNeeded(filePath: string): Promise<SplitResult> {
    const stats = await fs.stat(filePath);
    const sizeMB = stats.size / (1024 * 1024);

    if (sizeMB <= MAX_FILE_SIZE_MB) {
        return { parts: [filePath], wasSplit: false };
    }

    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    const dir = path.dirname(filePath);

    // Calculate how many parts we need
    const numParts = Math.ceil(sizeMB / MAX_FILE_SIZE_MB);
    const duration = await getVideoDuration(filePath);
    const partDuration = Math.ceil(duration / numParts);

    console.log(`Splitting ${baseName} (${sizeMB.toFixed(2)}MB) into ${numParts} parts...`);

    const parts: string[] = [];

    for (let i = 0; i < numParts; i++) {
        const startTime = i * partDuration;
        const partPath = path.join(dir, `${baseName}_part${i + 1}${ext}`);

        await execa('ffmpeg', [
            '-i', filePath,
            '-ss', startTime.toString(),
            '-t', partDuration.toString(),
            '-c', 'copy',
            '-y',
            partPath
        ]);

        parts.push(partPath);
    }

    // Remove original file
    await fs.remove(filePath);

    return { parts, wasSplit: true };
}
