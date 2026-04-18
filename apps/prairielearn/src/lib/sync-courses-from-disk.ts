import * as path from 'node:path';

import fs from 'fs-extra';

import { logger } from '@prairielearn/logger';

import { REPOSITORY_ROOT_PATH } from '../lib/paths.js';
import * as syncFromDisk from '../sync/syncFromDisk.js';

import { config } from './config.js';
import type { ServerJobLogger } from './server-jobs.js';

const serverJobLogger: ServerJobLogger = {
  error: (msg) => logger.error(msg),
  warn: (msg) => logger.warn(msg),
  info: (msg) => logger.info(msg),
  verbose: (msg) => logger.verbose(msg),
};

export async function syncCoursesFromDisk(): Promise<void> {
  for (const rawDir of config.courseDirs) {
    const courseDir = path.resolve(REPOSITORY_ROOT_PATH, rawDir);
    const infoCourseFile = path.join(courseDir, 'infoCourse.json');
    if (!(await fs.pathExists(infoCourseFile))) continue;

    logger.info(`Syncing course from disk: ${courseDir}`);
    const result = await syncFromDisk.syncOrCreateDiskToSql(courseDir, serverJobLogger);
    if (result.status === 'sharing_error') {
      throw new Error(`Course sync failed (sharing error) for ${courseDir}`);
    }
    if (result.hadJsonErrors) {
      throw new Error(`Course sync failed (JSON errors) for ${courseDir}`);
    }
  }
}
