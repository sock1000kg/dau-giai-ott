import { Redis } from 'ioredis';

/** BullMQ requires maxRetriesPerRequest=null so blocking commands can reconnect. */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}
