/**
 * Hard-coded configuration for the server.
 * @type {Object}
 */
export default {
  defaults: {
    heartbeatIntervalMs: 5000,
    heartbeatTimeoutMs: 4500,
  },

  // Wait this long for a non-listening external server to start after call
  // to transport.start()
  httpListeningMs: 2000,

  // Once started, check that an external server is listening this frequently
  httpPollingMs: 500,
};
