import WebSocket from "ws";
import client from "./client.main";

/**
 * Create a Node client with the ws module injected (dependency injection to
 * facilitate unit testing).
 * @param {string} address
 * @param {?Object} options
 * @returns {Client}
 */
export default function feedmeTransportWsClient(address, options) {
  return client(WebSocket, address, options || {});
}
