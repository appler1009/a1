/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly COMMIT_HASH: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'virtual:licenses' {
  export const licenses: Array<{ name: string; license: string; author: string }>;
}
