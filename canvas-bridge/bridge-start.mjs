#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from './index.js';

const bridgeDir = path.dirname(fileURLToPath(import.meta.url));
const bridgeHome = process.env.CANVAS_BRIDGE_HOME || path.resolve(bridgeDir, '../data/storages/canvas-bridge');
process.env.CANVAS_BRIDGE_HOME = bridgeHome;

const settingsFile = path.join(bridgeHome, 'settings.json');
let stopping = false;
let dispose = () => {};
let complete;
const stopped = new Promise((resolve) => { complete = resolve; });

function shutdown() {
  if (stopping) return;
  stopping = true;
  dispose();
  complete();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

apply({
  standalone: true,
  logger: { warn: (message) => console.warn('[canvas-bridge]', message) },
  tools: { register: () => () => {} },
  effect: (initialize) => { dispose = initialize(); },
});

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); }
  catch { return { port: 3211, token: '' }; }
}

async function isReady(port, token) {
  if (!token) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/bootstrap`, {
      headers: { origin: 'http://localhost:3000' },
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return false;
    const settings = await response.json();
    return settings.standalone === true && settings.token === token && settings.url === `http://127.0.0.1:${port}`;
  } catch {
    return false;
  }
}

try {
  let readyPort = 0;
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    const settings = readSettings();
    const ports = [settings.port, ...Array.from({ length: 10 }, (_, index) => 3211 + index)];
    for (const port of new Set(ports)) {
      if (await isReady(port, settings.token)) {
        readyPort = port;
        break;
      }
    }
    if (readyPort || stopping) break;
    await Promise.race([new Promise((resolve) => setTimeout(resolve, 500)), stopped]);
  }
  if (!readyPort && !stopping) throw new Error('画布桥启动超时，请查看桥服务日志');
  if (readyPort) console.info(`Infinite Canvas bridge ready at http://127.0.0.1:${readyPort}`);
  await stopped;
} catch (error) {
  shutdown();
  console.error('[canvas-bridge]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
