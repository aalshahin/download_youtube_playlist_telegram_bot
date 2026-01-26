import { Downloader, type VideoMetadata } from './downloader';
import { Context, Telegraf } from 'telegraf';
import fs from 'fs-extra';
import path from 'path';

export interface QueueItem {
    ctx: Context;
    video: VideoMetadata;
    isAudio: boolean;
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
        const { ctx, video, isAudio } = item;
        try {
            await ctx.reply(`Downloading: ${video.title}...`);
            const filePath = await this.downloader.downloadVideo(video.url, video.title, isAudio);

            // Re-check size before upload
            const stats = await fs.stat(filePath);
            const sizeMB = stats.size / (1024 * 1024);

            await ctx.reply(`Uploading: ${video.title} (${sizeMB.toFixed(2)}MB)...`);

            if (sizeMB > 50) {
                await ctx.reply(`File is too large for Telegram (${sizeMB.toFixed(2)}MB). Trying to send as document...`);
                try {
                    await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
                } catch (e) {
                    await ctx.reply(`Failed to upload ${video.title} even as document. It might be too large.`);
                }
            } else {
                try {
                    // Send as audio or video
                    if (isAudio) {
                        await ctx.replyWithAudio({ source: filePath, filename: path.basename(filePath) }, {
                            title: video.title
                        });
                    } else {
                        await ctx.replyWithVideo({ source: filePath, filename: path.basename(filePath) }, {
                            caption: video.title,
                            supports_streaming: true
                        });
                    }
                } catch (e: any) {
                    console.error("Upload error", e);
                    await ctx.reply(`Error uploading. Trying as document.`);
                    await ctx.replyWithDocument({ source: filePath, filename: path.basename(filePath) });
                }
            }

            // Cleanup
            await fs.remove(filePath);

        } catch (error) {
            console.error(`Error processing ${video.title}:`, error);
            await ctx.reply(`Failed to process ${video.title}. Skipping.`);
        }
    }
}
