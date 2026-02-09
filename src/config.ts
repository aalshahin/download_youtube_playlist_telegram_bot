import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
dotenv.config();

export const config = {
  botToken: process.env.BOT_TOKEN!,
  downloadDir: './downloads',
  localDownloadDir: path.join(os.homedir(), 'Downloads'),
  authorizedUserId: process.env.AUTHORIZED_USER_ID ? parseInt(process.env.AUTHORIZED_USER_ID) : null
};

if (!config.botToken) {
  throw new Error('BOT_TOKEN is not defined in .env');
}
