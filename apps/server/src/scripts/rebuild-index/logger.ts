import { appendFileSync } from "node:fs";
import { StepError } from "./constants-types";

let logFile = "";

export function setLogFile(path: string): void {
  logFile = path;
}

export function log(line: string): void {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  if (logFile) {
    appendFileSync(logFile, `${text}\n`, "utf-8");
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  log(`STEP ${name}`);
  try {
    const result = await fn();
    log(`STEP ${name}: ok`);
    return result;
  } catch (error) {
    throw new StepError(name, errorMessage(error));
  }
}
