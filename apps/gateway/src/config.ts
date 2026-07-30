export interface GatewayConfig {
  readonly host: string;
  readonly port: number;
  readonly apiKey: string;
  readonly trunkServerUrl: string;
  readonly trunkServerToken: string;
  readonly cwd: string | undefined;
}

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
};

const parsePort = (value: string | undefined): number => {
  const port = Number(value ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("GATEWAY_PORT must be an integer between 1 and 65535.");
  }
  return port;
};

export const loadConfig = (): GatewayConfig => ({
  host: process.env.GATEWAY_HOST?.trim() || "127.0.0.1",
  port: parsePort(process.env.GATEWAY_PORT),
  apiKey: required("GATEWAY_API_KEY"),
  trunkServerUrl: required("TRUNK_SERVER_URL").replace(/\/+$/, ""),
  trunkServerToken: required("TRUNK_SERVER_TOKEN"),
  cwd: process.env.GATEWAY_CWD?.trim() || undefined,
});
