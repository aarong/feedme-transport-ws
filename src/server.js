import WebSocket from "ws";
import server from "./server.main";

/**
 * Create a server with the ws module injected (dependency injection to
 * facilitate unit testing).
 * @param {Object} options
 * @returns {Server}
 */
export default function feedmeTransportWsServer(options) {
  return server(WebSocket.Server, options);
}
