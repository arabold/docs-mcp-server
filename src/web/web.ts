import Fastify from "fastify";
import { logger } from "../utils/logger";

const webServer = Fastify({
  logger: false, // Disable Fastify's default logger
});

webServer.get("/health", async (request, reply) => {
  return { status: "ok" };
});

export default webServer;
