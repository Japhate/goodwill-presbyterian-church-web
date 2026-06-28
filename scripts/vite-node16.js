import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

if (!globalThis.crypto?.getRandomValues && crypto.webcrypto) {
  globalThis.crypto = crypto.webcrypto;
}

if (!crypto.getRandomValues && crypto.webcrypto?.getRandomValues) {
  crypto.getRandomValues = crypto.webcrypto.getRandomValues.bind(crypto.webcrypto);
}

await import(pathToFileURL(path.resolve('node_modules/vite/bin/vite.js')).href);
