import client from "./browser.main";

/* eslint no-restricted-globals: ["off"] */
/* global WebSocket, MozWebSocket, window, self */

/**
 * Create a browser client with native WebSocket injected (dependency injection
 * to facilitate unit testing).
 * @param {string} address
 * @param {?string|Array} protocols
 * @throws {Error} "NO_WEBSOCKET: ..."
 * @returns {Client}
 */
export default function feedmeTransportWsClient(address, protocols) {
  // Get the native WebSocket implementation
  let ws;
  if (typeof WebSocket !== "undefined") {
    ws = WebSocket;
  } else if (typeof MozWebSocket !== "undefined") {
    ws = MozWebSocket;
  } else if (typeof global !== "undefined") {
    ws = global.WebSocket || global.MozWebSocket;
  } else if (typeof window !== "undefined") {
    ws = window.WebSocket || window.MozWebSocket;
  } else if (typeof self !== "undefined") {
    ws = self.WebSocket || self.MozWebSocket;
  }

  // Throw if WebSockets are not supported
  if (!ws) {
    throw new Error(
      "NO_WEBSOCKETS: The environment does not appear to support WebSockets."
    );
  }

  // Create and return the client
  return client(ws, address, protocols || "");
}
