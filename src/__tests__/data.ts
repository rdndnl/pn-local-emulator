import { Config } from '../config';
import { LogLevelName } from '../logger';

export const envs: NodeJS.ProcessEnv = {
  ...process.env,
};

export const config: Config = {
  server: {
    hostname: envs['HOSTNAME'] as string,
    port: Number(envs['PORT']),
    uploadToS3URL: new URL(`http://${envs['HOSTNAME']}:${envs['PORT']}/uploadS3`),
    downloadDocumentURL: new URL(`http://${envs['HOSTNAME']}:${envs['PORT']}/download`),
  },
  logLevel: envs['LOG_LEVEL'] as LogLevelName,
};
