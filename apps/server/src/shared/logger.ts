// ============================================================================
// Logger Utility
// ============================================================================+

export const logger = {
  info: (msg: string, ...args: any[]) => {
    const cleanArgs = args.filter((a) => a !== undefined);
    console.log(`[INFO] ${msg}`, ...cleanArgs);
  },
  error: (msg: any, ...args: any[]) => {
    const cleanArgs = args.filter((a) => a !== undefined);
    console.error(`[ERROR] ${msg}`, ...cleanArgs);
  },
  warn: (msg: string, ...args: any[]) => {
    const cleanArgs = args.filter((a) => a !== undefined);
    console.warn(`[WARN] ${msg}`, ...cleanArgs);
  },
  debug: (msg: string, ...args: any[]) => {
    const cleanArgs = args.filter((a) => a !== undefined);
    console.log(`[DEBUG] ${msg}`, ...cleanArgs);
  },
};

export default logger;
