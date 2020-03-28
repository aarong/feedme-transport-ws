import async from "async";
import WebSocket from "ws";
import http from "http";
import request from "request";
import url from "url";
import transportWsServer from "../../build/server";

/*

Test the transport server against a raw ws client. Allows testing things you
can't on the transport client, like heartbeat failure.

Check:

  - Errors and return values
  - State functions - transport.state()
  - Server transport events
  - Client ws events

Don't worry about testing argument validity (done in unit tests) or that return
values are empty (only state() returns a value and it's checked everywhere relevant).

Tests are run using a stand-alone server, but an external server is tested
as part of testing ws configuration options.

The tests do not use Jest fake timers, they use real timers configured to
time out quickly, since calls to jest.advanceTimersByTime() do not result
in communications being sent through the actual WebSocket.

With real timers, if the transport does setTimeout() for X ms, you can not
ensure that it has fired by simply doing a setTimeout() for X ms in the tests.
The test timer needs to wait an additional few milliseconds to ensure that the
tranport timer has fired, which is configured using EPSILON. Needs to be set
conservatively (high), otherwise tests will intermittently pass/fail.

*/

const EPSILON = 100;

let nextPortNumber = 3500;
const getNextPortNumber = () => {
  // Avoid port conflicts between servers across tests
  nextPortNumber += 1;
  return nextPortNumber - 1;
};

const createServerListener = transportServer => {
  const evts = [
    "starting",
    "start",
    "stopping",
    "stop",
    "connect",
    "message",
    "disconnect"
  ];
  const l = {};
  evts.forEach(evt => {
    l[evt] = jest.fn();
    transportServer.on(evt, l[evt]);
  });
  l.mockClear = () => {
    evts.forEach(evt => {
      l[evt].mockClear();
    });
  };
  return l;
};

const createWsClientListener = wsClient => {
  const evts = ["close", "error", "message", "open", "ping", "pong"];
  const l = {};
  evts.forEach(evt => {
    l[evt] = jest.fn();
    wsClient.on(evt, l[evt]);
  });
  l.mockClear = () => {
    evts.forEach(evt => {
      l[evt].mockClear();
    });
  };
  return l;
};

// Configuration options

describe("The transport configuration options", () => {
  // You can't use fake jest timers (note above), so you can't properly
  // test the exact setInterval/setTimeout durations - done in unit tests
  // Just make sure the overall heartbeat feature works correctly

  // Heartbeat timeout (and thus interval) need to be long enough
  // to account for client-server latency
  const heartbeatIntervalMs = 20;
  const heartbeatTimeoutMs = 19;

  describe("If the heartbeat is enabled and client is immediately not responsive to pings", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Server transport events

    it("should emit correctly on the transport server", done => {
      let transportServer;
      let wsClient;
      let listener;
      let clientId;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              heartbeatIntervalMs,
              heartbeatTimeoutMs
            });
            transportServer.once("connect", cid => {
              clientId = cid;
            });
            transportServer.start();
            transportServer.once("start", cb);
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },
          cb => {
            // Disable the ws client's ping listener so it doesn't respond with pong
            wsClient._receiver._events.ping = () => {};

            listener = createServerListener(transportServer);

            // Wait for the heartbeat to timeout
            setTimeout(cb, heartbeatIntervalMs + heartbeatTimeoutMs + EPSILON);
          },
          cb => {
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(1);
            expect(listener.disconnect.mock.calls[0].length).toBe(2);
            expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);
            expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
            expect(listener.disconnect.mock.calls[0][1].message).toBe(
              "FAILURE: The WebSocket heartbeat failed."
            );
            cb();
          }
        ],
        () => {
          // Clean up
          transportServer.stop();
          done();
        }
      );
    });

    // Client events

    it("should emit close on the ws client", done => {
      let transportServer;
      let wsClient;
      let cListener;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              heartbeatIntervalMs,
              heartbeatTimeoutMs
            });
            transportServer.start();
            transportServer.once("start", cb);
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },
          cb => {
            // Disable the ws client's ping listener so it doesn't respond with pong
            wsClient._receiver._events.ping = () => {};

            cListener = createWsClientListener(wsClient);

            // Wait for the heartbeat to timeout
            setTimeout(cb, heartbeatIntervalMs + heartbeatTimeoutMs + EPSILON);
          },
          cb => {
            expect(cListener.close.mock.calls.length).toBe(1);
            expect(cListener.close.mock.calls[0].length).toBe(2);
            expect(cListener.close.mock.calls[0][0]).toBe(1006);
            expect(cListener.error.mock.calls.length).toBe(0);
            expect(cListener.message.mock.calls.length).toBe(0);
            expect(cListener.open.mock.calls.length).toBe(0);
            expect(cListener.ping.mock.calls.length).toBe(0); // Disabled
            expect(cListener.pong.mock.calls.length).toBe(0);
            cb();
          }
        ],
        () => {
          // Clean up
          transportServer.stop();
          done();
        }
      );
    });
  });

  describe("If the heartbeat is enabled and client is eventually not responsive to pings", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Server transport events

    it("should emit correctly on the transport server", done => {
      let transportServer;
      let wsClient;
      let listener;
      let clientId;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              heartbeatIntervalMs,
              heartbeatTimeoutMs
            });
            transportServer.once("connect", cid => {
              clientId = cid;
            });
            transportServer.start();
            transportServer.once("start", cb);
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },
          cb => {
            // Run through the ping/pong cycle a few times
            setTimeout(cb, 5 * heartbeatIntervalMs);
          },
          cb => {
            // Disable the ws client's ping listener so it doesn't respond with pong
            wsClient._receiver._events.ping = () => {};

            listener = createServerListener(transportServer);

            // Wait for the heartbeat to timeout
            setTimeout(cb, heartbeatIntervalMs + heartbeatTimeoutMs + EPSILON);
          },
          cb => {
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(1);
            expect(listener.disconnect.mock.calls[0].length).toBe(2);
            expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);
            expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
            expect(listener.disconnect.mock.calls[0][1].message).toBe(
              "FAILURE: The WebSocket heartbeat failed."
            );
            cb();
          }
        ],
        () => {
          // Clean up
          transportServer.stop();
          done();
        }
      );
    });

    // Client events

    it("should emit close on the ws client", done => {
      let transportServer;
      let wsClient;
      let cListener;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              heartbeatIntervalMs,
              heartbeatTimeoutMs
            });
            transportServer.start();
            transportServer.once("start", cb);
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },

          cb => {
            // Run through the ping/pong cycle a few times
            setTimeout(cb, 5 * heartbeatIntervalMs);
          },
          cb => {
            // Disable the ws client's ping listener so it doesn't respond with pong
            wsClient._receiver._events.ping = () => {};

            cListener = createWsClientListener(wsClient);

            // Wait for the heartbeat to timeout
            setTimeout(cb, heartbeatIntervalMs + heartbeatTimeoutMs + EPSILON);
          },
          cb => {
            expect(cListener.close.mock.calls.length).toBe(1);
            expect(cListener.close.mock.calls[0].length).toBe(2);
            expect(cListener.close.mock.calls[0][0]).toBe(1006);
            expect(cListener.error.mock.calls.length).toBe(0);
            expect(cListener.message.mock.calls.length).toBe(0);
            expect(cListener.open.mock.calls.length).toBe(0);
            expect(cListener.ping.mock.calls.length).toBe(0); // Disabled
            expect(cListener.pong.mock.calls.length).toBe(0);
            cb();
          }
        ],
        () => {
          // Clean up
          transportServer.stop();
          done();
        }
      );
    });
  });

  describe("If the heartbeat is enabled and ws.ping() calls back failure immediately", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Server transport events

    it("should emit correctly on the transport server", done => {
      let transportServer;
      let wsClient;
      let listener;
      let clientId;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              heartbeatIntervalMs,
              heartbeatTimeoutMs
            });
            transportServer.once("connect", cid => {
              clientId = cid;
            });
            transportServer.start();
            transportServer.once("start", cb);
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },
          cb => {
            // Make the call to ping() call back error by closing the connection
            // and remove the transport close listener so it doesn't know about it
            transportServer._wsClients[clientId].removeAllListeners("close");
            transportServer._wsClients[clientId].close();

            listener = createServerListener(transportServer);

            setTimeout(
              cb,
              heartbeatIntervalMs + EPSILON // Ping fails after heartbeatIntervalMs
            );
          },
          cb => {
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(1);
            expect(listener.disconnect.mock.calls[0].length).toBe(2);
            expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);
            expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
            expect(listener.disconnect.mock.calls[0][1].message).toBe(
              "FAILURE: The WebSocket heartbeat failed."
            );
            cb();
          }
        ],
        () => {
          // Clean up
          transportServer.stop();
          done();
        }
      );
    });

    // Client events - N/A (ping failure induced by secret connection closure)
  });

  describe("If the heartbeat is enabled and ws.ping() calls back failure eventually", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Server transport events

    it("should emit correctly on the transport server", done => {
      let transportServer;
      let wsClient;
      let listener;
      let clientId;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              heartbeatIntervalMs,
              heartbeatTimeoutMs
            });
            transportServer.once("connect", cid => {
              clientId = cid;
            });
            transportServer.start();
            transportServer.once("start", cb);
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },
          cb => {
            // Run through the ping/pong cycle a few times
            setTimeout(cb, 5 * heartbeatIntervalMs);
          },
          cb => {
            // Make the call to ping() call back error by closing the connection
            // and remove the transport close listener so it doesn't know about it
            transportServer._wsClients[clientId].removeAllListeners("close");
            transportServer._wsClients[clientId].close();

            listener = createServerListener(transportServer);

            setTimeout(
              cb,
              heartbeatIntervalMs + EPSILON // Ping fails after heartbeatIntervalMs
            );
          },
          cb => {
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(1);
            expect(listener.disconnect.mock.calls[0].length).toBe(2);
            expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);
            expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
            expect(listener.disconnect.mock.calls[0][1].message).toBe(
              "FAILURE: The WebSocket heartbeat failed."
            );
            cb();
          }
        ],
        () => {
          // Clean up
          transportServer.stop();
          done();
        }
      );
    });

    // Client events - N/A (ping failure induced by secret connection closure)
  });

  describe("If the heartbeat is enabled and client is always responsive to pings", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Server transport events

    it("should emit correctly on the transport server", done => {
      let transportServer;
      let wsClient;
      let listener;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              heartbeatIntervalMs,
              heartbeatTimeoutMs
            });
            transportServer.start();
            transportServer.once("start", cb);
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },
          cb => {
            listener = createServerListener(transportServer);
            // Run through the ping/pong cycle a few times
            setTimeout(cb, 20 * heartbeatIntervalMs);
          },
          cb => {
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(0);
            cb();
          }
        ],
        () => {
          // Clean up
          transportServer.stop();
          done();
        }
      );
    });

    // Client events

    it("should emit nothing on the ws client", done => {
      let transportServer;
      let wsClient;
      let cListener;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              heartbeatIntervalMs,
              heartbeatTimeoutMs
            });
            transportServer.start();
            transportServer.once("start", cb);
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },

          cb => {
            cListener = createWsClientListener(wsClient);
            // Run through the ping/pong cycle a few times
            setTimeout(cb, 20 * heartbeatIntervalMs);
          },
          cb => {
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
          transportServer.stop();
          done();
        }
      );
    });
  });

  describe("If the heartbeat is disabled", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Server transport events

    it("should emit correctly on the transport server", done => {
      let transportServer;
      let wsClient;
      let listener;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              heartbeatIntervalMs: 0
            });
            transportServer.start();
            transportServer.once("start", cb);
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },
          cb => {
            listener = createServerListener(transportServer);
            // Run through the ping/pong cycle a few times
            setTimeout(cb, 20 * heartbeatIntervalMs);
          },
          cb => {
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(0);
            cb();
          }
        ],
        () => {
          // Clean up
          transportServer.stop();
          done();
        }
      );
    });

    // Client events

    it("should emit nothing on the ws client", done => {
      let transportServer;
      let wsClient;
      let cListener;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              heartbeatIntervalMs: 0
            });
            transportServer.start();
            transportServer.once("start", cb);
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },

          cb => {
            cListener = createWsClientListener(wsClient);
            // Run through the ping/pong cycle a few times
            setTimeout(cb, 20 * heartbeatIntervalMs);
          },
          cb => {
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
          transportServer.stop();
          done();
        }
      );
    });
  });
});

describe("Key ws configuration options", () => {
  describe("The path option", () => {
    it("if specified, should make transport accessible only on specified path", done => {
      let transportServer;
      let wsClient;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port,
              path: "/somepath"
            });
            transportServer.once("start", cb);
            transportServer.start();
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}/somepath`);
            wsClient.once("open", cb);
          },
          cb => {
            // Try to connect another client to a different path
            const wsClient2 = new WebSocket(`ws://localhost:${port}/otherpath`);
            wsClient2.once("error", err => {
              expect(err.message).toBe("Unexpected server response: 400");
              cb();
            });
          }
        ],
        () => {
          // Clean up
          transportServer.stop();
          done();
        }
      );
    });

    it("if not specified, should make transport accessible any path", done => {
      let transportServer;
      let wsClient;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              port
            });
            transportServer.once("start", cb);
            transportServer.start();
          },
          cb => {
            // Connect a ws client
            wsClient = new WebSocket(`ws://localhost:${port}/somepath`);
            wsClient.once("open", cb);
          },
          cb => {
            // Connect another client to a different path
            const wsClient2 = new WebSocket(`ws://localhost:${port}/otherpath`);
            wsClient2.once("open", cb);
          }
        ],
        () => {
          // Clean up
          transportServer.stop();
          done();
        }
      );
    });
  });

  describe("The server option", () => {
    it("should work as expected - external server already listening when transport starts", done => {
      let httpServer;
      let transportServer;
      let wsClient;
      let listener;
      let clientId;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a listening http server
            httpServer = http.createServer((req, res) => {
              res.writeHead(200);
              res.end("Webpage");
            });
            httpServer.listen(port, cb);
          },
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              server: httpServer
            });
            listener = createServerListener(transportServer);
            expect(transportServer.state()).toBe("stopped");
            transportServer.start();
            setTimeout(cb, EPSILON);
          },
          cb => {
            // Transport server should emit and update state appropriately
            expect(transportServer.state()).toBe("started");
            expect(listener.starting.mock.calls.length).toBe(1);
            expect(listener.starting.mock.calls[0].length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(1);
            expect(listener.start.mock.calls[0].length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(0);
            listener.mockClear();
            cb();
          },
          cb => {
            // Check that the webpage is available
            request(`http://localhost:${port}`, (err, res, body) => {
              expect(body).toBe("Webpage");
              cb();
            });
          },
          cb => {
            // Connect a ws client
            transportServer.once("connect", cid => {
              clientId = cid;
            });
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },
          cb => {
            // Transport server should emit and update state appropriately
            expect(transportServer.state()).toBe("started");
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(1);
            expect(listener.connect.mock.calls[0].length).toBe(1);
            expect(listener.connect.mock.calls[0][0]).toBe(clientId);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(0);
            listener.mockClear();
            cb();
          },
          cb => {
            // Send a message from server to client
            transportServer.send(clientId, "hi from server");
            wsClient.once("message", msg => {
              expect(msg).toBe("hi from server");
              cb();
            });
          },
          cb => {
            // Send a message from client to server
            wsClient.send("hi from client");
            transportServer.once("message", (cid, msg) => {
              expect(cid).toBe(clientId);
              expect(msg).toBe("hi from client");
              cb();
            });
          },
          cb => {
            // Stop the transport but not the HTTP server
            listener.mockClear();
            transportServer.stop();
            setTimeout(cb, EPSILON);
          },
          cb => {
            // Transport server should emit and update state appropriately
            expect(transportServer.state()).toBe("stopped");
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(1);
            expect(listener.stopping.mock.calls[0].length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(1);
            expect(listener.stop.mock.calls[0].length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(1);
            expect(listener.disconnect.mock.calls[0].length).toBe(2);
            expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);
            expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
            expect(listener.disconnect.mock.calls[0][1].message).toBe(
              "STOPPING: The server is stopping."
            );
            listener.mockClear();
            cb();
          },
          cb => {
            // Verify that the transport is no longer reachable
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("error", () => {
              cb();
            });
          },
          cb => {
            // Verify that the http server is still online
            request(`http://localhost:${port}`, (err, res, body) => {
              expect(body).toBe("Webpage");
              cb();
            });
          }
        ],
        () => {
          // Clean up
          httpServer.close();
          done();
        }
      );
    });
    // //////
    it("should work as expected - external server not yet listening when transport starts", done => {
      let httpServer;
      let transportServer;
      let wsClient;
      let listener;
      let clientId;
      const port = getNextPortNumber();

      async.series(
        [
          cb => {
            // Start a listening http server
            httpServer = http.createServer((req, res) => {
              res.writeHead(200);
              res.end("Webpage");
            });
            cb();
          },
          cb => {
            // Start a transport server
            transportServer = transportWsServer({
              server: httpServer
            });
            listener = createServerListener(transportServer);
            expect(transportServer.state()).toBe("stopped");
            transportServer.start();
            setTimeout(cb, EPSILON);
          },
          cb => {
            // Transport server should emit and update state appropriately
            expect(transportServer.state()).toBe("starting");
            expect(listener.starting.mock.calls.length).toBe(1);
            expect(listener.starting.mock.calls[0].length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(0);
            listener.mockClear();
            cb();
          },
          cb => {
            // Start listening
            httpServer.listen(port, cb);
          },
          cb => {
            // Transport server should emit and update state appropriately
            expect(transportServer.state()).toBe("started");
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(1);
            expect(listener.start.mock.calls[0].length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(0);
            listener.mockClear();
            cb();
          },
          cb => {
            // Check that the webpage is available
            request(`http://localhost:${port}`, (err, res, body) => {
              expect(body).toBe("Webpage");
              cb();
            });
          },
          cb => {
            // Connect a ws client
            transportServer.once("connect", cid => {
              clientId = cid;
            });
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("open", cb);
          },
          cb => {
            // Transport server should emit and update state appropriately
            expect(transportServer.state()).toBe("started");
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(1);
            expect(listener.connect.mock.calls[0].length).toBe(1);
            expect(listener.connect.mock.calls[0][0]).toBe(clientId);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(0);
            listener.mockClear();
            cb();
          },
          cb => {
            // Send a message from server to client
            transportServer.send(clientId, "hi from server");
            wsClient.once("message", msg => {
              expect(msg).toBe("hi from server");
              cb();
            });
          },
          cb => {
            // Send a message from client to server
            wsClient.send("hi from client");
            transportServer.once("message", (cid, msg) => {
              expect(cid).toBe(clientId);
              expect(msg).toBe("hi from client");
              cb();
            });
          },
          cb => {
            // Stop the transport but not the HTTP server
            listener.mockClear();
            transportServer.stop();
            setTimeout(cb, EPSILON);
          },
          cb => {
            // Transport server should emit and update state appropriately
            expect(transportServer.state()).toBe("stopped");
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(1);
            expect(listener.stopping.mock.calls[0].length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(1);
            expect(listener.stop.mock.calls[0].length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(1);
            expect(listener.disconnect.mock.calls[0].length).toBe(2);
            expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);
            expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
            expect(listener.disconnect.mock.calls[0][1].message).toBe(
              "STOPPING: The server is stopping."
            );
            listener.mockClear();
            cb();
          },
          cb => {
            // Verify that the transport is no longer reachable
            wsClient = new WebSocket(`ws://localhost:${port}`);
            wsClient.once("error", () => {
              cb();
            });
          },
          cb => {
            // Verify that the http server is still online
            request(`http://localhost:${port}`, (err, res, body) => {
              expect(body).toBe("Webpage");
              cb();
            });
          }
        ],
        () => {
          // Clean up
          httpServer.close();
          done();
        }
      );
    });
  });

  describe.skip("The noServer option", () => {
    it("should work", () => {
      const port = getNextPortNumber();
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      const wsServer = new WebSocket.Server({ noServer: true });
      const transportServer = transportWsServer({ noServer: true });
      transportServer.start();

      wsServer.on("connection", () => {
        console.log("Raw WS server got a connection");
      });

      transportServer.on("connect", () => {
        console.log("Transport WS connection");
      });

      httpServer.on("upgrade", (req, socket, head) => {
        const { pathname } = url.parse(req.url);

        if (pathname === "/foo") {
          wsServer.handleUpgrade(req, socket, head, ws => {
            wsServer.emit("connection", ws, req);
          });
        } else if (pathname === "/bar") {
          transportServer.handleUpgrade(req, socket, head);
        } else {
          socket.destroy();
        }
      });

      httpServer.listen(port, () => {
        const ws1 = new WebSocket(`http://localhost:${port}/foo`); // eslint-disable-line
        const ws2 = new WebSocket(`http://localhost:${port}/bar`); // eslint-disable-line
      });
    });
  });

  describe("The maxPayload setting, if exceeded", () => {});
});

// Library-facing API

describe("The factory function", () => {});

describe("The transport.start() function", () => {});

describe("The transport.stop() function", () => {});

describe("The transport.send() function", () => {});

describe("The transport.disconnect() function", () => {});

describe("The transport.handleUpgrade() function", () => {});

// Ws-facing event handlers

describe("The transport._processwsClientListening() function", () => {});

describe("The transport._processwsClientClose() function", () => {});

describe("The transport._processwsClientConnection() function", () => {});

describe("The transport._processWsClientMessage() function", () => {});

describe("The transport._processWsClientPong() function", () => {});

describe("The transport._processWsClientClose() function", () => {});

// Test through a few start/stop cycles

describe("The transport server should operate correctly through multiple start/stop cycles", () => {
  // With a stand-alone server
  // With an existing server - http.close() ---- note that close event only fires once all client connections are gone
  // With an existing server - transport.stop()
});
