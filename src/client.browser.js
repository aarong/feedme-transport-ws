import client from "./client";

/* eslint no-restricted-globals: ["off"] */
/* global WebSocket, MozWebSocket, window, self */

export default function clientFactory(...args) {
  let ws;

  // From isomorphic-ws
  // Avoid putting Node-specific code in the browser bundle
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

  // Throw is there is no WebSocket module available
  if (!ws) {
    throw new Error(
      "NO_WEBSOCKETS: The environment does not appear to support WebSockets."
    );
  }

  if (args.length === 1) {
    return client(ws, args[0]);
  }
  if (args.length === 3) {
    return client(ws, args[0], args[1]);
  }
  return client(ws, args[0], args[1], args[2]);
}
