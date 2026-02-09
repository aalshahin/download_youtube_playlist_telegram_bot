import { Telegraf, Context } from 'telegraf';
import { config } from './config';
import { Downloader } from './downloader';
import { DownloadQueue, QueueItem } from './queue';
import { VideoMetadata } from './downloader';

interface UserState {
    url: string;
    isAudio: boolean;
    destination: 'telegram' | 'local';
    videos: VideoMetadata[];
    waitingForRange: boolean;
}

export class Bot {
    private bot: Telegraf;
    private downloader: Downloader;
    private downloadQueue: DownloadQueue;
    private userStates: Map<number, UserState> = new Map();

    constructor() {
        this.bot = new Telegraf(config.botToken);
        this.downloader = new Downloader(config.downloadDir);
        this.downloadQueue = new DownloadQueue(this.downloader, this.bot);

        this.setupHandlers();
    }

    private setupHandlers() {
        this.bot.command('start', (ctx) => {
            ctx.reply('Welcome! Send me a YouTube playlist or video link, and I will download it for you.');
        });

        this.bot.command('myid', (ctx) => {
            ctx.reply(`Your Telegram User ID is: ${ctx.from?.id}`);
        });

        this.bot.on('text', async (ctx) => {
            const text = ctx.message.text;
            const userId = ctx.from?.id;

            // Check if user is in "waiting for range" state
            if (userId && this.userStates.has(userId)) {
                const state = this.userStates.get(userId)!;
                if (state.waitingForRange) {
                    await this.handleRangeInput(ctx, text, state);
                    return;
                }
            }

            if (this.isValidYoutubeUrl(text)) {
                const isAuthorized = userId && config.authorizedUserId === userId;

                // Build keyboard based on authorization
                const keyboard = [];

                if (isAuthorized) {
                    keyboard.push([
                        { text: '📹 Video to Telegram', callback_data: `dl:video:telegram` },
                        { text: '🎵 Audio to Telegram', callback_data: `dl:audio:telegram` }
                    ]);
                    keyboard.push([
                        { text: '💾 Video to Local', callback_data: `dl:video:local` },
                        { text: '💾 Audio to Local', callback_data: `dl:audio:local` }
                    ]);
                } else {
                    keyboard.push([
                        { text: '📹 Video (MP4)', callback_data: `dl:video:telegram` },
                        { text: '🎵 Audio (MP3)', callback_data: `dl:audio:telegram` }
                    ]);
                }

                await ctx.reply('How would you like to download this?', {
                    reply_parameters: { message_id: ctx.message.message_id },
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                });
            } else {
                ctx.reply('That doesn\'t look like a valid YouTube link.');
            }
        });

        this.bot.on('callback_query', async (ctx) => {
            if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
            const data = ctx.callbackQuery.data as string;
            const userId = ctx.from?.id;

            // Handle range selection callbacks
            if (data.startsWith('range:')) {
                await this.handleRangeCallback(ctx, data);
                return;
            }

            // We need the original message text (the URL)
            const callbackMsg = ctx.callbackQuery.message as any;
            const originalMsg = callbackMsg?.reply_to_message;

            if (!originalMsg || !originalMsg.text) {
                await ctx.answerCbQuery('Could not retrieve original link.');
                return;
            }

            const url = originalMsg.text;
            // Parse format: dl:video:telegram or dl:audio:local
            const parts = data.split(':');
            const isAudio = parts[1] === 'audio';
            const destination = (parts[2] as 'telegram' | 'local') || 'telegram';

            const destinationText = destination === 'local' ? 'local Downloads' : 'Telegram';
            await ctx.answerCbQuery(`Checking playlist...`);
            await ctx.editMessageText(`Processing link as ${isAudio ? 'Audio' : 'Video'} to ${destinationText}...`);

            // Fetch metadata first to check if it's a playlist
            try {
                const videos = await this.downloader.getPlaylistMetadata(url);

                if (videos.length === 0) {
                    await ctx.reply('No videos found in that link.');
                    return;
                }

                // If playlist with multiple videos, offer range selection
                if (videos.length > 1) {
                    if (userId) {
                        this.userStates.set(userId, {
                            url,
                            isAudio,
                            destination,
                            videos,
                            waitingForRange: false
                        });
                    }

                    await ctx.reply(
                        `📋 Playlist detected with ${videos.length} videos.\n\nHow many videos would you like to download?`,
                        {
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        { text: '📥 Download All', callback_data: 'range:all' },
                                        { text: '🔢 Select Range', callback_data: 'range:custom' }
                                    ]
                                ]
                            }
                        }
                    );
                } else {
                    // Single video, download directly
                    await this.processVideos(ctx, videos, isAudio, destination);
                }
            } catch (error) {
                console.error('Error fetching metadata:', error);
                await ctx.reply('Failed to fetch video/playlist metadata.');
            }
        });
    }

    private isValidYoutubeUrl(url: string): boolean {
        return url.includes('youtube.com') || url.includes('youtu.be');
    }

    private async handleRangeCallback(ctx: Context, data: string) {
        const userId = ctx.from?.id;
        if (!userId || !this.userStates.has(userId)) {
            await ctx.answerCbQuery('Session expired. Please send the link again.');
            return;
        }

        const state = this.userStates.get(userId)!;

        if (data === 'range:all') {
            await ctx.answerCbQuery('Downloading all videos...');
            await ctx.editMessageText(`📥 Downloading all ${state.videos.length} videos...`);
            this.userStates.delete(userId);
            await this.processVideos(ctx, state.videos, state.isAudio, state.destination);
        } else if (data === 'range:custom') {
            await ctx.answerCbQuery();
            state.waitingForRange = true;
            this.userStates.set(userId, state);
            await ctx.reply(
                `Please enter the range of videos you want to download.\n\n` +
                `Examples:\n` +
                `• "2-6" - downloads videos 2 through 6\n` +
                `• "1,3,5" - downloads videos 1, 3, and 5\n` +
                `• "2-5,8,10-12" - downloads videos 2-5, 8, and 10-12\n\n` +
                `Total videos in playlist: ${state.videos.length}`
            );
        }
    }

    private async handleRangeInput(ctx: Context, text: string, state: UserState) {
        const userId = ctx.from?.id;
        if (!userId) return;

        try {
            const indices = this.parseRange(text, state.videos.length);

            if (indices.length === 0) {
                await ctx.reply('❌ Invalid range. Please try again or send a new link.');
                this.userStates.delete(userId);
                return;
            }

            const selectedVideos = indices.map(i => state.videos[i - 1]).filter(v => v !== undefined);

            await ctx.reply(`✅ Selected ${selectedVideos.length} video(s). Starting download...`);
            this.userStates.delete(userId);
            await this.processVideos(ctx, selectedVideos, state.isAudio, state.destination);
        } catch (error) {
            await ctx.reply('❌ Invalid range format. Please send a new link to try again.');
            this.userStates.delete(userId);
        }
    }

    private parseRange(input: string, maxVideos: number): number[] {
        const indices = new Set<number>();
        const parts = input.split(',').map(p => p.trim());

        for (const part of parts) {
            if (part.includes('-')) {
                // Range like "2-6"
                const rangeParts = part.split('-');
                if (rangeParts.length !== 2 || !rangeParts[0] || !rangeParts[1]) {
                    throw new Error('Invalid range');
                }
                const start = parseInt(rangeParts[0].trim());
                const end = parseInt(rangeParts[1].trim());
                if (isNaN(start) || isNaN(end) || start < 1 || end > maxVideos || start > end) {
                    throw new Error('Invalid range');
                }
                for (let i = start; i <= end; i++) {
                    indices.add(i);
                }
            } else {
                // Single number like "5"
                const num = parseInt(part);
                if (isNaN(num) || num < 1 || num > maxVideos) {
                    throw new Error('Invalid number');
                }
                indices.add(num);
            }
        }

        return Array.from(indices).sort((a, b) => a - b);
    }

    private async processVideos(ctx: Context, videos: VideoMetadata[], isAudio: boolean, destination: 'telegram' | 'local') {
        videos.forEach((video: VideoMetadata, index: number) => {
            const item: QueueItem = {
                ctx,
                video,
                isAudio,
                videoIndex: index + 1,
                totalVideos: videos.length,
                destination
            };
            this.downloadQueue.add(item);
        });
    }

    public launch() {
        this.bot.launch();
        console.log('Bot is running...');

        // Enable graceful stop
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}
