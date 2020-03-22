import async from "async";
import WebSocket from "ws";
// import transportWsServer from "../../build/server";
import transportWsClient from "../../build/client";

/*

Integration tests for the Node client build.

1. Test the transport client against a raw ws server
    - Make sure it plays nicely with other WebSocket transport implementations
    - Allows testing things like ping/pong and ws.terminate(), which you can't on the transport server
    - Test library-initiated functionality including transport/ws configuration
    - Test ws server-initiated functionality

2. Test the transport client against the transport server
    - Test library-initiated functionality including transport/ws configuration
    - Test transport server-initiated functionality

For both, make sure that the client satisfies the transport API requirements
specified by feedme-client and the commitments laid out in the transport README.

Check:

  - Errors and return values
  - State functions (transport.state())
  - Client transport events
  - Server events


Don't worry about testing argument validity (done in unit tests) or that return
values are empty (only state() returns a value and you check it for everything).

Not all functionality can be tested by manipulating ws - for example, no obvious
way to make the ws client return an error to the ping callback. Have to trust the
unit tests on those.

Configuration:

The tests do not use Jest fake timers, they use real timers configured to
time out quickly, since calls to jest.advanceTimersByTime() only invoke
setTimeout/setInterval functions but do not result in communications being
sent through the actual WebSocket. Calling process.nextTick() didn't
work either, so a real timer is required.

With real timers, if there was a transport setTimeout() for X ms, you can not
ensure that it has fired by simply doing a setTimeout() for X ms in the tests.
The test timer needs to wait an additional few milliseconds to ensure that the
tranport timer has fired, which is configured using EPSILON. Needs to be set
conservatively (high), otherwise tests will intermittently pass/fail.

*/

const EPSILON = 100;

let nextPortNumber = 3000;
const getNextPortNumber = () => {
  // Avoid port conflicts between servers across tests
  nextPortNumber += 1;
  return nextPortNumber - 1;
};

const createClientListener = transportClient => {
  const evts = ["connecting", "connect", "disconnect", "message"];
  const l = {};
  evts.forEach(evt => {
    l[evt] = jest.fn();
    transportClient.on(evt, l[evt]);
  });
  l.mockClear = () => {
    evts.forEach(evt => {
      l[evt].mockClear();
    });
  };
  return l;
};

const createWsServerListener = wsServer => {
  const evts = ["close", "connection", "error", "listening"];
  const l = {};
  evts.forEach(evt => {
    l[evt] = jest.fn();
    wsServer.on(evt, l[evt]);
  });
  l.mockClear = () => {
    evts.forEach(evt => {
      l[evt].mockClear();
    });
  };
  return l;
};

const createWsServerClientListener = wsServerClient => {
  const evts = ["close", "error", "message", "open", "ping", "pong"];
  const l = {};
  evts.forEach(evt => {
    l[evt] = jest.fn();
    wsServerClient.on(evt, l[evt]);
  });
  l.mockClear = () => {
    evts.forEach(evt => {
      l[evt].mockClear();
    });
  };
  return l;
};

/*

Test transport client against a raw ws server

*/

describe("Test against raw WebSocket server", () => {
  // Configuration options

  describe("The transport client configuration options", () => {
    // You can't use fake jest timers (note above), so you can't properly
    // test the exact setInterval/setTimeout durations - done in unit tests
    // Just make sure the overall heartbeat feature works correctly

    // Heartbeat timeout (and thus interval) need to be long enough
    // to account for client-server latency
    const heartbeatIntervalMs = 20;
    const heartbeatTimeoutMs = 19;

    describe("If the heartbeat is enabled and server is immediately not responsive to pings", () => {
      // Errors and return values - N/A

      // State functions

      it("should return correct state through the process", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Disable the ws server's ping listener so it doesn't respond with pong
              wsServerClient._receiver._events.ping = () => {};

              expect(transportClient.state()).toBe("connected");

              // Wait for the heartbeat to timeout
              setTimeout(
                cb,
                heartbeatIntervalMs + heartbeatTimeoutMs + EPSILON
              );
            },
            cb => {
              expect(transportClient.state()).toBe("disconnected");
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected due to heartbeat timeout
            wsServer.close();
            done();
          }
        );
      });

      // Client transport events

      it("should emit correctly on the client transport", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        let listener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Disable the ws server's ping listener so it doesn't respond with pong
              wsServerClient._receiver._events.ping = () => {};

              listener = createClientListener(transportClient);

              // Wait for the heartbeat to timeout
              setTimeout(
                cb,
                heartbeatIntervalMs + heartbeatTimeoutMs + EPSILON
              );
            },
            cb => {
              expect(listener.connect.mock.calls.length).toBe(0);
              expect(listener.connecting.mock.calls.length).toBe(0);
              expect(listener.disconnect.mock.calls.length).toBe(1);
              expect(listener.disconnect.mock.calls[0].length).toBe(1);
              expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(
                Error
              );
              expect(listener.disconnect.mock.calls[0][0].message).toBe(
                "FAILURE: The WebSocket heartbeat failed."
              );
              expect(listener.message.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected due to heartbeat timeout
            wsServer.close();
            done();
          }
        );
      });

      // Server events

      it("should fire ping events on the server", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        let sListener;
        let cListener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              sListener = createWsServerListener(wsServer);
              cListener = createWsServerClientListener(wsServerClient);

              // Disable the ws server's ping listener so it doesn't respond with pong
              wsServerClient._receiver._events.ping = () => {};

              // Wait for the heartbeat to timeout
              setTimeout(
                cb,
                heartbeatIntervalMs + heartbeatTimeoutMs + EPSILON
              );
            },
            cb => {
              expect(sListener.close.mock.calls.length).toBe(0);
              expect(sListener.connection.mock.calls.length).toBe(0);
              expect(sListener.error.mock.calls.length).toBe(0);
              expect(sListener.listening.mock.calls.length).toBe(0);

              expect(cListener.close.mock.calls.length).toBe(1);
              expect(cListener.error.mock.calls.length).toBe(0);
              expect(cListener.message.mock.calls.length).toBe(0);
              expect(cListener.open.mock.calls.length).toBe(0);
              expect(cListener.ping.mock.calls.length).toBe(0); // Disabled
              expect(cListener.pong.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected due to heartbeat timeout
            wsServer.close();
            done();
          }
        );
      });
    });

    describe("If the heartbeat is enabled and server is eventually not responsive to pings", () => {
      // Errors and return values - N/A

      // State functions

      it("should return correct state through the process", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Run through the ping/pong cycle a few times
              setTimeout(cb, 5 * heartbeatIntervalMs);
            },
            cb => {
              // Disable the ws server's ping listener so it doesn't respond with pong
              wsServerClient._receiver._events.ping = () => {};

              expect(transportClient.state()).toBe("connected");

              // Wait for the heartbeat to timeout
              setTimeout(
                cb,
                heartbeatIntervalMs + heartbeatTimeoutMs + EPSILON
              );
            },
            cb => {
              expect(transportClient.state()).toBe("disconnected");
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected due to heartbeat timeout
            wsServer.close();
            done();
          }
        );
      });

      // Client transport events

      it("should emit correctly on the client transport", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        let listener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              listener = createClientListener(transportClient);

              // Run through the ping/pong cycle a few times
              setTimeout(cb, 5 * heartbeatIntervalMs);
            },
            cb => {
              expect(listener.connect.mock.calls.length).toBe(0);
              expect(listener.connecting.mock.calls.length).toBe(0);
              expect(listener.disconnect.mock.calls.length).toBe(0);
              expect(listener.message.mock.calls.length).toBe(0);

              // Disable the ws server's ping listener so it doesn't respond with pong
              wsServerClient._receiver._events.ping = () => {};

              // Wait for the heartbeat to timeout
              setTimeout(
                cb,
                heartbeatIntervalMs + heartbeatTimeoutMs + EPSILON
              );
            },
            cb => {
              expect(listener.connect.mock.calls.length).toBe(0);
              expect(listener.connecting.mock.calls.length).toBe(0);
              expect(listener.disconnect.mock.calls.length).toBe(1);
              expect(listener.disconnect.mock.calls[0].length).toBe(1);
              expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(
                Error
              );
              expect(listener.disconnect.mock.calls[0][0].message).toBe(
                "FAILURE: The WebSocket heartbeat failed."
              );
              expect(listener.message.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected due to heartbeat timeout
            wsServer.close();
            done();
          }
        );
      });

      // Server events

      it("should fire ping events on the server", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        let sListener;
        let cListener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              sListener = createWsServerListener(wsServer);
              cListener = createWsServerClientListener(wsServerClient);

              // Run through the ping/pong cycle a few times
              setTimeout(cb, 5 * heartbeatIntervalMs);
            },
            cb => {
              expect(sListener.close.mock.calls.length).toBe(0);
              expect(sListener.connection.mock.calls.length).toBe(0);
              expect(sListener.error.mock.calls.length).toBe(0);
              expect(sListener.listening.mock.calls.length).toBe(0);

              expect(cListener.close.mock.calls.length).toBe(0);
              expect(cListener.error.mock.calls.length).toBe(0);
              expect(cListener.message.mock.calls.length).toBe(0);
              expect(cListener.open.mock.calls.length).toBe(0);
              expect(cListener.ping.mock.calls.length > 0).toBe(true); // Not sure exactly how many with latency
              expect(cListener.pong.mock.calls.length).toBe(0);

              cListener.mockClear();

              // Disable the ws server's ping listener so it doesn't respond with pong
              wsServerClient._receiver._events.ping = () => {};

              // Wait for the heartbeat to timeout
              setTimeout(
                cb,
                heartbeatIntervalMs + heartbeatTimeoutMs + EPSILON
              );
            },
            cb => {
              expect(sListener.close.mock.calls.length).toBe(0);
              expect(sListener.connection.mock.calls.length).toBe(0);
              expect(sListener.error.mock.calls.length).toBe(0);
              expect(sListener.listening.mock.calls.length).toBe(0);

              expect(cListener.close.mock.calls.length).toBe(1);
              expect(cListener.error.mock.calls.length).toBe(0);
              expect(cListener.message.mock.calls.length).toBe(0);
              expect(cListener.open.mock.calls.length).toBe(0);
              expect(cListener.ping.mock.calls.length).toBe(0); // Disabled
              expect(cListener.pong.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected due to heartbeat timeout
            wsServer.close();
            done();
          }
        );
      });
    });

    describe("If the heartbeat is enabled and ws.ping() calls back failure immediately", () => {
      // Errors and return values - N/A

      // State functions

      it("should return correct state through the process", done => {
        let transportClient;
        let wsServer;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Make the call to ping() call back error by closing the connection
              // and remove the transport close listener so it doesn't know about it
              transportClient._wsClient.removeAllListeners("close");
              transportClient._wsClient.close();
              setTimeout(
                cb,
                heartbeatIntervalMs + EPSILON // Ping fails after heartbeatIntervalMs
              );
            },
            cb => {
              expect(transportClient.state()).toBe("disconnected");
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected
            wsServer.close();
            done();
          }
        );
      });

      // Client transport events

      it("should emit transport disconnect event", done => {
        let transportClient;
        let wsServer;
        let listener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              listener = createClientListener(transportClient);

              // Make the call to ping() call back error by closing the connection
              // and remove the transport close listener so it doesn't know about it
              transportClient._wsClient.removeAllListeners("close");
              transportClient._wsClient.close();
              setTimeout(
                cb,
                heartbeatIntervalMs + EPSILON // Ping fails after heartbeatIntervalMs
              );
            },
            cb => {
              expect(listener.connect.mock.calls.length).toBe(0);
              expect(listener.connecting.mock.calls.length).toBe(0);
              expect(listener.disconnect.mock.calls.length).toBe(1);
              expect(listener.disconnect.mock.calls[0].length).toBe(1);
              expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(
                Error
              );
              expect(listener.disconnect.mock.calls[0][0].message).toBe(
                "FAILURE: The WebSocket heartbeat failed."
              );
              expect(listener.message.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected
            wsServer.close();
            done();
          }
        );
      });

      // Server events - N/A
    });

    describe("If the heartbeat is enabled and ws.ping() calls back failure eventually", () => {
      // Errors and return values - N/A

      // State functions

      it("should return correct state through the process", done => {
        let transportClient;
        let wsServer;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Run through the ping/pong cycle a few times
              setTimeout(cb, 5 * heartbeatIntervalMs);
            },
            cb => {
              // Make the call to ping() call back error by closing the connection
              // and remove the transport close listener so it doesn't know about it
              transportClient._wsClient.removeAllListeners("close");
              transportClient._wsClient.close();
              setTimeout(
                cb,
                heartbeatIntervalMs + EPSILON // Ping fails after heartbeatIntervalMs
              );
            },
            cb => {
              expect(transportClient.state()).toBe("disconnected");
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected
            wsServer.close();
            done();
          }
        );
      });

      // Client transport events

      it("should emit transport disconnect event", done => {
        let transportClient;
        let wsServer;
        let listener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Run through the ping/pong cycle a few times
              setTimeout(cb, 5 * heartbeatIntervalMs);
            },
            cb => {
              listener = createClientListener(transportClient);

              // Make the call to ping() call back error by closing the connection
              // and remove the transport close listener so it doesn't know about it
              transportClient._wsClient.removeAllListeners("close");
              transportClient._wsClient.close();
              setTimeout(
                cb,
                heartbeatIntervalMs + EPSILON // Ping fails after heartbeatIntervalMs
              );
            },
            cb => {
              expect(listener.connect.mock.calls.length).toBe(0);
              expect(listener.connecting.mock.calls.length).toBe(0);
              expect(listener.disconnect.mock.calls.length).toBe(1);
              expect(listener.disconnect.mock.calls[0].length).toBe(1);
              expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(
                Error
              );
              expect(listener.disconnect.mock.calls[0][0].message).toBe(
                "FAILURE: The WebSocket heartbeat failed."
              );
              expect(listener.message.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected
            wsServer.close();
            done();
          }
        );
      });

      // Server events - N/A
    });

    describe("If the heartbeat is enabled and server is always responsive to pings", () => {
      // Errors and return values - N/A

      // State functions

      it("should return correct state through the process", done => {
        let transportClient;
        let wsServer;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Run through the ping/pong cycle a few times
              setTimeout(cb, 20 * heartbeatIntervalMs);
            },
            cb => {
              expect(transportClient.state()).toBe("connected");
              cb();
            }
          ],
          () => {
            // Clean up
            transportClient.disconnect();
            wsServer.close();
            done();
          }
        );
      });

      // Client transport events

      it("should emit correctly on the client transport", done => {
        let transportClient;
        let wsServer;
        let listener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              listener = createClientListener(transportClient);

              // Run through the ping/pong cycle a few times
              setTimeout(cb, 20 * heartbeatIntervalMs);
            },
            cb => {
              expect(listener.connect.mock.calls.length).toBe(0);
              expect(listener.connecting.mock.calls.length).toBe(0);
              expect(listener.disconnect.mock.calls.length).toBe(0);
              expect(listener.message.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up
            transportClient.disconnect();
            wsServer.close();
            done();
          }
        );
      });

      // Server events

      it("should fire ping events on the server", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        let sListener;
        let cListener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              sListener = createWsServerListener(wsServer);
              cListener = createWsServerClientListener(wsServerClient);

              // Run through the ping/pong cycle a few times
              setTimeout(cb, 20 * heartbeatIntervalMs);
            },
            cb => {
              expect(sListener.close.mock.calls.length).toBe(0);
              expect(sListener.connection.mock.calls.length).toBe(0);
              expect(sListener.error.mock.calls.length).toBe(0);
              expect(sListener.listening.mock.calls.length).toBe(0);

              expect(cListener.close.mock.calls.length).toBe(0);
              expect(cListener.error.mock.calls.length).toBe(0);
              expect(cListener.message.mock.calls.length).toBe(0);
              expect(cListener.open.mock.calls.length).toBe(0);
              expect(cListener.ping.mock.calls.length > 0).toBe(true);
              expect(cListener.pong.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up
            transportClient.disconnect();
            wsServer.close();
            done();
          }
        );
      });
    });

    describe("If the heartbeat is disabled", () => {
      // Errors and return values - N/A

      // State functions

      it("should return correct state through the process", done => {
        let transportClient;
        let wsServer;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs: 0
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Run through the time span of a ping/pong cycle a few times
              setTimeout(cb, 20 * heartbeatIntervalMs);
            },
            cb => {
              expect(transportClient.state()).toBe("connected");
              cb();
            }
          ],
          () => {
            // Clean up
            transportClient.disconnect();
            wsServer.close();
            done();
          }
        );
      });

      // Client transport events

      it("should emit correctly on the client transport", done => {
        let transportClient;
        let wsServer;
        let listener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs: 0
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              listener = createClientListener(transportClient);

              // Run through the time span of a ping/pong cycle a few times
              setTimeout(cb, 20 * heartbeatIntervalMs);
            },
            cb => {
              expect(listener.connect.mock.calls.length).toBe(0);
              expect(listener.connecting.mock.calls.length).toBe(0);
              expect(listener.disconnect.mock.calls.length).toBe(0);
              expect(listener.message.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up
            transportClient.disconnect();
            wsServer.close();
            done();
          }
        );
      });

      // Server events

      it("should fire ping events on the server", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        let sListener;
        let cListener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs: 0
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              sListener = createWsServerListener(wsServer);
              cListener = createWsServerClientListener(wsServerClient);

              // Run through the time span of a ping/pong cycle a few times
              setTimeout(cb, 20 * heartbeatIntervalMs);
            },
            cb => {
              expect(sListener.close.mock.calls.length).toBe(0);
              expect(sListener.connection.mock.calls.length).toBe(0);
              expect(sListener.error.mock.calls.length).toBe(0);
              expect(sListener.listening.mock.calls.length).toBe(0);

              expect(cListener.close.mock.calls.length).toBe(0);
              expect(cListener.error.mock.calls.length).toBe(0);
              expect(cListener.message.mock.calls.length).toBe(0);
              expect(cListener.open.mock.calls.length).toBe(0);
              expect(cListener.ping.mock.calls.length).toBe(0);
              expect(cListener.pong.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up
            transportClient.disconnect();
            wsServer.close();
            done();
          }
        );
      });
    });
  });

  describe("Key ws client configuration options", () => {
    describe("The maxPayload setting, if exceeded", () => {
      // Errors and return values - N/A

      // State functions

      it("should update the state appropriately", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  maxPayload: 100 // bytes
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Have the server violate max payload
              wsServerClient.send("z".repeat(101));

              setTimeout(cb, EPSILON);
            },
            cb => {
              expect(transportClient.state()).toBe("disconnected");
              cb();
            }
          ],
          () => {
            // Clean up - transport client already closed
            wsServer.close();
            done();
          }
        );
      });

      // Client transport events

      it("should emit correctly on the client transport", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        let listener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  maxPayload: 100 // bytes
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              listener = createClientListener(transportClient);

              // Have the server violate max payload
              wsServerClient.send("z".repeat(101));
              setTimeout(cb, EPSILON);
            },
            cb => {
              expect(listener.connect.mock.calls.length).toBe(0);
              expect(listener.connecting.mock.calls.length).toBe(0);
              expect(listener.disconnect.mock.calls.length).toBe(1);
              expect(listener.disconnect.mock.calls[0].length).toBe(1);
              expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(
                Error
              );
              expect(listener.disconnect.mock.calls[0][0].message).toBe(
                "DISCONNECTED: The WebSocket closed."
              );
              expect(listener.disconnect.mock.calls[0][0].wsCode).toBe(1009); // Message too big
              expect(listener.message.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - transport client already closed
            wsServer.close();
            done();
          }
        );
      });

      // Server events

      it("should emit close on ws server", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        let sListener;
        let cListener;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  maxPayload: 100 // bytes
                }
              );
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              sListener = createWsServerListener(wsServer);
              cListener = createWsServerClientListener(wsServerClient);

              // Have the server violate max payload
              wsServerClient.send("z".repeat(101));
              setTimeout(cb, EPSILON);
            },
            cb => {
              expect(sListener.close.mock.calls.length).toBe(0);
              expect(sListener.connection.mock.calls.length).toBe(0);
              expect(sListener.error.mock.calls.length).toBe(0);
              expect(sListener.listening.mock.calls.length).toBe(0);

              expect(cListener.close.mock.calls.length).toBe(1);
              expect(cListener.error.mock.calls.length).toBe(0);
              expect(cListener.message.mock.calls.length).toBe(0);
              expect(cListener.open.mock.calls.length).toBe(0);
              expect(cListener.ping.mock.calls.length).toBe(0);
              expect(cListener.pong.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - transport client already closed
            wsServer.close();
            done();
          }
        );
      });
    });
  });

  // Library-facing API

  describe("The factory function", () => {
    // Errors and return values

    it("should return a transport object", () => {
      expect(transportWsClient("ws://localhost")).toBeInstanceOf(Object);
    });

    // State functions

    it("should initialize in the disconnected state", () => {
      expect(transportWsClient("ws://localhost").state()).toBe("disconnected");
    });

    // Client transport events - N/A

    // Server events - N/A
  });

  describe("The transport.connect() function", () => {
    describe("It may fail", () => {
      it("should fail if transport is connecting and ws is connecting", done => {
        let transportClient;
        let wsServer;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Confirm failure on double-call to connect
              transportClient = transportWsClient(`ws://localhost:${port}`);
              transportClient.connect();
              expect(() => {
                transportClient.connect();
              }).toThrow(
                new Error("INVALID_STATE: Already connecting or connected.")
              );
              transportClient.once("connect", cb);
            }
          ],
          () => {
            // Clean up
            transportClient.disconnect();
            wsServer.close();
            done();
          }
        );
      });

      it("should fail if transport is connecting and ws is disconnecting", done => {
        let transportClient;
        let wsServer;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(`ws://localhost:${port}`);
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Run the condition
              transportClient.disconnect(); // ws now disconnecting
              transportClient.connect(); // transport now connecting
              expect(() => {
                transportClient.connect();
              }).toThrow(
                new Error("INVALID_STATE: Already connecting or connected.")
              );
              cb();
            }
          ],
          () => {
            // Clean up
            transportClient.disconnect();
            wsServer.close();
            done();
          }
        );
      });

      it("should fail if transport is connected (ws is connected)", done => {
        let transportClient;
        let wsServer;
        const port = getNextPortNumber();

        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(`ws://localhost:${port}`);
              transportClient.connect();
              transportClient.once("connect", cb);
            },
            cb => {
              // Run the condition
              expect(() => {
                transportClient.connect();
              }).toThrow(
                new Error("INVALID_STATE: Already connecting or connected.")
              );
              cb();
            }
          ],
          () => {
            // Clean up
            transportClient.disconnect();
            wsServer.close();
            done();
          }
        );
      });
    });

    describe("It may succeed", () => {
      describe("If transport is disconnected and ws is disconnected - ws constructor fails", () => {
        // State functions

        it("should update the state correctly", () => {
          // Provide a valid URL so the transport constructor doesn't throw,
          // but an invalid ws option to make its constructor throw
          // State should become disconnected synchronously
          const transportClient = transportWsClient("ws://localhost", "", {
            protocolVersion: "junk"
          });
          expect(transportClient.state()).toBe("disconnected");
          transportClient.connect();
          expect(transportClient.state()).toBe("disconnected");
        });

        // Client transport events

        it("should emit transport connecting and disconnect (both sync)", () => {
          // Provide a valid URL so the transport constructor doesn't throw,
          // but an invalid ws option to make its constructor throw
          // State should become disconnected synchronously
          const transportClient = transportWsClient("ws://localhost", "", {
            protocolVersion: "junk"
          });
          const listener = createClientListener(transportClient);
          transportClient.connect();

          expect(listener.connecting.mock.calls.length).toBe(1);
          expect(listener.connecting.mock.calls[0].length).toBe(0);
          expect(listener.connect.mock.calls.length).toBe(0);
          expect(listener.disconnect.mock.calls.length).toBe(1);
          expect(listener.disconnect.mock.calls[0].length).toBe(1);
          expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
          expect(listener.disconnect.mock.calls[0][0].message).toBe(
            "DISCONNECTED: Could not initialize the WebSocket client."
          );
          expect(listener.disconnect.mock.calls[0][0].wsError).toBeInstanceOf(
            Error
          );
          expect(listener.message.mock.calls.length).toBe(0);
        });

        // Server events - N/A
      });

      describe("If transport is disconnected and ws is disconnected - ws constructor succeeds", () => {
        // State functions

        it("should update the state correctly", done => {
          let transportClient;
          let wsServer;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                expect(transportClient.state()).toBe("disconnected");
                transportClient.connect();
                expect(transportClient.state()).toBe("connecting");
                transportClient.once("connect", cb);
              },
              cb => {
                expect(transportClient.state()).toBe("connected");
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });

        // Client transport events

        it("should emit transport connecting (sync) and then connect (async)", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                // Create event listener first so that jest mocks are called before
                // moving to the next async block
                transportClient = transportWsClient(`ws://localhost:${port}`);
                listener = createClientListener(transportClient);
                transportClient.connect();

                // It should emit connecting synchronously
                expect(listener.connecting.mock.calls.length).toBe(1);
                expect(listener.connecting.mock.calls[0].length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                listener.mockClear();

                transportClient.once("connect", cb);
              },
              cb => {
                // It should emit connect asynchronously
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(1);
                expect(listener.connect.mock.calls[0].length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });

        // Server events

        it("should emit ws server connection", done => {
          let transportClient;
          let wsServer;
          let sListener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                sListener = createWsServerListener(wsServer);

                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.once("connect", cb);
              },
              cb => {
                expect(sListener.close.mock.calls.length).toBe(0);
                expect(sListener.connection.mock.calls.length).toBe(1);
                expect(sListener.error.mock.calls.length).toBe(0);
                expect(sListener.listening.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });
      });

      describe("If transport is disconnected and ws is connecting", () => {
        // State functions

        it("should update the state correctly", done => {
          let transportClient;
          let wsServer;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.disconnect(); // ws is still connecting
                expect(transportClient.state()).toBe("disconnected");
                transportClient.connect();
                expect(transportClient.state()).toBe("connecting");
                transportClient.once("connect", cb);
              },
              cb => {
                expect(transportClient.state()).toBe("connected");
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });

        // Client transport events

        it("should emit transport connecting (sync) and then connect (async)", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                // Create event listener first so that jest mocks are called before
                // moving to the next async block
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.disconnect(); // ws is still connecting

                listener = createClientListener(transportClient);
                transportClient.connect();

                // It should emit connecting synchronously
                expect(listener.connecting.mock.calls.length).toBe(1);
                expect(listener.connecting.mock.calls[0].length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                listener.mockClear();

                transportClient.once("connect", cb);
              },
              cb => {
                // It should emit connect asynchronously
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(1);
                expect(listener.connect.mock.calls[0].length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });

        // Server events

        it("should emit ws server connection", done => {
          let transportClient;
          let wsServer;
          let sListener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                sListener = createWsServerListener(wsServer);

                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.disconnect(); // ws is still connecting
                transportClient.connect();

                transportClient.once("connect", cb);
              },
              cb => {
                expect(sListener.close.mock.calls.length).toBe(0);
                expect(sListener.connection.mock.calls.length).toBe(1);
                expect(sListener.error.mock.calls.length).toBe(0);
                expect(sListener.listening.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });
      });

      describe("If transport is disconnected and ws is disconnecting", () => {
        // State functions

        it("should update the state correctly", done => {
          let transportClient;
          let wsServer;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.once("connect", cb);
              },
              cb => {
                transportClient.disconnect(); // ws is still disconnecting
                expect(transportClient.state()).toBe("disconnected");
                transportClient.connect();
                expect(transportClient.state()).toBe("connecting");
                transportClient.once("connect", cb);
              },
              cb => {
                expect(transportClient.state()).toBe("connected");
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });

        // Client transport events

        it("should emit transport connecting (sync) and then connect (async)", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.once("connect", cb);
              },
              cb => {
                transportClient.disconnect(); // ws is still disconnecting
                listener = createClientListener(transportClient);
                transportClient.connect();

                // It should emit connecting synchronously
                expect(listener.connecting.mock.calls.length).toBe(1);
                expect(listener.connecting.mock.calls[0].length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                listener.mockClear();

                transportClient.once("connect", cb);
              },
              cb => {
                // It should emit connect asynchronously
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(1);
                expect(listener.connect.mock.calls[0].length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });

        // Server events

        it("should emit ws server connection", done => {
          let transportClient;
          let wsServer;
          let sListener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.once("connect", cb);
              },
              cb => {
                sListener = createWsServerListener(wsServer);
                transportClient.disconnect(); // ws is still disconnecting
                transportClient.connect();
                transportClient.once("connect", cb);
              },
              cb => {
                expect(sListener.close.mock.calls.length).toBe(0);
                expect(sListener.connection.mock.calls.length).toBe(1);
                expect(sListener.error.mock.calls.length).toBe(0);
                expect(sListener.listening.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });
      });
    });
  });

  describe("The transport.disconnect() function", () => {
    describe("It may fail", () => {
      it("should fail if transport is disconnected", () => {
        const transportClient = transportWsClient("ws://localhost");
        expect(() => {
          transportClient.disconnect();
        }).toThrow(new Error("INVALID_STATE: Already disconnected."));
      });
    });

    describe("It may succeed", () => {
      describe("If the transport is connecting and ws is connecting", () => {
        // State functions

        it("should update the state correctly", done => {
          let transportClient;
          let wsServer;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Check the condition
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                expect(transportClient.state()).toBe("connecting");
                transportClient.disconnect();
                expect(transportClient.state()).toBe("disconnected");
                setTimeout(cb, EPSILON);
              },
              cb => {
                // Now ws has actually disconnected
                expect(transportClient.state()).toBe("disconnected");
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        // Client transport events

        it("should emit disconnect - with err", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Check the condition
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();

                listener = createClientListener(transportClient);
                const err = new Error("SOME_ERROR");
                transportClient.disconnect(err);

                // It should emit sync disconnect
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(1);
                expect(listener.disconnect.mock.calls[0].length).toBe(1);
                expect(listener.disconnect.mock.calls[0][0]).toBe(err);
                expect(listener.message.mock.calls.length).toBe(0);
                listener.mockClear();

                setTimeout(cb, EPSILON);
              },
              cb => {
                // Now ws has actually disconnected - no further emissions
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        it("should emit disconnect - no err", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Check the condition
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();

                listener = createClientListener(transportClient);
                transportClient.disconnect();

                // It should emit sync disconnect
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(1);
                expect(listener.disconnect.mock.calls[0].length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                listener.mockClear();

                setTimeout(cb, EPSILON);
              },
              cb => {
                // Now ws has actually disconnected - no further emissions
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        // Server events

        it("should emit ws server connection and then close", done => {
          let transportClient;
          let wsServer;
          let wsServerClient;
          let sListener;
          let cListener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.on("connection", ws => {
                  wsServerClient = ws;
                  cListener = createWsServerClientListener(wsServerClient);
                });
                wsServer.once("listening", () => {
                  sListener = createWsServerListener(wsServer);
                  cb();
                });
              },
              cb => {
                // Connect and immediately disconnect a client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.disconnect();
                setTimeout(cb, EPSILON);
              },
              cb => {
                expect(sListener.close.mock.calls.length).toBe(0);
                expect(sListener.connection.mock.calls.length).toBe(1);
                expect(sListener.error.mock.calls.length).toBe(0);
                expect(sListener.listening.mock.calls.length).toBe(0);

                expect(cListener.close.mock.calls.length).toBe(1);
                expect(cListener.error.mock.calls.length).toBe(0);
                expect(cListener.message.mock.calls.length).toBe(0);
                expect(cListener.open.mock.calls.length).toBe(0);
                expect(cListener.ping.mock.calls.length).toBe(0);
                expect(cListener.pong.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });
      });

      describe("If the transport is connecting and ws is disconnecting", () => {
        // State functions

        it("should update the state correctly", done => {
          let transportClient;
          let wsServer;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.on("connect", cb);
              },
              cb => {
                // Check the condition
                transportClient.disconnect(); // ws is still disconnecting
                transportClient.connect();
                expect(transportClient.state()).toBe("connecting");
                transportClient.disconnect();
                expect(transportClient.state()).toBe("disconnected");
                setTimeout(cb, EPSILON);
              },
              cb => {
                // Now ws has actually disconnected
                expect(transportClient.state()).toBe("disconnected");
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        // Client transport events

        it("should emit disconnect - with err", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.on("connect", cb);
              },
              cb => {
                // Check the condition
                transportClient.disconnect(); // ws is still disconnecting
                transportClient.connect();

                listener = createClientListener(transportClient);
                const err = new Error("SOME_ERROR");
                transportClient.disconnect(err);

                // It should emit sync disconnect
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(1);
                expect(listener.disconnect.mock.calls[0].length).toBe(1);
                expect(listener.disconnect.mock.calls[0][0]).toBe(err);
                expect(listener.message.mock.calls.length).toBe(0);
                listener.mockClear();

                setTimeout(cb, EPSILON);
              },
              cb => {
                // Now ws has actually disconnected - no further emissions
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        it("should emit disconnect - no err", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.on("connect", cb);
              },
              cb => {
                // Check the condition
                transportClient.disconnect(); // ws is still disconnecting
                transportClient.connect();

                listener = createClientListener(transportClient);
                transportClient.disconnect();

                // It should emit sync disconnect
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(1);
                expect(listener.disconnect.mock.calls[0].length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                listener.mockClear();

                setTimeout(cb, EPSILON);
              },
              cb => {
                // Now ws has actually disconnected - no further emissions
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        // Server events

        it("should emit ws server close", done => {
          let transportClient;
          let wsServer;
          let wsServerClient;
          let sListener;
          let cListener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.on("connection", ws => {
                  wsServerClient = ws;
                  cListener = createWsServerClientListener(wsServerClient);
                });
                wsServer.once("listening", () => {
                  sListener = createWsServerListener(wsServer);
                  cb();
                });
              },
              cb => {
                // Connect a client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.on("connect", cb);
              },
              cb => {
                transportClient.disconnect(); // ws still disconnecting
                transportClient.connect();

                cListener.mockClear();
                sListener.mockClear();
                transportClient.disconnect();
                setTimeout(cb, EPSILON);
              },
              cb => {
                expect(sListener.close.mock.calls.length).toBe(0);
                expect(sListener.connection.mock.calls.length).toBe(0);
                expect(sListener.error.mock.calls.length).toBe(0);
                expect(sListener.listening.mock.calls.length).toBe(0);

                expect(cListener.close.mock.calls.length).toBe(1);
                expect(cListener.error.mock.calls.length).toBe(0);
                expect(cListener.message.mock.calls.length).toBe(0);
                expect(cListener.open.mock.calls.length).toBe(0);
                expect(cListener.ping.mock.calls.length).toBe(0);
                expect(cListener.pong.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });
      });

      describe("If the transport is connected (ws is connected)", () => {
        // State functions

        it("should update the state correctly", done => {
          let transportClient;
          let wsServer;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.on("connect", cb);
              },
              cb => {
                // Check the condition
                expect(transportClient.state()).toBe("connected");
                transportClient.disconnect();
                expect(transportClient.state()).toBe("disconnected");
                setTimeout(cb, EPSILON);
              },
              cb => {
                // Now ws has actually disconnected
                expect(transportClient.state()).toBe("disconnected");
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        // Client transport events

        it("should emit disconnect - with err", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.on("connect", cb);
              },
              cb => {
                listener = createClientListener(transportClient);
                const err = new Error("SOME_ERROR");
                transportClient.disconnect(err);

                // It should emit sync disconnect
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(1);
                expect(listener.disconnect.mock.calls[0].length).toBe(1);
                expect(listener.disconnect.mock.calls[0][0]).toBe(err);
                expect(listener.message.mock.calls.length).toBe(0);
                listener.mockClear();

                setTimeout(cb, EPSILON);
              },
              cb => {
                // Now ws has actually disconnected - no further emissions
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        it("should emit disconnect - no err", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.on("connect", cb);
              },
              cb => {
                listener = createClientListener(transportClient);
                transportClient.disconnect();

                // It should emit sync disconnect
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(1);
                expect(listener.disconnect.mock.calls[0].length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                listener.mockClear();

                setTimeout(cb, EPSILON);
              },
              cb => {
                // Now ws has actually disconnected - no further emissions
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        // Server events

        it("should emit ws server close", done => {
          let transportClient;
          let wsServer;
          let wsServerClient;
          let sListener;
          let cListener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.on("connection", ws => {
                  wsServerClient = ws;
                  cListener = createWsServerClientListener(wsServerClient);
                });
                wsServer.once("listening", () => {
                  sListener = createWsServerListener(wsServer);
                  cb();
                });
              },
              cb => {
                // Connect a client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.on("connect", cb);
              },
              cb => {
                cListener.mockClear();
                sListener.mockClear();
                transportClient.disconnect();
                setTimeout(cb, EPSILON);
              },
              cb => {
                expect(sListener.close.mock.calls.length).toBe(0);
                expect(sListener.connection.mock.calls.length).toBe(0);
                expect(sListener.error.mock.calls.length).toBe(0);
                expect(sListener.listening.mock.calls.length).toBe(0);

                expect(cListener.close.mock.calls.length).toBe(1);
                expect(cListener.error.mock.calls.length).toBe(0);
                expect(cListener.message.mock.calls.length).toBe(0);
                expect(cListener.open.mock.calls.length).toBe(0);
                expect(cListener.ping.mock.calls.length).toBe(0);
                expect(cListener.pong.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });
      });
    });
  });

  describe("The transport.send() function", () => {
    describe("It may fail", () => {
      it("should throw if not connected", () => {
        const transportClient = transportWsClient("ws://localhost");
        expect(() => {
          transportClient.send("123");
        }).toThrow(new Error("INVALID_STATE: Not connected."));
      });
    });

    describe("It may succeed", () => {
      describe("If ws.send() calls back success", () => {
        // State functions

        it("should not change the state", done => {
          let transportClient;
          let wsServer;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.once("connect", cb);
              },
              cb => {
                expect(transportClient.state()).toBe("connected");
                transportClient.send("msg");
                expect(transportClient.state()).toBe("connected");
                setTimeout(cb, EPSILON);
              },
              cb => {
                expect(transportClient.state()).toBe("connected");
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });

        // Client transport events

        it("should emit nothing on the transport", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.once("connect", cb);
              },
              cb => {
                listener = createClientListener(transportClient);
                transportClient.send("msg");
                setTimeout(cb, EPSILON);
              },
              cb => {
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(0);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });

        // Server events

        it("should emit message on ws server", done => {
          let transportClient;
          let wsServer;
          let wsServerClient;
          let sListener;
          let cListener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("connection", ws => {
                  wsServerClient = ws;
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.once("connect", cb);
              },
              cb => {
                sListener = createWsServerListener(wsServer);
                cListener = createWsServerClientListener(wsServerClient);
                transportClient.send("msg");
                setTimeout(cb, EPSILON);
              },
              cb => {
                expect(sListener.close.mock.calls.length).toBe(0);
                expect(sListener.connection.mock.calls.length).toBe(0);
                expect(sListener.error.mock.calls.length).toBe(0);
                expect(sListener.listening.mock.calls.length).toBe(0);

                expect(cListener.close.mock.calls.length).toBe(0);
                expect(cListener.error.mock.calls.length).toBe(0);
                expect(cListener.message.mock.calls.length).toBe(1);
                expect(cListener.message.mock.calls[0].length).toBe(1);
                expect(cListener.message.mock.calls[0][0]).toBe("msg");
                expect(cListener.open.mock.calls.length).toBe(0);
                expect(cListener.ping.mock.calls.length).toBe(0);
                expect(cListener.pong.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up
              transportClient.disconnect();
              wsServer.close();
              done();
            }
          );
        });
      });

      describe("If ws.send() calls back error", () => {
        // State functions

        it("should change the state to disconnected", done => {
          let transportClient;
          let wsServer;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.once("connect", cb);
              },
              cb => {
                // Make the call to send () call back error by closing the connection
                // and remove the transport close listener so it doesn't know about it
                transportClient._wsClient.removeAllListeners("close");
                transportClient._wsClient.close();
                expect(transportClient.state()).toBe("connected");
                transportClient.send("msg");
                expect(transportClient.state()).toBe("disconnected");
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        // Client transport events

        it("should emit transport disconnect", done => {
          let transportClient;
          let wsServer;
          let listener;
          const port = getNextPortNumber();

          async.series(
            [
              cb => {
                // Start a ws server
                wsServer = new WebSocket.Server({
                  port
                });
                wsServer.once("listening", cb);
              },
              cb => {
                // Connect a transport client
                transportClient = transportWsClient(`ws://localhost:${port}`);
                transportClient.connect();
                transportClient.once("connect", cb);
              },
              cb => {
                // Make the call to send () call back error by closing the connection
                // and remove the transport close listener so it doesn't know about it
                transportClient._wsClient.removeAllListeners("close");
                transportClient._wsClient.close();
                listener = createClientListener(transportClient);
                transportClient.send("msg");
                expect(listener.connecting.mock.calls.length).toBe(0);
                expect(listener.connect.mock.calls.length).toBe(0);
                expect(listener.disconnect.mock.calls.length).toBe(1);
                expect(listener.disconnect.mock.calls[0].length).toBe(1);
                expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(
                  Error
                );
                expect(listener.disconnect.mock.calls[0][0].message).toBe(
                  "FAILURE: WebSocket transmission failed."
                );
                expect(
                  listener.disconnect.mock.calls[0][0].wsError
                ).toBeInstanceOf(Error);
                expect(listener.message.mock.calls.length).toBe(0);
                cb();
              }
            ],
            () => {
              // Clean up - client already disconnected
              wsServer.close();
              done();
            }
          );
        });

        // Server events - N/A
      });
    });
  });

  // Ws-facing event handlers

  describe("The transport._processWsOpen() function", () => {
    describe("If the transport state is disconnected", () => {
      // State functions

      it("should not change the state", done => {
        let transportClient;
        let wsServer;
        const port = getNextPortNumber();
        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(`ws://localhost:${port}`);
              transportClient.connect();
              transportClient.disconnect();
              expect(transportClient.state()).toBe("disconnected");
              setTimeout(cb, EPSILON);
            },
            cb => {
              expect(transportClient.state()).toBe("disconnected");
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected
            wsServer.close();
            done();
          }
        );
      });

      // Client transport events

      it("should emit nothing on the transport", done => {
        let transportClient;
        let wsServer;
        let listener;
        const port = getNextPortNumber();
        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(`ws://localhost:${port}`);
              transportClient.connect();
              transportClient.disconnect();
              listener = createClientListener(transportClient);
              setTimeout(cb, EPSILON);
            },
            cb => {
              expect(listener.connect.mock.calls.length).toBe(0);
              expect(listener.connecting.mock.calls.length).toBe(0);
              expect(listener.disconnect.mock.calls.length).toBe(0);
              expect(listener.message.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected
            wsServer.close();
            done();
          }
        );
      });

      // Server events

      it("should emit server connection and client close on the ws server", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        let sListener;
        let cListener;
        const port = getNextPortNumber();
        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
                cListener = createWsServerClientListener(wsServerClient);
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(`ws://localhost:${port}`);
              transportClient.connect();
              transportClient.disconnect();
              sListener = createWsServerListener(wsServer);
              setTimeout(cb, EPSILON);
            },
            cb => {
              expect(sListener.close.mock.calls.length).toBe(0);
              expect(sListener.connection.mock.calls.length).toBe(1);
              expect(sListener.error.mock.calls.length).toBe(0);
              expect(sListener.listening.mock.calls.length).toBe(0);

              expect(cListener.close.mock.calls.length).toBe(1);
              expect(cListener.error.mock.calls.length).toBe(0);
              expect(cListener.message.mock.calls.length).toBe(0);
              expect(cListener.open.mock.calls.length).toBe(0);
              expect(cListener.ping.mock.calls.length).toBe(0);
              expect(cListener.pong.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected
            wsServer.close();
            done();
          }
        );
      });
    });

    describe("If the transport state is connecting (heartbeat tested in config section, not here)", () => {
      // State functions

      it("should change the state to connected", done => {
        let transportClient;
        let wsServer;
        const port = getNextPortNumber();
        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(`ws://localhost:${port}`);
              transportClient.connect();
              expect(transportClient.state()).toBe("connecting");
              setTimeout(cb, EPSILON);
            },
            cb => {
              expect(transportClient.state()).toBe("connected");
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected
            wsServer.close();
            done();
          }
        );
      });

      // Client transport events

      it("should emit connect", done => {
        let transportClient;
        let wsServer;
        let listener;
        const port = getNextPortNumber();
        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(`ws://localhost:${port}`);
              transportClient.connect();
              listener = createClientListener(transportClient);
              setTimeout(cb, EPSILON);
            },
            cb => {
              expect(listener.connect.mock.calls.length).toBe(1);
              expect(listener.connect.mock.calls[0].length).toBe(0);
              expect(listener.connecting.mock.calls.length).toBe(0);
              expect(listener.disconnect.mock.calls.length).toBe(0);
              expect(listener.message.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected
            wsServer.close();
            done();
          }
        );
      });

      // Server events

      it("should emit connection on the server", done => {
        let transportClient;
        let wsServer;
        let wsServerClient;
        let sListener;
        let cListener;
        const port = getNextPortNumber();
        async.series(
          [
            cb => {
              // Start a ws server
              wsServer = new WebSocket.Server({
                port
              });
              wsServer.once("connection", ws => {
                wsServerClient = ws;
                cListener = createWsServerClientListener(wsServerClient);
              });
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              transportClient = transportWsClient(`ws://localhost:${port}`);
              transportClient.connect();
              sListener = createWsServerListener(wsServer);
              setTimeout(cb, EPSILON);
            },
            cb => {
              expect(sListener.close.mock.calls.length).toBe(0);
              expect(sListener.connection.mock.calls.length).toBe(1);
              expect(sListener.error.mock.calls.length).toBe(0);
              expect(sListener.listening.mock.calls.length).toBe(0);

              expect(cListener.close.mock.calls.length).toBe(0);
              expect(cListener.error.mock.calls.length).toBe(0);
              expect(cListener.message.mock.calls.length).toBe(0);
              expect(cListener.open.mock.calls.length).toBe(0);
              expect(cListener.ping.mock.calls.length).toBe(0);
              expect(cListener.pong.mock.calls.length).toBe(0);
              cb();
            }
          ],
          () => {
            // Clean up - client already disconnected
            wsServer.close();
            done();
          }
        );
      });
    });
  });

  describe("The transport._processWsMessage() function", () => {
    describe("If it was not a string message", () => {
      // State functions

      it("should change the state to disconnected", () => {});

      // Client transport events

      it("should emit disconnect", () => {});

      // Server events

      it("should emit client close on the ws server", () => {});
    });

    describe("If it was a string message", () => {
      // State functions

      it("should not change the state", () => {});

      // Client transport events

      it("should emit message", () => {});

      // Server events

      it("should emit nothing on the ws server", () => {});
    });
  });

  describe("The transport._processWsPong() function", () => {
    // Heartbeat is tested as part of configuration (above)
  });

  describe("The transport._processWsClose() function", () => {
    describe("If the transport state is disconnected - call to disconnect()", () => {});

    describe("If the transport state is disconnected - heartbeat timeout", () => {});

    describe("If the transport state is disconnected - heartbeat ping error", () => {});

    describe("If the transport state is disconnected - transmission failure", () => {});

    describe("If the transport state is disconnected - heartbeat ping error", () => {});

    describe("If the transport state is connecting and the ws client had been disconnecting - ws constructor throws", () => {});

    describe("If the transport state is connecting and the ws client had been disconnecting - ws constructor succeeds", () => {});

    describe("If the transport state is connecting and the ws client had been connecting", () => {});

    describe("If the transport state is connected and the ws client had been connected - server does wsServer.close()", () => {});

    describe("If the transport state is connected and the ws client had been connected - server does wsClient.close()", () => {});

    describe("If the transport state is connected and the ws client had been connected - server does wsClient.terminate()", () => {});
  });

  describe("The transport._processWsError() function", () => {
    // Debug printing only - nothing to test
  });
});

/*

Test transport client against the transport server

*/

describe("Test against transport server", () => {});

// describe.skip("Transport client vs transport server", () => {
//   it("Sample test", done => {
//     let s;
//     let cid;
//     let c;

//     async.series(
//       [
//         cb => {
//           // Set up the server - started
//           s = transportWsServer({ port: getNextPortNumber() });
//           s.once("start", cb);
//           s.once("connect", id => {
//             cid = id;
//           });
//           s.start();
//         },
//         cb => {
//           // Set up the client - connected
//           c = transportWsClient("ws://localhost:8080");
//           c.once("connect", cb);
//           c.connect();
//         },
//         cb => {
//           // Run the test
//           c.once("disconnect", err => {
//             expect(1).toBe(1);
//             console.log(err);
//             cb();
//           });
//           s.disconnect(cid);
//         }
//       ],
//       () => {
//         // Clean up - client already disconnected
//         s.stop();
//         done();
//       }
//     );
//   });
// });
