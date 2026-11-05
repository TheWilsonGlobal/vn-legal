/**
 * Windows-only helper for AC 31.
 *
 * On Windows, ChildProcess.kill("SIGTERM") is TerminateProcess: no JavaScript
 * signal handler can ever run, so "langfuse shutdown ok" can never be observed
 * from a real signal. This wrapper is named server.ts on purpose: server.ts
 * decides it is the main module from process.argv[1] ending in "server.ts".
 * It imports the real server unchanged and, when the parent sends the IPC
 * message "SIGTERM", invokes the handlers the server registered with
 * process.on("SIGTERM") by calling process.emit("SIGTERM"). That exercises the
 * real shutdown hook; it is NOT an OS signal. The README says so.
 */
import "../../../../../src/api/server.ts";

process.on("message", (msg) => {
  if (msg === "SIGTERM") {
    process.emit("SIGTERM" as any);
  }
});
