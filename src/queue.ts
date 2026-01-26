import { Downloader, type VideoMetadata } from './downloader';
import { Context, Telegraf } from 'telegraf';
import fs from 'fs-extra';
import path from 'path';
import { splitFileIfNeeded } from './utils';

export interface QueueItem {
    ctx: Context;
    video: VideoMetadata;
    isAudio: boolean;
    videoIndex: number;
    totalVideos: number;
}

export class DownloadQueue {
    private queue: QueueItem[] = [];
    private isProcessing = false;

    constructor(private downloader: Downloader, private bot: Telegraf) { }

    add(item: QueueItem) {
        this.queue.push(item);
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    async processQueue() {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            return;
        }

        this.isProcessing = true;
        const item = this.queue.shift();

        if (item) {
            await this.processItem(item);
        }

        // Process next item
        this.processQueue();
    }

    private async processItem(item: QueueItem) {
        const { ctx, video, isAudio, videoIndex, totalVideos } = item;
        const videoLabel = `[${videoIndex}/${totalVideos}]`;
        try {
            await ctx.reply(`${videoLabel} Downloading: ${video.title}...`);
            const filePath = await this.downloader.downloadVideo(video.url, video.title, isAudio);

            // Re-check size before upload
            const stats = await fs.stat(filePath);
            const sizeMB = stats.size / (1024 * 1024);

            // Split file if larger than 49MB
            const { parts, wasSplit } = await splitFileIfNeeded(filePath);

            if (wasSplit) {
                await ctx.reply(`${videoLabel} File is ${sizeMB.toFixed(2)}MB. Splitting into ${parts.length} parts...`);
            } else {
                await ctx.reply(`${videoLabel} Uploading: ${video.title} (${sizeMB.toFixed(2)}MB)...`);
            }

            for (let i = 0; i < parts.length; i++) {
                const partPath = parts[i]!;
                const partSuffix = wasSplit ? ` (Part ${i + 1}/${parts.length})` : '';
                const partName = `${videoLabel} ${video.title}${partSuffix}`;

                try {
                    if (isAudio) {
                        await ctx.replyWithAudio({ source: partPath, filename: path.basename(partPath) }, {
                            title: partName
                        });
                    } else {
                        await ctx.replyWithVideo({ source: partPath, filename: path.basename(partPath) }, {
                            caption: partName,
                            supports_streaming: true
                        });
                    }
                } catch (e: any) {
                    console.error("Upload error", e);
                    await ctx.reply(`Error uploading ${partName}. Trying as document...`);
                    try {
                        await ctx.replyWithDocument({ source: partPath, filename: path.basename(partPath) });
                    } catch (docErr) {
                        await ctx.reply(`Failed to upload ${partName}.`);
                    }
                }

                // Cleanup each part after upload
                await fs.remove(partPath);
            }

        } catch (error) {
            console.error(`Error processing ${video.title}:`, error);
            await ctx.reply(`${videoLabel} Failed to process ${video.title}. Skipping.`);
        }
    }
}
