/// <reference types="vite/client" />

/** Build stamp injected by vite.config.js (git hash + time) */
declare const __BUILD__: string;

interface ImportMetaEnv {
  /** Optional absolute URL of an always-on game server (defaults to same origin) */
  readonly VITE_GAME_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
