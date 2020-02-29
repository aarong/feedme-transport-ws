import WebSocket from "ws";
import client from "./client.main";

/**
 * Create a Node client with the ws module injected (dependency injection to
 * facilitate unit testing).
 * @param {string} address
 * @param {?string|Array} protocols
 * @param {?Object} options
 * @returns {Client}
 */
export default function feedmeTransportWsClient(address, protocols, options) {
  return client(WebSocket, address, protocols || "", options || {});
}
