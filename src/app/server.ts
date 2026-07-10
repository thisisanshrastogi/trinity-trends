import Fastify from "fastify";
import { routes } from "./routes.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(routes);

  return app;
}
