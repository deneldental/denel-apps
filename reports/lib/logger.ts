import pino from 'pino'

const isDevelopment = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'SYS:standard',
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label }
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['password', 'token', 'authorization', 'cookie', 'apiKey'],
    remove: true,
  },
})

export function logError(error: unknown, context?: Record<string, unknown>) {
  if (error instanceof Error) {
    logger.error({ err: error, ...context }, error.message)
  } else {
    logger.error({ error, ...context }, 'Unknown error occurred')
  }
}

export function logInfo(message: string, data?: Record<string, unknown>) {
  logger.info(data, message)
}

export function logWarn(message: string, data?: Record<string, unknown>) {
  logger.warn(data, message)
}

export function logDebug(message: string, data?: Record<string, unknown>) {
  logger.debug(data, message)
}
