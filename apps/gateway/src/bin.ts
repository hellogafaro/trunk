import { loadConfig } from "./config.ts";
import { startGatewayServer } from "./server.ts";
import { upstreamRuntime } from "./upstream.ts";

const config = loadConfig();
const server = startGatewayServer(config);

const shutdown = () => {
  server.close(() => {
    void upstreamRuntime.dispose().finally(() => process.exit(0));
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
