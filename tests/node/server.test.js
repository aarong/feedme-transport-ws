import WebSocket from "ws";
import http from "http";
import request from "request";
import check from "check-types";
import transportWsServer from "../../build/server";
import asyncUtil from "./asyncutil";
import serverConfig from "../../src/server.config";

/*

Test the transport server against a raw ws client. Allows testing things you
can't via the transport server, like heartbeat failure.

Check:

  - Errors and return values
  - State functions:  transport.state()
  - Client transport events
  - WS server events

Does not test argument validitation (done in unit tests) or that return
values are empty (only state() returns a value and it's checked everywhere).

Can not use Jest fake timers, as they do not result in communications being sent
through the actual WebSocket. Instead, uses real timers configured to time out
quickly.

With real timers, if the transport does setTimeout() for X ms, you can not
ensure that it has fired by simply doing a setTimeout() for X ms in the tests.
The test timer needs to wait an additional few milliseconds to ensure that the
tranport timer has fired, which is configured using EPSILON.

There is latency when interacting across the WebSocket connection, so test
timers need to wait an additional period to ensure that a communcation is
complete. The length of this period is configured using LATENCY, which needs to
be set conservatively (high), otherwise tests will intermittently pass/fail.

*/

const EPSILON = 20;
const LATENCY = 50;

let nextPortNumber = 3500; // Do not interfere with other test suites
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

    // Transport server events

    it("should emit correctly on the transport server", async () => {
      let clientId;
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        heartbeatIntervalMs,
        heartbeatTimeoutMs
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client and wait for it to connect
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      transportServer.once("connect", cid => {
        clientId = cid;
      });
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      // Disable the ws client's ping listener and wait for the heartbeat to time out
      wsClient._receiver._events.ping = () => {};
      await asyncUtil.setTimeout(
        heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON
      );

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

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events

    it("should emit close on the ws client", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        heartbeatIntervalMs,
        heartbeatTimeoutMs
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client and wait for it to connect
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      // Disable the ws client's ping listener and wait for the heartbeat to time out
      wsClient._receiver._events.ping = () => {};
      await asyncUtil.setTimeout(
        heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON
      );

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0); // Disabled
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("If the heartbeat is enabled and client is eventually not responsive to pings", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Transport server events

    it("should emit correctly on the transport server", async () => {
      let clientId;
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        heartbeatIntervalMs,
        heartbeatTimeoutMs
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client and wait for it to connect
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      transportServer.once("connect", cid => {
        clientId = cid;
      });
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      // Run through the ping/pong cycle a few times
      await asyncUtil.setTimeout(5 * (heartbeatIntervalMs + LATENCY));

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Disable the ws client's ping listener and wait for the heartbeat to time out
      wsClient._receiver._events.ping = () => {};
      await asyncUtil.setTimeout(
        heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON
      );

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

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events

    it("should emit close on the ws client", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        heartbeatIntervalMs,
        heartbeatTimeoutMs
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client and wait for it to connect
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      // Run through the ping/pong cycle a few times
      await asyncUtil.setTimeout(5 * (heartbeatIntervalMs + LATENCY));

      const cListener = createWsClientListener(wsClient);

      // Disable the ws client's ping listener and wait for the heartbeat to time out
      wsClient._receiver._events.ping = () => {};
      await asyncUtil.setTimeout(
        heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON
      );

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0); // Disabled
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("If the heartbeat is enabled and ws.ping() calls back failure immediately", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Transport server events

    it("should emit correctly on the transport server", async () => {
      let clientId;
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        heartbeatIntervalMs,
        heartbeatTimeoutMs
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client and wait for it to connect
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      transportServer.once("connect", cid => {
        clientId = cid;
      });
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      // Make the call to ping() call back error by closing the connection
      // and remove the transport close listener so it doesn't know about it
      // Then wait for the server ping to time out
      transportServer._wsClients[clientId].removeAllListeners("close");
      transportServer._wsClients[clientId].close();
      await asyncUtil.setTimeout(heartbeatIntervalMs + EPSILON);

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

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events - N/A (ping failure induced by connection closure)
  });

  describe("If the heartbeat is enabled and ws.ping() calls back failure eventually", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Transport server events

    it("should emit correctly on the transport server", async () => {
      let clientId;
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        heartbeatIntervalMs,
        heartbeatTimeoutMs
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client and wait for it to connect
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      transportServer.once("connect", cid => {
        clientId = cid;
      });
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      // Run through the ping/pong cycle a few times
      await asyncUtil.setTimeout(5 * (heartbeatIntervalMs + LATENCY));

      // Make the call to ping() call back error by closing the connection
      // and remove the transport close listener so it doesn't know about it
      // Then wait for the server ping to time out
      transportServer._wsClients[clientId].removeAllListeners("close");
      transportServer._wsClients[clientId].close();
      await asyncUtil.setTimeout(heartbeatIntervalMs + EPSILON);

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

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events - N/A (ping failure induced by secret connection closure)
  });

  describe("If the heartbeat is enabled and client is always responsive to pings", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Transport server events

    it("should emit correctly on the transport server", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        heartbeatIntervalMs,
        heartbeatTimeoutMs
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client and wait for it to connect
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      // Run through the ping/pong cycle a bunch of times
      await asyncUtil.setTimeout(5 * (heartbeatIntervalMs + LATENCY));

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events

    it("should emit nothing on the ws client", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        heartbeatIntervalMs,
        heartbeatTimeoutMs
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client and wait for it to connect
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      // Run through the ping/pong cycle a bunch of times
      await asyncUtil.setTimeout(5 * (heartbeatIntervalMs + LATENCY));

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length > 0).toBe(true);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("If the heartbeat is disabled", () => {
    // Errors and return values - N/A

    // State functions - N/A

    // Transport server events

    it("should emit correctly on the transport server", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        heartbeatIntervalMs: 0
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client and wait for it to connect
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      // Run through the ping/pong cycle a bunch of times
      await asyncUtil.setTimeout(5 * (heartbeatIntervalMs + LATENCY));

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Disable the ws client's ping listener and run through the ping/pong
      // cycle a few more times
      wsClient._receiver._events.ping = () => {};
      await asyncUtil.setTimeout(5 * (heartbeatIntervalMs + LATENCY));

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events

    it("should emit nothing on the ws client", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        heartbeatIntervalMs: 0
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client and wait for it to connect
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      // Run through the ping/pong cycle a few of times
      await asyncUtil.setTimeout(5 * (heartbeatIntervalMs + LATENCY));

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Disable the ws client's ping listener and run through the ping/pong
      // cycle a few more times
      wsClient._receiver._events.ping = () => {};
      await asyncUtil.setTimeout(5 * (heartbeatIntervalMs + LATENCY));

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });
});

describe("Key ws configuration options", () => {
  describe("The handleProtocols option - used internally", () => {
    it("should accept new connections with no WebSocket subprotocol", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Try to connect a client with a bad subprotocol
      const wsClient = new WebSocket(`ws://localhost:${port}`); // No protocol
      await asyncUtil.once(wsClient, "open");
      expect(wsClient.readyState).toBe(wsClient.OPEN);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    it("should accept new connections with only the 'feedme' WebSocket subprotocol", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Try to connect a client with "feedme"" subprotocol
      const wsClient = new WebSocket(`ws://localhost:${port}`, "feedme");
      await asyncUtil.once(wsClient, "open");
      expect(wsClient.readyState).toBe(wsClient.OPEN);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    it("should accept new connections with 'feedme' and other WebSocket subprotocols", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Try to connect a client with "feedne" and other subprotocols
      const wsClient = new WebSocket(
        `ws://localhost:${port}`,
        "something_else,feedme,something_else_2"
      );
      await asyncUtil.once(wsClient, "open");
      expect(wsClient.readyState).toBe(wsClient.OPEN);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    it("should terminate new connections with specified but unsupported WebSocket subprotocols", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Try to connect a client with a bad subprotocol
      const wsClient = new WebSocket(`ws://localhost:${port}`, "bad_protocol");
      await asyncUtil.once(wsClient, "error");
      expect(wsClient.readyState).toBe(wsClient.CLOSING);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });
  describe("The path option", () => {
    it("should work as expected if specified", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        path: "/somepath"
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client to the specified path
      const wsClient1 = new WebSocket(`ws://localhost:${port}/somepath`);
      await asyncUtil.once(wsClient1, "open");

      // Try to connect a ws client to the root path
      let err;
      const wsClient2 = new WebSocket(`ws://localhost:${port}`);
      wsClient2.once("error", er => {
        err = er;
      });
      await asyncUtil.once(wsClient2, "error");
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("Unexpected server response: 400");

      // Try to connect a ws client to some other path
      const wsClient3 = new WebSocket(`ws://localhost:${port}/otherpath`);
      wsClient3.once("error", er => {
        err = er;
      });
      await asyncUtil.once(wsClient3, "error");
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("Unexpected server response: 400");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    it("should work as expected if not specified", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client to the root path
      const wsClient1 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient1, "open");

      // Connect a ws client to some other path
      const wsClient2 = new WebSocket(`ws://localhost:${port}/somepath`);
      await asyncUtil.once(wsClient2, "open");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("The maxPayload setting, if exceeded", () => {
    const maxPayload = 100;

    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        maxPayload
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(transportServer.state()).toBe("started");

      // Have the client violate maxPayload
      wsClient.send("z".repeat(maxPayload + 1));
      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("started");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // Transport server events

    it("should emit correctly on the transport server", async () => {
      const port = getNextPortNumber();
      let cid;

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        maxPayload
      });
      transportServer.on("connect", c => {
        cid = c;
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      // Have the client not violate maxPayload
      wsClient.send("z".repeat(maxPayload));
      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(2);
      expect(listener.message.mock.calls[0][0]).toBe(cid);
      expect(listener.message.mock.calls[0][1]).toBe("z".repeat(maxPayload));
      expect(listener.disconnect.mock.calls.length).toBe(0);

      listener.mockClear();

      // Have the client violate maxPayload
      wsClient.send("z".repeat(maxPayload + 1));
      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: The WebSocket closed."
      );
      expect(listener.disconnect.mock.calls[0][1].wsCode).toBe(1009);
      expect(listener.disconnect.mock.calls[0][1].wsReason).toBe("");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events

    it("should emit correctly on the transport client", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({
        port,
        maxPayload
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      // Have the client not violate maxPayload
      wsClient.send("z".repeat(maxPayload));
      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Have the client violate maxPayload
      wsClient.send("z".repeat(maxPayload + 1));
      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });

  // Server and noServer options are tested as part of methods/events
});

// Library-facing API

describe("The factory function", () => {
  // Errors and return values

  it("should return a transport object", () => {
    expect(transportWsServer({ port: getNextPortNumber() })).toBeInstanceOf(
      Object
    );
  });

  // State functions

  it("should return a transport in the stopped state", () => {
    const transportServer = transportWsServer({ port: getNextPortNumber() });
    expect(transportServer.state()).toBe("stopped");
  });

  // Transport server events - N/A

  // WS client events - N/A
});

describe("The transport.start() function", () => {
  describe("may fail", () => {
    it("should throw if the state is starting", async () => {
      const port = getNextPortNumber();

      // Create a transport server and run the test
      const transportServer = transportWsServer({ port });
      transportServer.start();
      expect(transportServer.state()).toBe("starting");
      expect(() => {
        transportServer.start();
      }).toThrow(new Error("INVALID_STATE: The server is not stopped."));

      // Clean up
      await asyncUtil.once(transportServer, "start");
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    it("should throw if the state is started", async () => {
      const port = getNextPortNumber();

      // Create a transport server and run the test
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");
      expect(transportServer.state()).toBe("started");
      expect(() => {
        transportServer.start();
      }).toThrow(new Error("INVALID_STATE: The server is not stopped."));

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    it("should throw if the state is stopping", async () => {
      const port = getNextPortNumber();

      // Create a transport server and run the test
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");
      transportServer.stop();
      expect(transportServer.state()).toBe("stopping");
      expect(() => {
        transportServer.start();
      }).toThrow(new Error("INVALID_STATE: The server is not stopped."));

      // Clean up
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("may succeed", () => {
    describe("if the ws server constructor fails", () => {
      // Errors and return values - N/A

      // State functions

      it("should set the state to stopped", () => {
        const port = getNextPortNumber();

        // Create a transport server and have the ws constructor throw
        const transportServer = transportWsServer({ port });
        transportServer._options.port = false; // Bad port causes constructor failure
        transportServer.start();
        expect(transportServer.state()).toBe("stopped");
      });

      // Transport server events

      it("should asynchronously emit starting, stopping, stopped", async () => {
        const port = getNextPortNumber();

        // Create a transport server and have the ws constructor throw
        const transportServer = transportWsServer({ port });
        transportServer._options.port = false; // Bad port causes constructor failure

        const listener = createServerListener(transportServer);

        transportServer.start();

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        const eventOrder = [];
        ["starting", "stopping", "stopped"].forEach(evt => {
          eventOrder.push(evt);
        });

        await asyncUtil.nextTick();

        // Emit events asynchronously
        expect(listener.starting.mock.calls.length).toBe(1);
        expect(listener.starting.mock.calls[0].length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(1);
        expect(listener.stopping.mock.calls[0].length).toBe(1);
        expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.stopping.mock.calls[0][0].message).toBe(
          "FAILURE: Could not initialize WebSocket server."
        );
        expect(listener.stopping.mock.calls[0][0].wsError).toBeDefined();
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(1);
        expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.stop.mock.calls[0][0].message).toBe(
          "FAILURE: Could not initialize WebSocket server."
        );
        expect(listener.stop.mock.calls[0][0].wsError).toBeDefined();
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(eventOrder).toEqual(["starting", "stopping", "stopped"]);
      });

      // WS client events - N/A
    });

    describe("if the ws server constructor succeeds - stand-alone server, ws listens successfully", () => {
      // Errors and return values - N/A

      // State functions

      it("should set the state to starting and then started", async () => {
        const port = getNextPortNumber();

        // Create a transport server and have the ws constructor throw
        const transportServer = transportWsServer({ port });
        transportServer.start();
        expect(transportServer.state()).toBe("starting");

        await asyncUtil.once(transportServer, "start");
        expect(transportServer.state()).toBe("started");

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });

      // Transport server events

      it("should asynchronously emit starting, start", async () => {
        const port = getNextPortNumber();

        // Create a transport server
        const transportServer = transportWsServer({ port });

        const listener = createServerListener(transportServer);

        transportServer.start();

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        const eventOrder = [];
        ["starting", "start"].forEach(evt => {
          eventOrder.push(evt);
        });

        await asyncUtil.nextTick();

        // Emit events asynchronously
        expect(listener.starting.mock.calls.length).toBe(1);
        expect(listener.starting.mock.calls[0].length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(1);
        expect(listener.start.mock.calls[0].length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(eventOrder).toEqual(["starting", "start"]);

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });

      // WS client events - N/A
    });

    describe("if the ws server constructor succeeds - stand-alone server, ws fails to listen", () => {
      // Errors and return values - N/A

      // State functions

      it("should set the state to starting and then stopped", async () => {
        const port = getNextPortNumber();

        // Occupy the port
        const httpServer = http.createServer(() => {});
        httpServer.listen(port);

        const transportServer = transportWsServer({ port });
        transportServer.start();
        expect(transportServer.state()).toBe("starting");

        await asyncUtil.once(transportServer, "stop");

        expect(transportServer.state()).toBe("stopped");

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // Transport server events

      it("should asynchronously emit starting, stopping, stopped", async () => {
        const port = getNextPortNumber();

        // Occupy the port
        const httpServer = http.createServer(() => {});
        httpServer.listen(port);

        const transportServer = transportWsServer({ port });

        const listener = createServerListener(transportServer);

        transportServer.start();

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        const eventOrder = [];
        ["starting", "stopping", "stopped"].forEach(evt => {
          eventOrder.push(evt);
        });

        await asyncUtil.once(transportServer, "stop");

        // Emit events asynchronously
        expect(listener.starting.mock.calls.length).toBe(1);
        expect(listener.starting.mock.calls[0].length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(1);
        expect(listener.stopping.mock.calls[0].length).toBe(1);
        expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.stopping.mock.calls[0][0].message).toBe(
          "FAILURE: Failed to listen for connections."
        );
        expect(typeof listener.stopping.mock.calls[0][0].wsError).toBe(
          "object"
        ); // Apparently not instance of Error/Object
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(1);
        expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.stop.mock.calls[0][0].message).toBe(
          "FAILURE: Failed to listen for connections."
        );
        expect(typeof listener.stop.mock.calls[0][0].wsError).toBe("object"); // Apparently not instance of Error/Object
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(eventOrder).toEqual(["starting", "stopping", "stopped"]);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // WS client events - N/A
    });

    describe("if the ws server constructor succeeds - external server, already listening", () => {
      // Errors and return values - N/A

      // State functions

      it("should immediately set the state to started", async () => {
        const port = getNextPortNumber();

        // Create http server and start listening
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Check that the webpage is available
        const [, body] = await asyncUtil.callback(
          request,
          `http://localhost:${port}`
        );
        expect(body).toBe("Webpage");

        // Create a transport server on the external server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        expect(transportServer.state()).toBe("started");

        // Clean up
        await asyncUtil.callback(httpServer.close.bind(httpServer));
      });

      // Transport server events

      it("should asynchronously emit starting and start", async () => {
        const port = getNextPortNumber();

        // Create http server and start listening
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Check that the webpage is available
        const [, body] = await asyncUtil.callback(
          request,
          `http://localhost:${port}`
        );
        expect(body).toBe("Webpage");

        // Create a transport server on the external server
        const transportServer = transportWsServer({
          server: httpServer
        });

        const listener = createServerListener(transportServer);

        transportServer.start();

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        const eventOrder = [];
        ["starting", "start"].forEach(evt => {
          transportServer.on(evt, () => {
            eventOrder.push(evt);
          });
        });

        await asyncUtil.nextTick();

        // Emit starting and started asynchronously
        expect(listener.starting.mock.calls.length).toBe(1);
        expect(listener.starting.mock.calls[0].length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(1);
        expect(listener.start.mock.calls[0].length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(eventOrder).toEqual(["starting", "start"]);

        // Clean up
        await asyncUtil.callback(httpServer.close.bind(httpServer));
      });

      // External http server listeners

      it("should attach listeners to the external server", async () => {
        const port = getNextPortNumber();

        // Create http server and start listening
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Create a transport server on the external server
        const transportServer = transportWsServer({
          server: httpServer
        });

        expect(httpServer.listenerCount("listening")).toBe(0);
        expect(httpServer.listenerCount("close")).toBe(0);
        expect(httpServer.listenerCount("error")).toBe(0);

        transportServer.start();

        expect(httpServer.listenerCount("listening")).toBe(2); // One for transport, one for ws
        expect(httpServer.listenerCount("close")).toBe(1);
        expect(httpServer.listenerCount("error")).toBe(2); // One for transport, one for ws

        // Clean up
        await asyncUtil.callback(httpServer.close.bind(httpServer));
      });

      // WS client events - N/A
    });

    describe("if the ws server constructor succeeds - external server, not listening yet", () => {
      // Errors and return values - N/A

      // State functions

      it("should immediately set the state to starting and then eventually started", async () => {
        const port = getNextPortNumber();

        // Create http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });

        // Create a transport server on the external server
        const transportServer = transportWsServer({
          server: httpServer
        });

        expect(transportServer.state()).toBe("stopped");

        transportServer.start();

        expect(transportServer.state()).toBe("starting");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("starting");

        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        expect(transportServer.state()).toBe("started");

        // Check that the webpage is available
        const [, body] = await asyncUtil.callback(
          request,
          `http://localhost:${port}`
        );
        expect(body).toBe("Webpage");

        // Clean up
        await asyncUtil.callback(httpServer.close.bind(httpServer));
      });

      // Transport server events

      it("should asynchronously emit starting and then eventually started", async () => {
        const port = getNextPortNumber();

        // Create http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });

        // Create a transport server on the external server
        const transportServer = transportWsServer({
          server: httpServer
        });

        const listener = createServerListener(transportServer);

        transportServer.start();

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.once(transportServer, "starting");

        // Emit starting asynchronously
        expect(listener.starting.mock.calls.length).toBe(1);
        expect(listener.starting.mock.calls[0].length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        listener.mockClear();

        await asyncUtil.setTimeout(LATENCY);

        // Emit nothing before http server starts
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        httpServer.listen(port);

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.once(httpServer, "listening");

        // Emit start once http server listening
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(1);
        expect(listener.start.mock.calls[0].length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        // Check that the webpage is available
        const [, body] = await asyncUtil.callback(
          request,
          `http://localhost:${port}`
        );
        expect(body).toBe("Webpage");

        // Clean up
        await asyncUtil.callback(httpServer.close.bind(httpServer));
      });

      // External http server listeners

      it("should attach listeners to the external server", async () => {
        // Create http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });

        // Create a transport server on the external server
        const transportServer = transportWsServer({
          server: httpServer
        });

        expect(httpServer.listenerCount("listening")).toBe(0);
        expect(httpServer.listenerCount("close")).toBe(0);
        expect(httpServer.listenerCount("error")).toBe(0);

        transportServer.start();

        expect(httpServer.listenerCount("listening")).toBe(2); // One for transport, one for ws
        expect(httpServer.listenerCount("close")).toBe(1);
        expect(httpServer.listenerCount("error")).toBe(2); // One for transport, one for ws
      });

      // WS client events - N/A
    });

    describe("if the ws server constructor succeeds - noServer mode", () => {
      // Errors and return values - N/A

      // State functions

      it("should set the state to started", () => {
        // Create a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        expect(transportServer.state()).toBe("stopped");
        transportServer.start();
        expect(transportServer.state()).toBe("started");
      });

      // Transport server events

      it("should asynchronously emit starting and then start", async () => {
        // Create a transport server
        const transportServer = transportWsServer({
          noServer: true
        });

        const listener = createServerListener(transportServer);

        transportServer.start();

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        const eventOrder = [];
        ["starting", "start"].forEach(evt => {
          transportServer.on(evt, () => {
            eventOrder.push(evt);
          });
        });

        await asyncUtil.nextTick();

        // Emit starting and start asynchronously
        expect(listener.starting.mock.calls.length).toBe(1);
        expect(listener.starting.mock.calls[0].length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(1);
        expect(listener.start.mock.calls[0].length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(eventOrder).toEqual(["starting", "start"]);
      });

      // WS client events
    });
  });
});

describe("The transport.stop() function", () => {
  describe("may fail", () => {
    it("should throw if the state is stopped", () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      expect(() => {
        transportServer.stop();
      }).toThrow(new Error("INVALID_STATE: The server is not started."));
    });

    it("should throw if the state is starting", async () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      transportServer.start();
      expect(() => {
        transportServer.stop();
      }).toThrow(new Error("INVALID_STATE: The server is not started."));

      // Clean up
      await asyncUtil.once(transportServer, "start");
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    it("should throw if the state is stopping", async () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");
      transportServer.stop();
      expect(() => {
        transportServer.stop();
      }).toThrow(new Error("INVALID_STATE: The server is not started."));

      // Clean up
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("may succeed", () => {
    describe("if running in stand-alone mode", () => {
      // Errors and return values - N/A

      // State functions

      it("should set the state to stopping and then stopped", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        expect(transportServer.state()).toBe("started");

        transportServer.stop();
        expect(transportServer.state()).toBe("stopping");

        await asyncUtil.once(transportServer, "stop");

        expect(transportServer.state()).toBe("stopped");
      });

      // Transport server events

      it("should asynchronously emit stopping and eventually stopped", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        const listener = createServerListener(transportServer);

        transportServer.stop();

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        const eventOrder = [];
        ["stopping", "stop"].forEach(evt => {
          transportServer.on(evt, () => {
            eventOrder.push(evt);
          });
        });

        await asyncUtil.once(transportServer, "stop");

        // Emit stopping and eventually stop
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(1);
        expect(listener.stopping.mock.calls[0].length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(eventOrder).toEqual(["stopping", "stop"]);
      });

      // WS client events

      it("should emit close on ws clients", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.stop();
        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(1);
        expect(cListener.close.mock.calls[0].length).toBe(2);
        expect(cListener.close.mock.calls[0][0]).toBe(1000);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(0);
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);
      });
    });

    describe("if running in external http server mode", () => {
      // Errors and return values - N/A

      // State functions

      it("should set the state to stopping and then stopped", async () => {
        const port = getNextPortNumber();

        // Create a http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        expect(transportServer.state()).toBe("started");

        transportServer.stop();
        expect(transportServer.state()).toBe("stopping");

        await asyncUtil.once(transportServer, "stop");

        expect(transportServer.state()).toBe("stopped");

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // Transport server events

      it("should asynchronously emit stopping and eventually stopped", async () => {
        const port = getNextPortNumber();

        // Create a http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        const listener = createServerListener(transportServer);

        transportServer.stop();

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        const eventOrder = [];
        ["stopping", "stop"].forEach(evt => {
          transportServer.on(evt, () => {
            eventOrder.push(evt);
          });
        });

        await asyncUtil.once(transportServer, "stop");

        // Emit stopping and eventually stop
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(1);
        expect(listener.stopping.mock.calls[0].length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(eventOrder).toEqual(["stopping", "stop"]);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // External http server listeners

      it("should remove external http server listeners", async () => {
        const port = getNextPortNumber();

        // Create a http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        expect(httpServer.listenerCount("listening")).toBe(2); // One for transport, one for ws
        expect(httpServer.listenerCount("close")).toBe(1);
        expect(httpServer.listenerCount("error")).toBe(2); // One for transport, one for ws

        transportServer.stop();

        expect(httpServer.listenerCount("listening")).toBe(0);
        expect(httpServer.listenerCount("close")).toBe(0);
        expect(httpServer.listenerCount("error")).toBe(0);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // WS client events

      it("should emit close on ws clients", async () => {
        const port = getNextPortNumber();

        // Create a http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.stop();
        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(1);
        expect(cListener.close.mock.calls[0].length).toBe(2);
        expect(cListener.close.mock.calls[0][0]).toBe(1000);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(0);
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });
    });

    describe("if running in noServer mode", () => {
      // Errors and return values - N/A

      // State functions

      it("should set the state to stopping and then stopped", async () => {
        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        expect(transportServer.state()).toBe("started");

        transportServer.stop();
        expect(transportServer.state()).toBe("stopping");

        await asyncUtil.once(transportServer, "stop");

        expect(transportServer.state()).toBe("stopped");
      });

      // Transport server events

      it("should asynchronously emit stopping and eventually stopped", async () => {
        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        const listener = createServerListener(transportServer);

        transportServer.stop();

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        const eventOrder = [];
        ["stopping", "stop"].forEach(evt => {
          transportServer.on(evt, () => {
            eventOrder.push(evt);
          });
        });

        await asyncUtil.once(transportServer, "stop");

        // Emit stopping and eventually stop
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(1);
        expect(listener.stopping.mock.calls[0].length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(eventOrder).toEqual(["stopping", "stop"]);
      });

      // WS client events

      it("should emit close on ws clients", async () => {
        const port = getNextPortNumber();

        // Create a http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route WebSocket upgrade requests
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.stop();
        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(1);
        expect(cListener.close.mock.calls[0].length).toBe(2);
        expect(cListener.close.mock.calls[0][0]).toBe(1000);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(0);
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });
    });
  });
});

describe("The transport.send() function", () => {
  describe("may fail", () => {
    it("should throw if state is stopped", () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      expect(() => {
        transportServer.send("cid", "msg");
      }).toThrow(new Error("INVALID_STATE: The server is not started."));
    });

    it("should throw if state is starting", async () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      transportServer.start();
      expect(() => {
        transportServer.send("cid", "msg");
      }).toThrow(new Error("INVALID_STATE: The server is not started."));

      // Clean up
      await asyncUtil.once(transportServer, "start");
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    it("should throw if state is stopping", async () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");
      transportServer.stop();
      expect(() => {
        transportServer.send("cid", "msg");
      }).toThrow(new Error("INVALID_STATE: The server is not started."));

      // Clean up
      await asyncUtil.once(transportServer, "stop");
    });

    it("should throw is started and client not found", async () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");
      expect(() => {
        transportServer.send("cid", "msg");
      }).toThrow(new Error("INVALID_STATE: The client is not connected."));

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("may succeed", () => {
    describe("if running in stand-alone mode - ws calls back failure", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        // Make the call to send() call back error by having the client
        // disconnect and prevent the transport server from knowing by removing
        // its ws close listener
        transportServer._wsServer.removeAllListeners("close");
        wsClient.close();
        await asyncUtil.once(wsClient, "close");

        expect(transportServer.state()).toBe("started");

        transportServer.send(clientId, "msg");

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });

      // Transport server events

      it("should asynchronously emit disconnect", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        // Make the call to send() call back error by having the client
        // disconnect and prevent the transport server from knowing by removing
        // its ws close listener
        transportServer._wsServer.removeAllListeners("close");
        wsClient.close();
        await asyncUtil.once(wsClient, "close");

        const listener = createServerListener(transportServer);

        transportServer.send(clientId, "msg");

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
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
          "FAILURE: WebSocket transmission failed."
        );

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });

      // WS client events - N/A (need to close client to get ws to throw)
    });

    describe("if running in stand-alone mode - ws calls back success", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        expect(transportServer.state()).toBe("started");

        transportServer.send(clientId, "msg");

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });

      // Transport server events

      it("should emit nothing", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const listener = createServerListener(transportServer);

        transportServer.send(clientId, "msg");

        await asyncUtil.setTimeout(LATENCY);

        // Emit nothing
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });

      // WS client events

      it("should emit message on ws client", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.send(clientId, "msg");

        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(0);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(1);
        expect(cListener.message.mock.calls[0].length).toBe(1);
        expect(cListener.message.mock.calls[0][0]).toBe("msg");
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });
    });

    describe("if running in external server mode - ws calls back failure", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        // Make the call to send() call back error by having the client
        // disconnect and prevent the transport server from knowing by removing
        // its ws close listener
        transportServer._wsServer.removeAllListeners("close");
        wsClient.close();
        await asyncUtil.once(wsClient, "close");

        expect(transportServer.state()).toBe("started");

        transportServer.send(clientId, "msg");

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // Transport server events

      it("should asynchronously emit disconnect", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        // Make the call to send() call back error by having the client
        // disconnect and prevent the transport server from knowing by removing
        // its ws close listener
        transportServer._wsServer.removeAllListeners("close");
        wsClient.close();
        await asyncUtil.once(wsClient, "close");

        const listener = createServerListener(transportServer);

        transportServer.send(clientId, "msg");

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
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
          "FAILURE: WebSocket transmission failed."
        );

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // WS client events - N/A (need to close client to get ws to throw)
    });

    describe("if running in external server mode - ws calls back success", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        expect(transportServer.state()).toBe("started");

        transportServer.send(clientId, "msg");

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // Transport server events

      it("should emit nothing on the transport", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const listener = createServerListener(transportServer);

        transportServer.send(clientId, "msg");

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // WS client events

      it("should emit message on the ws client", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.send(clientId, "msg");

        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(0);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(1);
        expect(cListener.message.mock.calls[0].length).toBe(1);
        expect(cListener.message.mock.calls[0][0]).toBe("msg");
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });
    });

    describe("if running in no server mode - ws calls back failure", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        // Make the call to send() call back error by having the client
        // disconnect and prevent the transport server from knowing by removing
        // its ws close listener
        transportServer._wsServer.removeAllListeners("close");
        wsClient.close();
        await asyncUtil.once(wsClient, "close");

        expect(transportServer.state()).toBe("started");

        transportServer.send(clientId, "msg");

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // Transport server events

      it("should asynchronously emit disconnect", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        // Make the call to send() call back error by having the client
        // disconnect and prevent the transport server from knowing by removing
        // its ws close listener
        transportServer._wsServer.removeAllListeners("close");
        wsClient.close();
        await asyncUtil.once(wsClient, "close");

        const listener = createServerListener(transportServer);

        transportServer.send(clientId, "msg");

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
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
          "FAILURE: WebSocket transmission failed."
        );

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // WS client events - N/A (need to close client to get ws to throw)
    });

    describe("if running in no server mode - ws calls back success", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        expect(transportServer.state()).toBe("started");

        transportServer.send(clientId, "msg");

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // Transport server events

      it("should emit nothing", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const listener = createServerListener(transportServer);

        transportServer.send(clientId, "msg");

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // WS client events

      it("should emit message on ws client", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.send(clientId, "msg");

        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(0);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(1);
        expect(cListener.message.mock.calls[0].length).toBe(1);
        expect(cListener.message.mock.calls[0][0]).toBe("msg");
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });
    });
  });
});

describe("The transport.disconnect() function", () => {
  describe("may fail", () => {
    it("should throw if state is stopped", () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      expect(() => {
        transportServer.disconnect("cid");
      }).toThrow(new Error("INVALID_STATE: The server is not started."));
    });

    it("should throw if state is starting", async () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      transportServer.start();
      expect(() => {
        transportServer.disconnect("cid");
      }).toThrow(new Error("INVALID_STATE: The server is not started."));

      // Clean up
      await asyncUtil.once(transportServer, "start");
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    it("should throw if state is stopping", async () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");
      transportServer.stop();
      expect(() => {
        transportServer.disconnect("cid");
      }).toThrow(new Error("INVALID_STATE: The server is not started."));

      // Clean up
      await asyncUtil.once(transportServer, "stop");
    });

    it("should throw is started and client not found", async () => {
      const port = getNextPortNumber();
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");
      expect(() => {
        transportServer.disconnect("cid");
      }).toThrow(new Error("INVALID_STATE: The client is not connected."));

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("may succeed", () => {
    describe("if running in stand-alone mode - no error", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        expect(transportServer.state()).toBe("started");

        transportServer.disconnect(clientId);

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });

      // Transport server events

      it("should asynchronously emit disconnect", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const listener = createServerListener(transportServer);

        transportServer.disconnect(clientId);

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(1);
        expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });

      // WS client events

      it("should emit ws client close", async () => {
        const port = getNextPortNumber();

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.disconnect(clientId);

        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(1);
        expect(cListener.close.mock.calls[0].length).toBe(2);
        expect(cListener.close.mock.calls[0][0]).toBe(1000);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(0);
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });
    });

    describe("if running in stand-alone mode - error", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        expect(transportServer.state()).toBe("started");

        transportServer.disconnect(clientId, err);

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });

      // Transport server events

      it("should asynchronously emit disconnect", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const listener = createServerListener(transportServer);

        transportServer.disconnect(clientId, err);

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(2);
        expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);
        expect(listener.disconnect.mock.calls[0][1]).toBe(err);

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });

      // WS client events

      it("should emit ws client close", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start a transport server
        const transportServer = transportWsServer({ port });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.disconnect(clientId, err);

        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(1);
        expect(cListener.close.mock.calls[0].length).toBe(2);
        expect(cListener.close.mock.calls[0][0]).toBe(1006);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(0);
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        transportServer.stop();
        await asyncUtil.once(transportServer, "stop");
      });
    });

    describe("if running in external server mode - no error", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        expect(transportServer.state()).toBe("started");

        transportServer.disconnect(clientId);

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // Transport server events

      it("should asynchronously emit disconnect", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const listener = createServerListener(transportServer);

        transportServer.disconnect(clientId);

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(1);
        expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // WS client events

      it("should emit ws client close", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.disconnect(clientId);

        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(1);
        expect(cListener.close.mock.calls[0].length).toBe(2);
        expect(cListener.close.mock.calls[0][0]).toBe(1000);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(0);
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });
    });

    describe("if running in external server mode - error", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        expect(transportServer.state()).toBe("started");

        transportServer.disconnect(clientId, err);

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // Transport server events

      it("should asynchronously emit disconnect", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const listener = createServerListener(transportServer);

        transportServer.disconnect(clientId, err);

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(2);
        expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);
        expect(listener.disconnect.mock.calls[0][1]).toBe(err);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // WS client events

      it("should emit ws client close", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          server: httpServer
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.disconnect(clientId, err);

        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(1);
        expect(cListener.close.mock.calls[0].length).toBe(2);
        expect(cListener.close.mock.calls[0][0]).toBe(1006);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(0);
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });
    });

    describe("if running in noServer mode - no error", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        expect(transportServer.state()).toBe("started");

        transportServer.disconnect(clientId);

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // Transport server events

      it("should asynchronously emit disconnect", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const listener = createServerListener(transportServer);

        transportServer.disconnect(clientId);

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(1);
        expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // WS client events

      it("should emit ws client close", async () => {
        const port = getNextPortNumber();

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.disconnect(clientId);

        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(1);
        expect(cListener.close.mock.calls[0].length).toBe(2);
        expect(cListener.close.mock.calls[0][0]).toBe(1000);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(0);
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });
    });

    describe("if running in noServer mode - error", () => {
      // Errors and return values - N/A

      // State functions

      it("should not change the state", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        expect(transportServer.state()).toBe("started");

        transportServer.disconnect(clientId, err);

        expect(transportServer.state()).toBe("started");

        await asyncUtil.setTimeout(LATENCY);

        expect(transportServer.state()).toBe("started");

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // Transport server events

      it("should asynchronously emit disconnect", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const listener = createServerListener(transportServer);

        transportServer.disconnect(clientId, err);

        // Emit nothing synchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.setTimeout(LATENCY);

        // Emit disconnect asynchronously
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(2);
        expect(listener.disconnect.mock.calls[0][0]).toBe(clientId);
        expect(listener.disconnect.mock.calls[0][1]).toBe(err);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });

      // WS client events

      it("should emit ws client close", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start an http server
        const httpServer = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("Webpage");
        });
        await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

        // Start a transport server
        const transportServer = transportWsServer({
          noServer: true
        });
        transportServer.start();
        await asyncUtil.once(transportServer, "start");

        // Route upgrade requests to the transport
        httpServer.on("upgrade", (req, socket, head) => {
          transportServer.handleUpgrade(req, socket, head);
        });

        // Connect a client
        const wsClient = new WebSocket(`ws://localhost:${port}`);
        let clientId;
        transportServer.once("connect", cid => {
          clientId = cid;
        });
        await asyncUtil.once(wsClient, "open");

        const cListener = createWsClientListener(wsClient);

        transportServer.disconnect(clientId, err);

        await asyncUtil.setTimeout(LATENCY);

        expect(cListener.close.mock.calls.length).toBe(1);
        expect(cListener.close.mock.calls[0].length).toBe(2);
        expect(cListener.close.mock.calls[0][0]).toBe(1006);
        expect(cListener.error.mock.calls.length).toBe(0);
        expect(cListener.message.mock.calls.length).toBe(0);
        expect(cListener.open.mock.calls.length).toBe(0);
        expect(cListener.ping.mock.calls.length).toBe(0);
        expect(cListener.pong.mock.calls.length).toBe(0);

        // Clean up
        httpServer.close();
        await asyncUtil.once(httpServer, "close");
      });
    });
  });
});

describe("The transport.handleUpgrade() function", () => {
  describe("may fail", () => {
    it("should throw in stand-alone server mode", async () => {
      const port = getNextPortNumber();
      const httpPort = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      await asyncUtil.callback(httpServer.listen.bind(httpServer), httpPort);

      // Listen for upgrade arguments
      let req;
      let socket;
      let head;
      httpServer.on("upgrade", (areq, asocket, ahead) => {
        req = areq;
        socket = asocket;
        head = ahead;
      });

      // Connect a client
      const wsClient = new WebSocket(`ws://localhost:${httpPort}`);
      await asyncUtil.once(httpServer, "upgrade");

      expect(() => {
        transportServer.handleUpgrade(req, socket, head);
      }).toThrow(
        new Error("INVALID_STATE: The transport is not in noServer mode.")
      );

      // Clean up
      wsClient.on("error", () => {}); // Destroy socket will cause uncaught error
      socket.destroy();
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    it("should throw in external server mode", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Listen for upgrade arguments
      let req;
      let socket;
      let head;
      httpServer.on("upgrade", (areq, asocket, ahead) => {
        req = areq;
        socket = asocket;
        head = ahead;
      });

      // Connect a client
      const wsClient = new WebSocket(`ws://localhost:${port}`); // eslint-disable-line no-unused-vars
      await asyncUtil.once(httpServer, "upgrade");

      expect(() => {
        transportServer.handleUpgrade(req, socket, head);
      }).toThrow(
        new Error("INVALID_STATE: The transport is not in noServer mode.")
      );

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    it("should throw if the server is stopped", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });

      // Listen for upgrade arguments
      let req;
      let socket;
      let head;
      httpServer.on("upgrade", (areq, asocket, ahead) => {
        req = areq;
        socket = asocket;
        head = ahead;
      });

      // Connect a client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(httpServer, "upgrade");

      expect(() => {
        transportServer.handleUpgrade(req, socket, head);
      }).toThrow(
        new Error("INVALID_STATE: The transport server is not started.")
      );

      // Clean up
      wsClient.on("error", () => {}); // Destroy socket will cause uncaught error
      socket.destroy();
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Can't do starting / stopping as state immediately becomes started/stopped
  });

  describe("may succeed", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Listen for upgrade arguments
      let req;
      let socket;
      let head;
      httpServer.on("upgrade", (areq, asocket, ahead) => {
        req = areq;
        socket = asocket;
        head = ahead;
      });

      // Connect a client
      const wsClient = new WebSocket(`ws://localhost:${port}`); // eslint-disable-line no-unused-vars
      await asyncUtil.once(httpServer, "upgrade");

      expect(transportServer.state()).toBe("started");

      transportServer.handleUpgrade(req, socket, head);

      expect(transportServer.state()).toBe("started");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should asynchronously emit connect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Listen for upgrade arguments
      let req;
      let socket;
      let head;
      httpServer.on("upgrade", (areq, asocket, ahead) => {
        req = areq;
        socket = asocket;
        head = ahead;
      });

      // Connect a client
      const wsClient = new WebSocket(`ws://localhost:${port}`); // eslint-disable-line no-unused-vars
      await asyncUtil.once(httpServer, "upgrade");

      const listener = createServerListener(transportServer);

      transportServer.handleUpgrade(req, socket, head);

      // Emit nothing synchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      // Emit connect asynchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events

    it("should emit open on ws client", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      await asyncUtil.callback(httpServer.listen.bind(httpServer), port);

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Listen for upgrade arguments
      let req;
      let socket;
      let head;
      httpServer.on("upgrade", (areq, asocket, ahead) => {
        req = areq;
        socket = asocket;
        head = ahead;
      });

      // Connect a client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(httpServer, "upgrade");

      const cListener = createWsClientListener(wsClient);

      transportServer.handleUpgrade(req, socket, head);

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(1);
      expect(cListener.open.mock.calls[0].length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });
});

// Ws-facing event handlers

describe("The transport._processServerListening() function", () => {
  describe("may be triggered by stand-alone ws server", () => {
    // Errors and return values - N/A

    // State functions

    it("should change the state to started", async () => {
      const port = getNextPortNumber();

      const transportServer = transportWsServer({ port });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // Transport server events

    it("should asynchronously emit start", async () => {
      const port = getNextPortNumber();

      const transportServer = transportWsServer({ port });

      transportServer.start();

      let listener;
      transportServer.once("starting", () => {
        listener = createServerListener(transportServer);
      });

      await asyncUtil.once(transportServer, "start");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events - N/A
  });

  describe("may be triggered by external http server - http server started after start()", () => {
    // Errors and return values - N/A

    // State functions

    it("should change the state to started", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      // Begin starting a tranport server
      const transportServer = transportWsServer({
        server: httpServer
      });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      await asyncUtil.once(transportServer, "starting");

      expect(transportServer.state()).toBe("starting");

      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("starting");

      httpServer.listen(port);

      await asyncUtil.once(httpServer, "listening");

      expect(transportServer.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should asynchronously emit start", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      // Begin starting a tranport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();

      await asyncUtil.nextTick(); // Move past starting event

      const listener = createServerListener(transportServer);

      httpServer.listen(port);

      await asyncUtil.once(httpServer, "listening");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events - N/A
  });

  describe("may be triggered by external http server - http server started before start() but listening not yet emitted", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      // Start a tranport server
      const transportServer = transportWsServer({
        server: httpServer
      });

      expect(transportServer.state()).toBe("stopped");

      httpServer.listen(port); // listening event not yet emitted but httpsServer.listening === true
      expect(httpServer.listening).toBe(true);
      transportServer.start();

      expect(transportServer.state()).toBe("started");

      await asyncUtil.once(httpServer, "listening");

      expect(transportServer.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should emit nothing", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      // Start a tranport server
      const transportServer = transportWsServer({
        server: httpServer
      });

      httpServer.listen(port); // listening event not yet emitted but httpsServer.listening === true
      expect(httpServer.listening).toBe(true);
      transportServer.start();

      const listener = createServerListener(transportServer);

      // The transport observes the http listening event before it emits
      // starting/start, so you can't inject a listener there
      // Simply check that starting/start are emitted once

      await asyncUtil.once(httpServer, "listening");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events - N/A
  });

  describe("may be triggered by external http server - listening polling fails immediately", () => {
    // Errors and return values - N/A

    // State functions

    it("should change the state to stopped", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a tranport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a client (otherwise http will emit close rather than the listening poll triggerin)
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(transportServer.state()).toBe("started");

      httpServer.close(); // Outstanding client prevents http close event from firing

      expect(transportServer.state()).toBe("started");

      await asyncUtil.setTimeout(serverConfig.httpPollingMs);

      expect(transportServer.state()).toBe("stopped");
    });

    // Transport server events

    it("should asynchronously emit disconnect, stopping, stop", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a tranport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a client (otherwise http will emit close rather than the listening poll triggerin)
      let cid;
      transportServer.once("connect", c => {
        cid = c;
      });
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      const eventOrder = [];
      ["disconnect", "stopping", "stop"].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      httpServer.close(); // Outstanding client prevents http close event from firing

      // Emit nothing synchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.setTimeout(serverConfig.httpPollingMs);

      // Emit disconnect, stopping, stop asynchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: The external http server stopped listening."
      );
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: The external http server stopped listening."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "stopping", "stop"]);
    });

    // WS client events

    it("should emit close on ws client", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a tranport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a client (otherwise http will emit close rather than the listening poll triggerin)
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      httpServer.close(); // Outstanding client prevents http close event from firing

      await asyncUtil.setTimeout(serverConfig.httpPollingMs);

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);
    });
  });

  describe("may be triggered by external http server - listening polling fails eventually", () => {
    // Errors and return values - N/A

    // State functions

    it("should change the state to stopped", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a tranport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a client (otherwise http will emit close rather than the listening poll triggerin)
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(transportServer.state()).toBe("started");

      await asyncUtil.setTimeout(3 * serverConfig.httpPollingMs);

      expect(transportServer.state()).toBe("started");

      httpServer.close(); // Outstanding client prevents http close event from firing

      expect(transportServer.state()).toBe("started");

      await asyncUtil.setTimeout(serverConfig.httpPollingMs);

      expect(transportServer.state()).toBe("stopped");
    });

    // Transport server events

    it("should asynchronously emit disconnect, stopping, stop", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a tranport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a client (otherwise http will emit close rather than the listening poll triggerin)
      let cid;
      transportServer.once("connect", c => {
        cid = c;
      });
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      const eventOrder = [];
      ["disconnect", "stopping", "stop"].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.setTimeout(3 * serverConfig.httpPollingMs);

      // Emit nothing until failure
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      httpServer.close(); // Outstanding client prevents http close event from firing

      // Emit nothing synchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.setTimeout(serverConfig.httpPollingMs);

      // Emit disconnect, stopping, stop asynchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: The external http server stopped listening."
      );
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: The external http server stopped listening."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "stopping", "stop"]);
    });

    // WS client events

    it("should emit close on ws client", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a tranport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a client (otherwise http will emit close rather than the listening poll triggerin)
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      await asyncUtil.setTimeout(3 * serverConfig.httpPollingMs);

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      httpServer.close(); // Outstanding client prevents http close event from firing

      await asyncUtil.setTimeout(serverConfig.httpPollingMs);

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);
    });
  });
});

describe("The transport._processServerClose() function", () => {
  describe("may be triggered by stand-alone ws server", () => {
    // Errors and return values - N/A

    // State functions

    it("should change the state to stopping and then stopped", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      transportServer._wsServer.close();

      transportServer.on("stopping", () => {
        expect(transportServer.state()).toBe("stopped"); // Valid to call start()
      });

      transportServer.on("stop", () => {
        expect(transportServer.state()).toBe("stopped");
      });

      await asyncUtil.once(transportServer, "stop");
    });

    // Transport server events

    it("should asynchronously emit stopping and then stopped", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      const listener = createServerListener(transportServer);

      transportServer._wsServer.close();

      const eventOrder = [];
      ["stopping", "stop"].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.once(transportServer, "stop");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: The server stopped unexpectedly."
      );
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: The server stopped unexpectedly."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
    });

    // WS client events - N/A
  });

  describe("may be triggered by external http server - before listening polling fails", () => {
    // Errors and return values - N/A

    // State functions

    it("should change the state to stopping and then stopped", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({ server: httpServer });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      httpServer.close();

      transportServer.on("stopping", () => {
        expect(transportServer.state()).toBe("stopping");
      });

      transportServer.on("stop", () => {
        expect(transportServer.state()).toBe("stopped");
      });

      await asyncUtil.once(transportServer, "stop");
    });

    // Transport server events

    it("should asynchronously emit stopping and then stopped", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({ server: httpServer });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      const listener = createServerListener(transportServer);

      httpServer.close();

      const eventOrder = [];
      ["stopping", "stop"].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.once(transportServer, "stop");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: The server stopped unexpectedly."
      );
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: The server stopped unexpectedly."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
    });

    // WS client events - N/A (none can be connected for http close to fire)

    // HTTP event listeners

    it("should remove http server event listeners", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({ server: httpServer });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      expect(httpServer.listenerCount("listening")).toBe(2);
      expect(httpServer.listenerCount("close")).toBe(1);
      expect(httpServer.listenerCount("error")).toBe(2);

      httpServer.close();

      const eventOrder = [];
      ["stopping", "stop"].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.once(transportServer, "stop");

      expect(httpServer.listenerCount("listening")).toBe(0);
      expect(httpServer.listenerCount("close")).toBe(0);
      expect(httpServer.listenerCount("error")).toBe(0);
    });
  });
});

describe("The transport._processServerError() function", () => {
  describe("can be emitted by ws server", () => {
    // Errors and return values - N/A

    // State functions

    it("should set the state to stopping and then stopped", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer._options.port = "junk";

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      transportServer.on("stopping", () => {
        expect(transportServer.state()).toBe("stopped"); // Valid to call start()
      });

      transportServer.on("stop", () => {
        expect(transportServer.state()).toBe("stopped");
      });

      await asyncUtil.once(transportServer, "stop");
    });

    // Transport server events

    it("should asynchronously emit stopping and then stopped", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer._options.port = "junk";

      transportServer.start();

      // Can't move past starting event alone - server becomes stopped next tick

      const listener = createServerListener(transportServer);

      const eventOrder = [];
      ["starting", "stopping", "stop"].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.once(transportServer, "stop");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: Failed to listen for connections."
      );
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: Failed to listen for connections."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "stopping", "stop"]);
    });

    // WS client events - N/A
  });

  describe("can be emitted by external http server", () => {
    // Errors and return values - N/A

    // State functions

    it("should set the state to stopping and then stopped", async () => {
      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      httpServer.listen("junk");

      expect(transportServer.state()).toBe("starting");

      transportServer.on("stopping", () => {
        expect(transportServer.state()).toBe("stopping");
      });

      transportServer.on("stop", () => {
        expect(transportServer.state()).toBe("stopped");
      });

      await asyncUtil.once(transportServer, "stop");
    });

    // Transport server events

    it("should asynchronously emit stopping and then stopped", async () => {
      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });

      transportServer.start();

      await asyncUtil.nextTick(); // Move past starting event

      const listener = createServerListener(transportServer);

      httpServer.listen("junk");

      const eventOrder = [];
      ["stopping", "stop"].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.once(transportServer, "stop");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: Failed to listen for connections."
      );
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: Failed to listen for connections."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
    });

    // WS client events - N/A

    // HTTP event listeners

    it("should remove external http listeners", async () => {
      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });

      transportServer.start();

      await asyncUtil.nextTick(); // Move past starting event

      expect(httpServer.listenerCount("listening")).toBe(2);
      expect(httpServer.listenerCount("close")).toBe(1);
      expect(httpServer.listenerCount("error")).toBe(2);

      httpServer.listen("junk");

      await asyncUtil.once(transportServer, "stop");

      expect(httpServer.listenerCount("listening")).toBe(0);
      expect(httpServer.listenerCount("close")).toBe(0);
      expect(httpServer.listenerCount("error")).toBe(0);
    });
  });
});

describe("The transport._processWsServerConnection() function", () => {
  // Heartbeat functionality is tested in the transport config options section

  describe("in stand-alone mode", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(transportServer.state()).toBe("started");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // Transport server events

    it("should asynchronously emit connect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      const listener = createServerListener(transportServer);

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events

    it("should emit ws client connect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);

      const cListener = createWsClientListener(wsClient);

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(1);
      expect(cListener.open.mock.calls[0].length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("in external http server mode", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(transportServer.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should asynchronously emit connect", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      const listener = createServerListener(transportServer);

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events

    it("should emit ws client connect", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);

      const cListener = createWsClientListener(wsClient);

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(1);
      expect(cListener.open.mock.calls[0].length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });

  describe("in noServer mode", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(transportServer.state()).toBe("started");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should asynchronously emit connect", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      const listener = createServerListener(transportServer);

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events

    it("should emit ws client connect", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);

      const cListener = createWsClientListener(wsClient);

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(1);
      expect(cListener.open.mock.calls[0].length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });
});

describe("The transport._processWsClientMessage() function", () => {
  describe("in stand-alone mode - string message", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      wsClient.send("msg");

      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("started");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // Transport server events

    it("should asynchronously emit message", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      let cid;
      transportServer.on("connect", c => {
        cid = c;
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      wsClient.send("msg");

      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(2);
      expect(listener.message.mock.calls[0][0]).toBe(cid);
      expect(listener.message.mock.calls[0][1]).toBe("msg");
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events

    it("should emit nothing on ws client", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      wsClient.send("msg");

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("in stand-alone mode - non-string message", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      wsClient.send(new Float32Array(5));

      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("started");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // Transport server events

    it("should asyncyonously emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      let cid;
      transportServer.on("connect", c => {
        cid = c;
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      wsClient.send(new Float32Array(5));

      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: Received non-string message on WebSocket connection."
      );

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events

    it("should emit close on ws client", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      wsClient.send(new Float32Array(5));

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });
  });

  describe("in external server mode - string message", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      wsClient.send("msg");

      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should asynchronously emit message", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      let cid;
      transportServer.on("connect", c => {
        cid = c;
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      wsClient.send("msg");

      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(2);
      expect(listener.message.mock.calls[0][0]).toBe(cid);
      expect(listener.message.mock.calls[0][1]).toBe("msg");
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events

    it("should emit nothing on ws client", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      wsClient.send("msg");

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });

  describe("in external server mode - non-string message", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      wsClient.send(new Float32Array(5));

      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should asyncyonously emit disconnect", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      let cid;
      transportServer.on("connect", c => {
        cid = c;
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      wsClient.send(new Float32Array(5));

      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: Received non-string message on WebSocket connection."
      );

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events

    it("should emit close on ws client", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      wsClient.send(new Float32Array(5));

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });

  describe("in noServer mode - string message", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      wsClient.send("msg");

      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("started");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should asynchronously emit message", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      let cid;
      transportServer.on("connect", c => {
        cid = c;
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      wsClient.send("msg");

      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(2);
      expect(listener.message.mock.calls[0][0]).toBe(cid);
      expect(listener.message.mock.calls[0][1]).toBe("msg");
      expect(listener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events

    it("should emit nothing on ws client", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      wsClient.send("msg");

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });

  describe("in noServer mode - non-string message", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      wsClient.send(new Float32Array(5));

      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should asyncyonously emit disconnect", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      let cid;
      transportServer.on("connect", c => {
        cid = c;
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      wsClient.send(new Float32Array(5));

      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: Received non-string message on WebSocket connection."
      );

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events

    it("should emit close on ws client", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const cListener = createWsClientListener(wsClient);

      wsClient.send(new Float32Array(5));

      await asyncUtil.setTimeout(LATENCY);

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });
});

describe("The transport._processWsClientPong() function", () => {
  // Heartbeat functionality tested in congfiguration section
});

describe("The transport._processWsClientClose() function", () => {
  describe("in stand-alone mode", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(transportServer.state()).toBe("started");

      wsClient.close(1000, "");

      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("started");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // Transport server events

    it("should asynchronously emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const transportServer = transportWsServer({ port });
      let cid;
      transportServer.on("connect", c => {
        cid = c;
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      wsClient.close(1000, "some_reason");

      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: The WebSocket closed."
      );
      expect(listener.disconnect.mock.calls[0][1].wsCode).toBe(1000);
      expect(listener.disconnect.mock.calls[0][1].wsReason).toBe("some_reason");

      // Clean up
      transportServer.stop();
      await asyncUtil.once(transportServer, "stop");
    });

    // WS client events - N/A
  });

  describe("in external server mode", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(transportServer.state()).toBe("started");

      wsClient.close(1000, "");

      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should asynchronously emit disconnect", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        server: httpServer
      });
      let cid;
      transportServer.on("connect", c => {
        cid = c;
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      wsClient.close(1000, "some_reason");

      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: The WebSocket closed."
      );
      expect(listener.disconnect.mock.calls[0][1].wsCode).toBe(1000);
      expect(listener.disconnect.mock.calls[0][1].wsReason).toBe("some_reason");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events - N/A
  });

  describe("in noServer mode", () => {
    // Errors and return values - N/A

    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      expect(transportServer.state()).toBe("started");

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      expect(transportServer.state()).toBe("started");

      wsClient.close(1000, "");

      await asyncUtil.setTimeout(LATENCY);

      expect(transportServer.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should asynchronously emit disconnect", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });
      let cid;
      transportServer.on("connect", c => {
        cid = c;
      });
      transportServer.start();
      await asyncUtil.once(transportServer, "start");

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      // Connect a ws client
      const wsClient = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient, "open");

      const listener = createServerListener(transportServer);

      wsClient.close(1000, "some_reason");

      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: The WebSocket closed."
      );
      expect(listener.disconnect.mock.calls[0][1].wsCode).toBe(1000);
      expect(listener.disconnect.mock.calls[0][1].wsReason).toBe("some_reason");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // WS client events - N/A
  });
});

describe("The transport._processWsClientError() function", () => {
  // Trivial
});

describe("The transport._handleProtocols() function", () => {
  // Tested as part of ws configuration options
});

describe("The transport should operate correctly through multiple start/stop cycles", () => {
  describe("stand-alone server - no client connected", () => {
    // Errors and return values - N/A

    // State functions

    it("should update the state appropriately", async () => {
      const port = getNextPortNumber();

      const transportServer = transportWsServer({ port });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");
    });

    // Transport server events

    it("should emit appropriately", async () => {
      const port = getNextPortNumber();

      const transportServer = transportWsServer({ port });

      const listener = createServerListener(transportServer);

      let eventOrder = [];
      ["starting", "start", "stopping", "stop"].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      await asyncUtil.once(transportServer, "stop");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      await asyncUtil.once(transportServer, "stop");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];
    });

    // Ws client events - N/A
  });

  describe("stand-alone server - client connected", () => {
    // Errors and return values - N/A

    // State functions

    it("should update the state appropriately", async () => {
      const port = getNextPortNumber();

      const transportServer = transportWsServer({ port });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      const wsClient1 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient1, "open");

      expect(transportServer.state()).toBe("started");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      await asyncUtil.once(transportServer, "start");

      expect(transportServer.state()).toBe("started");

      const wsClient2 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient2, "open");

      expect(transportServer.state()).toBe("started");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");
    });

    // Transport server events

    it("should emit appropriately", async () => {
      const port = getNextPortNumber();

      const transportServer = transportWsServer({ port });

      const listener = createServerListener(transportServer);

      let eventOrder = [];
      [
        "starting",
        "start",
        "stopping",
        "stop",
        "connect",
        "disconnect"
      ].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      const wsClient1 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient1, "open");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start", "connect"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      await asyncUtil.once(transportServer, "stop");

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
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      const wsClient2 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient2, "open");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start", "connect"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      await asyncUtil.once(transportServer, "stop");

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
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];
    });

    // Ws client events - N/A
  });

  describe("external server, not yet listening, then httpServer.close() - no client connected", () => {
    // Errors and return values - N/A

    // State functions

    it("should update the state appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      const transportServer = transportWsServer({
        server: httpServer
      });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      expect(transportServer.state()).toBe("started");

      httpServer.close();
      await asyncUtil.once(httpServer, "close");

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      expect(transportServer.state()).toBe("started");

      httpServer.close();
      await asyncUtil.once(httpServer, "close");

      expect(transportServer.state()).toBe("stopped");
    });

    // Transport server events

    it("should emit appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      const transportServer = transportWsServer({
        server: httpServer
      });

      const listener = createServerListener(transportServer);

      let eventOrder = [];
      [
        "starting",
        "start",
        "stopping",
        "stop",
        "connect",
        "disconnect"
      ].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start"]);
      listener.mockClear();
      eventOrder = [];

      httpServer.close();
      await asyncUtil.once(httpServer, "close");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: The server stopped unexpectedly."
      );
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: The server stopped unexpectedly."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start"]);
      listener.mockClear();
      eventOrder = [];

      httpServer.close();
      await asyncUtil.once(httpServer, "close");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: The server stopped unexpectedly."
      );
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: The server stopped unexpectedly."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];
    });

    // Ws client events - N/A
  });

  describe("external server, not yet listening, then httpServer.close() - client connected", () => {
    // Errors and return values - N/A

    // State functions

    it("should update the state appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      const transportServer = transportWsServer({
        server: httpServer
      });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      expect(transportServer.state()).toBe("started");

      const wsClient1 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient1, "open");

      httpServer.close();
      await asyncUtil.once(httpServer, "close");

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("starting");

      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      expect(transportServer.state()).toBe("started");

      const wsClient2 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient2, "open");

      httpServer.close();
      await asyncUtil.once(httpServer, "close");

      expect(transportServer.state()).toBe("stopped");
    });

    // Transport server events

    it("should emit appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });

      const transportServer = transportWsServer({
        server: httpServer
      });

      const listener = createServerListener(transportServer);

      let eventOrder = [];
      [
        "starting",
        "start",
        "stopping",
        "stop",
        "connect",
        "disconnect"
      ].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      const wsClient1 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient1, "open");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start", "connect"]);
      listener.mockClear();
      eventOrder = [];

      httpServer.close();
      await asyncUtil.once(httpServer, "close");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: The external http server stopped listening."
      );
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: The external http server stopped listening."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      const wsClient2 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient2, "open");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start", "connect"]);
      listener.mockClear();
      eventOrder = [];

      httpServer.close();
      await asyncUtil.once(httpServer, "close");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: The external http server stopped listening."
      );
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: The external http server stopped listening."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];
    });

    // Ws client events - N/A
  });

  describe("external server, already listening, then transport.stop() - no client connected", () => {
    // Errors and return values - N/A

    // State functions

    it("should update the state appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      const transportServer = transportWsServer({
        server: httpServer
      });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("started");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("started");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should emit appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      const transportServer = transportWsServer({
        server: httpServer
      });

      const listener = createServerListener(transportServer);

      let eventOrder = [];
      [
        "starting",
        "start",
        "stopping",
        "stop",
        "connect",
        "disconnect"
      ].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "stop");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "stop");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Ws client events - N/A
  });

  describe("external server, already listening, then transport.stop() - client connected", () => {
    // Errors and return values - N/A

    // State functions

    it("should update the state appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      const transportServer = transportWsServer({
        server: httpServer
      });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("started");

      const wsClient1 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient1, "open");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("started");

      const wsClient2 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient2, "open");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should emit appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      const transportServer = transportWsServer({
        server: httpServer
      });

      const listener = createServerListener(transportServer);

      let eventOrder = [];
      [
        "starting",
        "start",
        "stopping",
        "stop",
        "connect",
        "disconnect"
      ].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      const wsClient1 = new WebSocket(`ws://localhost:${port}`); // eslint-disable-line no-unused-vars
      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start", "connect"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "stop");

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
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      const wsClient2 = new WebSocket(`ws://localhost:${port}`); // eslint-disable-line no-unused-vars
      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start", "connect"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "stop");

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
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Ws client events - N/A
  });

  describe("noServer with transport.stop() - no client connected", () => {
    // Errors and return values - N/A

    // State functions

    it("should update the state appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("started");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("started");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should emit appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      const listener = createServerListener(transportServer);

      let eventOrder = [];
      [
        "starting",
        "start",
        "stopping",
        "stop",
        "connect",
        "disconnect"
      ].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "stop");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "stop");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Ws client events - N/A
  });

  describe("noServer server with transport.stop() - client connected", () => {
    // Errors and return values - N/A

    // State functions

    it("should update the state appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("started");

      const wsClient1 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient1, "open");

      expect(transportServer.state()).toBe("started");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");

      transportServer.start();

      expect(transportServer.state()).toBe("started");

      const wsClient2 = new WebSocket(`ws://localhost:${port}`);
      await asyncUtil.once(wsClient2, "open");

      expect(transportServer.state()).toBe("started");

      transportServer.stop();

      expect(transportServer.state()).toBe("stopping");

      await asyncUtil.once(transportServer, "stop");

      expect(transportServer.state()).toBe("stopped");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Transport server events

    it("should emit appropriately", async () => {
      const port = getNextPortNumber();

      // Create an http server
      const httpServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("Webpage");
      });
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const transportServer = transportWsServer({
        noServer: true
      });

      // Route upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        transportServer.handleUpgrade(req, socket, head);
      });

      const listener = createServerListener(transportServer);

      let eventOrder = [];
      [
        "starting",
        "start",
        "stopping",
        "stop",
        "connect",
        "disconnect"
      ].forEach(evt => {
        transportServer.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      const wsClient1 = new WebSocket(`ws://localhost:${port}`); // eslint-disable-line no-unused-vars
      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start", "connect"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "stop");

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
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "start");

      const wsClient2 = new WebSocket(`ws://localhost:${port}`); // eslint-disable-line no-unused-vars
      await asyncUtil.setTimeout(LATENCY);

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(1);
      expect(listener.start.mock.calls[0].length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "start", "connect"]);
      listener.mockClear();
      eventOrder = [];

      transportServer.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.once(transportServer, "stop");

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
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "stopping", "stop"]);
      listener.mockClear();
      eventOrder = [];

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Ws client events - N/A
  });
});
