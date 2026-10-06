import { spawn } from 'node:child_process';
import { DEFAULT_DATA_DIR, startServer } from '../src/server.js';

// Double-click launchers always use the demo; paid Bedrock mode is opt-in via npm start.
const sharing = process.argv.includes('--share');
try {
  const app = await startServer({
    host: sharing ? '0.0.0.0' : '127.0.0.1',
    port: Number(process.env.PORT || 4317),
    agentMode: 'guided',
    weatherMode: 'demo',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || undefined,
    dataDir: process.env.DATA_DIR || DEFAULT_DATA_DIR,
  });
  const address = `http://127.0.0.1:${app.server.address().port}`;
  console.log(`\nTravel Folio: ${address}\nGuided demo and sample weather. No AWS setup needed.`);
  console.log(sharing ? 'Phone sharing is on. Keep this window open and use the same Wi-Fi.' : 'Keep this window open while using the app.');
  console.log('Press Ctrl+C to stop.\n');
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', address]]
    : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`Open ${address} in your browser.`));
  child.unref();
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(error.code === 'EADDRINUSE'
    ? 'The port is already in use. Close the other Travel Folio window, or use a different PORT.'
    : `Travel Folio could not start: ${error.message}`);
  process.exitCode = 1;
}
