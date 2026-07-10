export interface AppConfig {
  host: string;
  port: number;
}

export function loadConfig(): AppConfig {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
  };
}
