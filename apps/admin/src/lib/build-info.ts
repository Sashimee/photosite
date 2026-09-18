import { env } from './env';

export interface BuildInfo {
  version: string;
  builtAt: string | null;
}

export function getBuildInfo(): BuildInfo {
  return {
    version: env.NEXT_PUBLIC_BUILD_SHA ?? 'dev',
    builtAt: env.NEXT_PUBLIC_BUILD_TIME ?? null,
  };
}
