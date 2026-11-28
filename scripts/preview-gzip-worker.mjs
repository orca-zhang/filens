import { parentPort } from 'node:worker_threads';
import { gzipAsync } from '@gfx/zopfli';

parentPort.once('message', async ({ bytes, iterations }) => {
  try {
    const compressed = await gzipAsync(bytes, { numiterations: iterations, blocksplittingmax: 0 });
    parentPort.postMessage({ bytes: compressed });
  } catch (error) { parentPort.postMessage({ error: String(error) }); }
});
