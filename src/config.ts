import dotenv from 'dotenv';
dotenv.config();

export const config = {
  botToken: process.env.BOT_TOKEN!,
  downloadDir: './downloads'
};

if (!config.botToken) {
  throw new Error('BOT_TOKEN is not defined in .env');
}
