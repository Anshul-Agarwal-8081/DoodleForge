import type { IncomingMessage, ServerResponse } from "node:http";
import { buildServer } from "../apps/api/src/server.js";

export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};

let server: ReturnType<typeof buildServer> | null = null;

async function getServer() {
  if (!server) {
    server = buildServer();
    await server.ready();
  }
  return server;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getServer();
  app.server.emit("request", req, res);
}
