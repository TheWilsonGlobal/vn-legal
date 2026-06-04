// #!/usr/bin/env node
// // ============================================================================
// // Test Runner - Filter ConGraphDB Debug Messages
// // ============================================================================

// import { spawn } from 'child_process';
// import { createInterface } from 'readline';

// const testArgs = process.argv.slice(2);
// const testCommand = testArgs[0] || 'test:integration:graph';
// const filterDebug = !testArgs.includes('--debug');

// console.log(`Running: ${testCommand}${filterDebug ? ' (filtered)' : ''}\n`);

// const child = spawn('npm', ['run', testCommand], {
//   shell: true,
//   stderr: 'pipe',
//   stdout: 'pipe',
// });

// let outputBuffer = '';
// const debugPattern = /^DEBUG:(?= (Final Projection|Final Aliases|Database::))/;

// if (filterDebug) {
//   // Filter output line by line
//   const filterStream = (stream: NodeJS.ReadableStream) => {
//     const rl = createInterface({
//       input: stream,
//       crlfDelay: Infinity,
//     });

//     rl.on('line', (line) => {
//       if (!debugPattern.test(line)) {
//         console.log(line);
//       }
//     });
//   };

//   filterStream(child.stdout);
//   filterStream(child.stderr);
// } else {
//   // Show all output
//   child.stdout.pipe(process.stdout);
//   child.stderr.pipe(process.stderr);
// }

// child.on('exit', (code) => {
//   process.exit(code || 0);
// });
