import createClient from 'openapi-fetch';
import type { paths } from './schema.js';

// `credentials`/`headers` are picked from openapi-fetch's own client options
// instead of naming `RequestInit`/`HeadersInit` directly: this package has no
// DOM lib (it also runs under React Native), and those ambient ("lib.dom.d.ts")
// ones aren't declared here.
type UnderlyingClientOptions = NonNullable<Parameters<typeof createClient<paths>>[0]>;

export interface CreateApiClientOptions extends Pick<
  UnderlyingClientOptions,
  'credentials' | 'headers'
> {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export function createApiClient(options: CreateApiClientOptions) {
  return createClient<paths>(options);
}

export type { paths, components } from './schema.js';
