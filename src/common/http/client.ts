import axios, { type AxiosInstance } from "axios";

export interface HttpClientOptions {
  baseURL: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export function createHttpClient(options: HttpClientOptions): AxiosInstance {
  return axios.create({
    baseURL: options.baseURL,
    timeout: options.timeoutMs ?? 10_000,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}
