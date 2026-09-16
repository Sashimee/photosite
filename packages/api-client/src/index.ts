import createClient from 'openapi-fetch';
import type { paths } from './schema.js';

export interface CreateApiClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export function createApiClient(options: CreateApiClientOptions) {
  return createClient<paths>(options);
}

export type { paths } from './schema.js';
