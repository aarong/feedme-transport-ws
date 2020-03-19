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

*/

/*

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

// Tests will conflict if servers use the same port, so assign a new
// port number for each test
let nextPortNumber = 3000;
const getNextPortNumber = () => {
  nextPortNumber += 1;
  return nextPortNumber - 1;
};

const createClientListener = transportClient => {
  const l = {
    connecting: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    message: jest.fn()
  };
  transportClient.on("connecting", l.connecting);
  transportClient.on("connect", l.connect);
  transportClient.on("disconnect", l.disconnect);
  transportClient.on("message", l.message);
  l.mockClear = () => {
    l.connecting.mockClear();
    l.connect.mockClear();
    l.disconnect.mockClear();
    l.message.mockClear();
  };
  return l;
};

/*

Test transport client against a raw ws server

*/

describe("Testing against raw WebSocket server", () => {
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
    describe("If the heartbeat is enabled and server is immediately not responsive - no pong response", () => {
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
                  heartbeatIntervalMs: 2,
                  heartbeatTimeoutMs: 1
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
              setTimeout(cb, 3 + EPSILON);
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
                  heartbeatIntervalMs: 2,
                  heartbeatTimeoutMs: 1
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
              setTimeout(cb, 3 + EPSILON);
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
        // Or should you only check these when testing against the transport server?
        done();
      });
    });

    describe("If the heartbeat is enabled and server is immediately not responsive - ping callback error and ws open", () => {});

    describe("If the heartbeat is enabled and server is immediately not responsive - ping callback error and ws closing", () => {});

    describe("If the heartbeat is enabled and server is immediately not responsive - ping callback error and ws closed", () => {});

    describe("If the heartbeat is enabled and server is eventually not responsive", () => {
      // Errors and return values
      // State functions
      // Client transport events
      // Server events triggered by client actions
    });

    describe("If the heartbeat is enabled and server is always responsive", () => {
      // Errors and return values
      // State functions
      // Client transport events
      // Server events triggered by client actions
    });

    describe("If the heartbeat is disabled", () => {
      // Errors and return values
      // State functions
      // Client transport events
      // Server events triggered by client actions
    });
  });

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

  // HERE I'm not sure you go by function, I think you by calls you could
  // make on ws (terminate, etc) --- YES
  // /////

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

describe("Testing against transport server", () => {});

// ////

describe.skip("Transport client vs raw WebSocket server", () => {
  it("Sample test", done => {
    let wss;
    let wsc;
    let c;

    async.series(
      [
        cb => {
          // Set up the server - started
          wss = new WebSocket.Server({ port: getNextPortNumber() });
          wss.once("listening", cb);
          wss.once("connection", w => {
            wsc = w;
          });
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
          wsc.terminate();
        }
      ],
      () => {
        // Clean up - client already disconnected
        wss.close();
        done();
      }
    );
  });
});

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
