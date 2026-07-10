import { AxiosInstance } from "axios";

export interface Collector<Trequest, Tresult> {
  readonly id: string;
  collect(request: Trequest): Promise<Tresult>;
}

export interface CollectorLike<Trequest, Tresult> {
  readonly id: string;
  collect(request: Trequest): Promise<Tresult>;
}

export interface ClientLike<Trequest> {
  readonly httpClient?: AxiosInstance;
  search(request: Trequest): Promise<string>;
}
