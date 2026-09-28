const { spawn } = require('child_process');
const child = spawn('doppler', ['run', '--', 'pnpm', '--filter', 'backend', 'exec', 'drizzle-kit', 'generate'], { shell: true });
child.stdout.on('data', (data) => process.stdout.write(data));
child.stderr.on('data', (data) => process.stderr.write(data));
child.on('close', (code) => process.exit(code));
setInterval(() => child.stdin.write('\r\n'), 500);
