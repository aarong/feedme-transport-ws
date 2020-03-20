import async from "async";
import WebSocket from "ws";
import transportWsServer from "../../build/server";
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
  - Server events triggered by client actions


Don't worry about testing argument validity (done in unit tests).

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

const EPSILON = 50;

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

    // Server events triggered by client actions - N/A
  });

  describe("The transport client configuration options", () => {
    // Heartbeat timeout (and thus interval) need to be long enough
    // to account for client-server latency
    const heartbeatIntervalMs = 20;
    const heartbeatTimeoutMs = 19;

    describe("If the heartbeat is enabled and server is immediately not responsive", () => {
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
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.once("connect", cb);
              transportClient.connect();
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
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.once("connect", cb);
              transportClient.connect();
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

      // Server events triggered by client actions

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
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.once("connect", cb);
              transportClient.connect();
            },
            cb => {
              sListener = createWsServerListener(transportClient);
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

    describe("If the heartbeat is enabled and server is eventually not responsive", () => {
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
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.once("connect", cb);
              transportClient.connect();
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
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.once("connect", cb);
              transportClient.connect();
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

      // Server events triggered by client actions

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
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.once("connect", cb);
              transportClient.connect();
            },
            cb => {
              sListener = createWsServerListener(transportClient);
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

    describe("If the heartbeat is enabled and server is always responsive", () => {
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
              transportClient.once("connect", cb);
              transportClient.connect();
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
              transportClient.once("connect", cb);
              transportClient.connect();
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

      // Server events triggered by client actions

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
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs,
                  heartbeatTimeoutMs
                }
              );
              transportClient.once("connect", cb);
              transportClient.connect();
            },
            cb => {
              sListener = createWsServerListener(transportClient);
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
              transportClient.once("connect", cb);
              transportClient.connect();
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
              transportClient.once("connect", cb);
              transportClient.connect();
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

      // Server events triggered by client actions

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
              wsServer.once("listening", cb);
            },
            cb => {
              // Connect a transport client
              wsServer.once("connection", ws => {
                wsServerClient = ws;
              });
              transportClient = transportWsClient(
                `ws://localhost:${port}`,
                "",
                {
                  heartbeatIntervalMs: 0
                }
              );
              transportClient.once("connect", cb);
              transportClient.connect();
            },
            cb => {
              sListener = createWsServerListener(transportClient);
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

    // No way to make ws generate a ping callback error
  });

  // ////

  describe("The ws client configuration options (just a few key ones)", () => {});

  describe("The transport.connect() function", () => {
    // Errors and return values
    // State functions
    // Client transport events
    // Server events triggered by client actions
  });

  describe("The transport.disconnect() function", () => {
    // Errors and return values
    // State functions
    // Client transport events
    // Server events triggered by client actions
  });

  describe("The transport.send() function", () => {
    // Errors and return values
    // State functions
    // Client transport events
    // Server events triggered by client actions
  });

  describe("The transport._processWsOpen() function", () => {
    // Errors and return values
    // State functions
    // Client transport events
    // Server events triggered by client actions
  });

  describe("The transport._processWsMessage() function", () => {
    // Errors and return values
    // State functions
    // Client transport events
    // Server events triggered by client actions
  });

  describe("The transport._processWsPong() function", () => {
    // Errors and return values
    // State functions
    // Client transport events
    // Server events triggered by client actions
  });

  describe("The transport._processWsClose() function", () => {
    // Errors and return values
    // State functions
    // Client transport events
    // Server events triggered by client actions
  });

  describe("The transport._processWsError() function", () => {
    // Errors and return values
    // State functions
    // Client transport events
    // Server events triggered by client actions
  });
});

/*

Test transport client against the transport server

*/

describe("Test against transport server", () => {});

// ////

describe.skip("Transport client vs transport server", () => {
  it("Sample test", done => {
    let s;
    let cid;
    let c;

    async.series(
      [
        cb => {
          // Set up the server - started
          s = transportWsServer({ port: getNextPortNumber() });
          s.once("start", cb);
          s.once("connect", id => {
            cid = id;
          });
          s.start();
        },
        cb => {
          // Set up the client - connected
          c = transportWsClient("ws://localhost:8080");
          c.once("connect", cb);
          c.connect();
        },
        cb => {
          // Run the test
          c.once("disconnect", err => {
            expect(1).toBe(1);
            console.log(err);
            cb();
          });
          s.disconnect(cid);
        }
      ],
      () => {
        // Clean up - client already disconnected
        s.stop();
        done();
      }
    );
  });
});
