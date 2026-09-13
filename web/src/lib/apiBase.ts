/**
 * Where the pipeline lives.
 *
 * In development this is empty, so every request stays a relative path and Vite's dev proxy
 * forwards /api, /video and /ws to the pipeline. Nothing needs configuring to run locally.
 *
 * In a deployed build the frontend and the pipeline are on different hosts, so relative paths
 * would resolve against the static host and 404. VITE_API_BASE is baked in at build time and
 * every request is prefixed with it.
 *
 * It must be https in production. The page is served over TLS, so a plain http pipeline is
 * blocked as mixed content: the map loads, sits there dead, and looks exactly like a bug that
 * it is not. The browser reports it only in the console, so it is easy to chase for an hour.
 */
const RAW = (import.meta.env.VITE_API_BASE ?? "").trim();

/** Trailing slashes would double up against paths that already start with one. */
export const API_BASE = RAW.replace(/\/+$/, "");

/** An absolute URL for an API path, or the path itself when running behind the dev proxy. */
export function api(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

/**
 * The WebSocket URL. Derived from API_BASE so it follows the pipeline rather than the page:
 * on a deployed frontend the socket must point at the pipeline's host, not the static host
 * serving the HTML.
 */
export function wsUrl(path = "/ws"): string {
  if (!API_BASE) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}${path}`;
  }
  return `${API_BASE.replace(/^http/, "ws")}${path}`;
}
