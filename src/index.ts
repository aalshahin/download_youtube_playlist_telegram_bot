import { Bot } from './bot';
import { checkSystemDependencies, ensureDownloadDir } from './utils';
import { config } from './config';

async function main() {
    await checkSystemDependencies();
    await ensureDownloadDir(config.downloadDir);

    const bot = new Bot();
    bot.launch();
}

main().catch(console.error);
