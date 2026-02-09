import { Downloader, type VideoMetadata } from './downloader';
import { Context, Telegraf } from 'telegraf';
import fs from 'fs-extra';
import path from 'path';
import { splitFileIfNeeded } from './utils';
import { config } from './config';

export interface QueueItem {
    ctx: Context;
    video: VideoMetadata;
    isAudio: boolean;
    videoIndex: number;
    totalVideos: number;
    destination: 'telegram' | 'local';
}

export class DownloadQueue {
    private queue: QueueItem[] = [];
    private isProcessing = false;

    constructor(private downloader: Downloader, private bot: Telegraf) { }

    add(item: QueueItem) {
        this.queue.push(item);
        const queuePosition = this.queue.length;
        console.log(`📋 Added to queue [Position ${queuePosition}]: ${item.video.title}`);
        if (!this.isProcessing) {
            this.processQueue();
        }
    }

    async processQueue() {
        if (this.queue.length === 0) {
            this.isProcessing = false;
            console.log('✨ Queue processing complete. All downloads finished.\n');
            return;
        }

        this.isProcessing = true;
        const item = this.queue.shift();

        if (item) {
            const remaining = this.queue.length;
            console.log(`\n🔄 Processing queue... (${remaining} item${remaining !== 1 ? 's' : ''} remaining)\n`);
            await this.processItem(item);
        }

        // Process next item
        this.processQueue();
    }

    private async processItem(item: QueueItem) {
        const { ctx, video, isAudio, videoIndex, totalVideos, destination } = item;
        const videoLabel = totalVideos > 1 ? `[${videoIndex}/${totalVideos}] ` : '';
        try {
            const filePath = await this.downloader.downloadVideo(video.url, video.title, isAudio);

            if (destination === 'local') {
                // Move to local downloads folder
                const fileName = path.basename(filePath);
                const localPath = path.join(config.localDownloadDir, fileName);
                await fs.move(filePath, localPath, { overwrite: true });
                console.log(`💾 Saved to local: ${localPath}`);
                await ctx.reply(`${videoLabel}✅ Downloaded to local: ${fileName}`);
            } else {
                // Upload to Telegram
                console.log(`📤 Uploading to Telegram: ${video.title}`);
                // Split file if larger than 49MB
                const { parts, wasSplit } = await splitFileIfNeeded(filePath);

                for (let i = 0; i < parts.length; i++) {
                    const partPath = parts[i]!;
                    const partSuffix = wasSplit ? ` (Part ${i + 1}/${parts.length})` : '';
                    const caption = `${videoLabel}${video.title}${partSuffix}`;

                    if (wasSplit) {
                        console.log(`  📦 Uploading part ${i + 1}/${parts.length}...`);
                    }

                    try {
                        if (isAudio) {
                            await ctx.replyWithAudio({ source: partPath, filename: path.basename(partPath) }, {
                                title: caption
                            });
                        } else {
                            await ctx.replyWithVideo({ source: partPath, filename: path.basename(partPath) }, {
                                caption,
                                supports_streaming: true
                            });
                        }
                        console.log(`  ✅ Upload ${wasSplit ? `part ${i + 1}/${parts.length}` : ''} complete`);
                    } catch (e: any) {
                        console.error("  ❌ Upload error", e);
                        try {
                            await ctx.replyWithDocument({ source: partPath, filename: path.basename(partPath) });
                            console.log(`  ✅ Uploaded as document instead`);
                        } catch (docErr) {
                            await ctx.reply(`Failed to upload ${caption}.`);
                            console.log(`  ❌ Complete upload failure`);
                        }
                    }

                    await fs.remove(partPath);
                }
            }

        } catch (error) {
            console.error(`Error processing ${video.title}:`, error);
            await ctx.reply(`${videoLabel}Failed to download ${video.title}.`);
        }
    }
}
