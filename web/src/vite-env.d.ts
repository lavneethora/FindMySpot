/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * "0" or "false" connects to the Python pipeline. Anything else, including unset,
   * replays contracts/mock_sequence.json in process. Mock is the default on purpose:
   * the frontend must never require the backend to be running.
   */
  readonly VITE_USE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "@contracts/*.json" {
  const value: unknown;
  export default value;
}
