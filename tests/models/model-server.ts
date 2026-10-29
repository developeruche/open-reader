import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

/** Serves models/cache/** at http://localhost:<port>/models/ (stands in for Hugging Face). */
export function startModelServer(
  port = 8766,
): Promise<{ base: string; close(): void; requests: string[] }> {
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    requests.push(url);
    const file = path.resolve('models/cache', url.replace(/^\/models\//, ''));
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!url.startsWith('/models/') || !existsSync(file) || statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('Content-Length', statSync(file).size);
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(port, () =>
      resolve({ base: `http://localhost:${port}/models`, close: () => server.close(), requests }),
    ),
  );
}

export const hasModels = () => existsSync('models/cache/kokoro/onnx/model_quantized.onnx');
