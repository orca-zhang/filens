import { parentPort } from 'node:worker_threads';
import { gzipAsync } from '@gfx/zopfli';

parentPort.once('message', async bytes => {
  try {
    const compressed = await gzipAsync(bytes, { numiterations: 15 });
    parentPort.postMessage({ bytes: compressed });
  } catch (error) { parentPort.postMessage({ error: String(error) }); }
});
