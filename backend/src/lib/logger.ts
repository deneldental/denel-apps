import pino from 'pino'

export const logger = pino({
  level: 'debug', // Default to debug for now
  browser: { asObject: true },
  formatters: {
    level: (label: string) => {
      return { level: label }
    },
  },
  base: undefined,
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
