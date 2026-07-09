import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".png": "image/png",
};

export function startStaticServer(rootDir, port = 0) {
  const root = resolve(rootDir);
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = join(root, urlPath === "/" ? "/index.html" : urlPath);
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(port, "127.0.0.1", () => {
      const { port: actualPort } = server.address();
      resolvePromise({ server, port: actualPort, baseUrl: `http://127.0.0.1:${actualPort}` });
    });
  });
}
