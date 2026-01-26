import { Telegraf, Context } from 'telegraf';
import { config } from './config';
import { Downloader } from './downloader';
import { DownloadQueue, QueueItem } from './queue';
import { VideoMetadata } from './downloader';

export class Bot {
    private bot: Telegraf;
    private downloader: Downloader;
    private downloadQueue: DownloadQueue;

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

        this.bot.on('text', async (ctx) => {
            const text = ctx.message.text;
            if (this.isValidYoutubeUrl(text)) {
                // Ask the user: Video or Audio?
                await ctx.reply('How would you like to download this?', {
                    reply_parameters: { message_id: ctx.message.message_id },
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📹 Video (MP4)', callback_data: `dl:video` },
                                { text: '🎵 Audio (MP3)', callback_data: `dl:audio` }
                            ]
                        ]
                    }
                });
            } else {
                ctx.reply('That doesn\'t look like a valid YouTube link.');
            }
        });

        this.bot.on('callback_query', async (ctx) => {
            if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
            const data = ctx.callbackQuery.data as string;

            // We need the original message text (the URL)
            // The callback query message is the bot's "How would you like...?" message.
            // That message is a reply to the user's original URL message.
            // Telegram bot API: callback_query.message.reply_to_message

            const callbackMsg = ctx.callbackQuery.message as any;
            const originalMsg = callbackMsg?.reply_to_message;

            if (!originalMsg || !originalMsg.text) {
                await ctx.answerCbQuery('Could not retrieve original link.');
                return;
            }

            const url = originalMsg.text;
            const isAudio = data === 'dl:audio';

            await ctx.answerCbQuery(`Queueing ${isAudio ? 'audio' : 'video'} download...`);
            await ctx.editMessageText(`Processing link as ${isAudio ? 'Audio' : 'Video'}: ${url}`);

            await this.handleYoutubeLink(ctx, url, isAudio);
        });
    }

    private isValidYoutubeUrl(url: string): boolean {
        return url.includes('youtube.com') || url.includes('youtu.be');
    }

    private async handleYoutubeLink(ctx: Context, url: string, isAudio: boolean) {
        try {
            await ctx.reply('Fetching metadata...');
            const videos = await this.downloader.getPlaylistMetadata(url);

            if (videos.length === 0) {
                await ctx.reply('No videos found in that link.');
                return;
            }

            await ctx.reply(`Found ${videos.length} video(s). Adding to queue...`);

            videos.forEach((video: VideoMetadata, index: number) => {
                const item: QueueItem = {
                    ctx,
                    video,
                    isAudio,
                    videoIndex: index + 1,
                    totalVideos: videos.length
                };
                this.downloadQueue.add(item);
            });

        } catch (error) {
            console.error('Error fetching metadata:', error);
            await ctx.reply('Failed to fetch video/playlist metadata. Make sure the link is public and valid.');
        }
    }

    public launch() {
        this.bot.launch();
        console.log('Bot is running...');

        // Enable graceful stop
        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}
