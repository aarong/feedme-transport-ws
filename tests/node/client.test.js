import WebSocket from "ws";
import promisifyEvent from "promisify-event";
import { setTimeout as delay } from "node:timers/promises";
import promisify from "promisify-function"; // Need to be able to run build tests in Node 6
import transportWsClient from "../../build/client";

/*

Test the transport client against a raw ws server. Allows testing things you
can't via the transport server, like heartbeat failure.

Check:

  - Errors and return values
  - State functions:  transport.state()
  - transport client events
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

const EPSILON = 50;
const LATENCY = 100;

let nextPortNumber = 3000; // Do not interfere with other test suites
const getNextPortNumber = () => {
  // Avoid server port conflicts across tests
  nextPortNumber += 1;
  return nextPortNumber - 1;
};

const createClientListener = (transportClient) => {
  const evts = ["connecting", "connect", "disconnect", "message"];
  const l = {};
  evts.forEach((evt) => {
    l[evt] = jest.fn();
    transportClient.on(evt, l[evt]);
  });
  l.mockClear = () => {
    evts.forEach((evt) => {
      l[evt].mockClear();
    });
  };
  return l;
};

const createWsServerListener = (wsServer) => {
  const evts = ["close", "connection", "error", "listening"];
  const l = {};
  evts.forEach((evt) => {
    l[evt] = jest.fn();
    wsServer.on(evt, l[evt]);
  });
  l.mockClear = () => {
    evts.forEach((evt) => {
      l[evt].mockClear();
    });
  };
  return l;
};

const createWsServerClientListener = (wsServerClient) => {
  const evts = ["close", "error", "message", "open", "ping", "pong"];
  const l = {};
  evts.forEach((evt) => {
    l[evt] = jest.fn();
    wsServerClient.on(evt, l[evt]);
  });
  l.mockClear = () => {
    evts.forEach((evt) => {
      l[evt].mockClear();
    });
  };
  return l;
};

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

    it("should return correct state through the process", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      // Disable ws server ping listener and wait for the heartbeat to timeout
      wsServerClient._receiver._events.ping = () => {};
      await delay(heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON);

      expect(transportClient.state()).toBe("disconnected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should emit correctly on the transport client", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      // Disable ws server ping listener and wait for the heartbeat to timeout
      wsServerClient._receiver._events.ping = () => {};
      await delay(heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket heartbeat failed.",
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events

    it("should emit correctly on the server", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const sListener = createWsServerListener(wsServer);
      const cListener = createWsServerClientListener(wsServerClient);

      // Disable ws server ping listener and wait for the heartbeat to timeout
      wsServerClient._receiver._events.ping = () => {};
      await delay(heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON);

      expect(sListener.close.mock.calls.length).toBe(0);
      expect(sListener.connection.mock.calls.length).toBe(0);
      expect(sListener.error.mock.calls.length).toBe(0);
      expect(sListener.listening.mock.calls.length).toBe(0);

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006); // Terminated
      expect(cListener.close.mock.calls[0][1]).toBe("");
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0); // Disabled
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });
  });

  describe("If the heartbeat is enabled and server is eventually not responsive to pings", () => {
    // Errors and return values - N/A

    // State functions

    it("should return correct state through the process", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      // Run through the ping/pong cycle a few times
      await delay(5 * (heartbeatIntervalMs + LATENCY));

      expect(transportClient.state()).toBe("connected");

      // Disable ws server ping listener and wait for the heartbeat to timeout
      wsServerClient._receiver._events.ping = () => {};
      await delay(heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON);

      expect(transportClient.state()).toBe("disconnected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should emit correctly on the transport client", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      // Run through the ping/pong cycle a few times
      await delay(5 * (heartbeatIntervalMs + LATENCY));

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);

      // Disable ws server ping listener and wait for the heartbeat to timeout
      wsServerClient._receiver._events.ping = () => {};
      await delay(heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket heartbeat failed.",
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events

    it("should emit correctly on the server", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const sListener = createWsServerListener(wsServer);
      const cListener = createWsServerClientListener(wsServerClient);

      // Run through the ping/pong cycle a few times
      await delay(5 * (heartbeatIntervalMs + LATENCY));

      expect(sListener.close.mock.calls.length).toBe(0);
      expect(sListener.connection.mock.calls.length).toBe(0);
      expect(sListener.error.mock.calls.length).toBe(0);
      expect(sListener.listening.mock.calls.length).toBe(0);

      expect(cListener.close.mock.calls.length).toBe(0);
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBeGreaterThanOrEqual(5);
      expect(cListener.pong.mock.calls.length).toBe(0);

      cListener.mockClear();

      // Disable ws server ping listener and wait for the heartbeat to timeout
      wsServerClient._receiver._events.ping = () => {};
      await delay(heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON);

      expect(sListener.close.mock.calls.length).toBe(0);
      expect(sListener.connection.mock.calls.length).toBe(0);
      expect(sListener.error.mock.calls.length).toBe(0);
      expect(sListener.listening.mock.calls.length).toBe(0);

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006); // Terminated
      expect(cListener.close.mock.calls[0][1]).toBe("");
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0); // Disabled
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });
  });

  describe("If the heartbeat is enabled and ws.ping() calls back failure immediately", () => {
    // Errors and return values - N/A

    // State functions

    it("should return correct state through the process", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      // Make the call to ping() call back error by closing the connection
      // and remove the transport close listener so it doesn't know about it
      // Then wait for the client to attempt a heartbeat
      transportClient._wsClient.removeAllListeners("close");
      transportClient._wsClient.close();
      await delay(heartbeatIntervalMs + EPSILON);

      expect(transportClient.state()).toBe("disconnected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should emit correctly on the transport client", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      // Make the call to ping() call back error by closing the connection
      // and remove the transport close listener so it doesn't know about it
      // Then wait for the client to attempt a heartbeat
      transportClient._wsClient.removeAllListeners("close");
      transportClient._wsClient.close();
      await delay(heartbeatIntervalMs + EPSILON);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket heartbeat failed.",
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events - N/A (ping callback error induced by connection closure)
  });

  describe("If the heartbeat is enabled and ws.ping() calls back failure eventually", () => {
    // Errors and return values - N/A

    // State functions

    it("should return correct state through the process", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      // Run through the ping/pong cycle a few times
      await delay(5 * (heartbeatIntervalMs + LATENCY));

      expect(transportClient.state()).toBe("connected");

      // Make the call to ping() call back error by closing the connection
      // and remove the transport close listener so it doesn't know about it
      // Then wait for the client to attempt a heartbeat
      transportClient._wsClient.removeAllListeners("close");
      transportClient._wsClient.close();
      await delay(heartbeatIntervalMs + EPSILON);

      expect(transportClient.state()).toBe("disconnected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should emit correctly on the transport client", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      // Run through the ping/pong cycle a few times
      await delay(5 * (heartbeatIntervalMs + LATENCY));

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);

      // Make the call to ping() call back error by closing the connection
      // and remove the transport close listener so it doesn't know about it
      // Then wait for the client to attempt a heartbeat
      transportClient._wsClient.removeAllListeners("close");
      transportClient._wsClient.close();
      await delay(heartbeatIntervalMs + EPSILON);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket heartbeat failed.",
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events - N/A (ping failure induced by secret connection closure)
  });

  describe("If the heartbeat is enabled and server is always responsive to pings", () => {
    // Errors and return values - N/A

    // State functions

    // it("should return correct state through the process", async () => {
    //   const port = getNextPortNumber();

    //   // Start a ws server and wait for it to start listening
    //   const wsServer = new WebSocket.Server({ port });
    //   await promisifyEvent(wsServer, "listening");

    //   // Connect a transport client and wait for it to connect
    //   const transportClient = transportWsClient(`ws://localhost:${port}`, {
    //     heartbeatIntervalMs,
    //     heartbeatTimeoutMs,
    //   });
    //   transportClient.connect();
    //   await promisifyEvent(transportClient, "connect");

    //   expect(transportClient.state()).toBe("connected");

    //   // Run through the ping/pong cycle a bunch of times
    //   await delay(10 * (heartbeatIntervalMs + LATENCY));

    //   expect(transportClient.state()).toBe("connected");

    //   // Clean up
    //   wsServer.close();
    //   await promisifyEvent(wsServer, "close");
    // });

    // transport client events

    it("should emit correctly on the transport client", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs,
        heartbeatTimeoutMs,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      // Run through the ping/pong cycle a bunch of times
      await delay(10 * (heartbeatIntervalMs + LATENCY));

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events

    // it("should emit correctly on the server", async () => {
    //   let wsServerClient;
    //   const port = getNextPortNumber();

    //   // Start a ws server and wait for it to start listening
    //   const wsServer = new WebSocket.Server({ port });
    //   wsServer.once("connection", ws => {
    //     wsServerClient = ws;
    //   });
    //   await promisifyEvent(wsServer, "listening");

    //   // Connect a transport client and wait for it to connect
    //   const transportClient = transportWsClient(`ws://localhost:${port}`, {
    //     heartbeatIntervalMs,
    //     heartbeatTimeoutMs
    //   });
    //   transportClient.connect();
    //   await promisifyEvent(transportClient, "connect");

    //   const sListener = createWsServerListener(wsServer);
    //   const cListener = createWsServerClientListener(wsServerClient);

    //   // Run through the ping/pong cycle a bunch of times
    //   await delay(10 * (heartbeatIntervalMs + LATENCY));

    //   expect(sListener.close.mock.calls.length).toBe(0);
    //   expect(sListener.connection.mock.calls.length).toBe(0);
    //   expect(sListener.error.mock.calls.length).toBe(0);
    //   expect(sListener.listening.mock.calls.length).toBe(0);

    //   expect(cListener.close.mock.calls.length).toBe(0);
    //   expect(cListener.error.mock.calls.length).toBe(0);
    //   expect(cListener.message.mock.calls.length).toBe(0);
    //   expect(cListener.open.mock.calls.length).toBe(0);
    //   expect(cListener.ping.mock.calls.length).toBeGreaterThanOrEqual(20);
    //   expect(cListener.pong.mock.calls.length).toBe(0);

    //   // Clean up
    //   wsServer.close();
    //   await promisifyEvent(wsServer, "close");
    // });
  });

  describe("If the heartbeat is disabled", () => {
    // Errors and return values - N/A

    // State functions

    it("should return correct state through the process", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs: 0,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      // Run through the ping/pong cycle a few times
      await delay(5 * (heartbeatIntervalMs + LATENCY));

      expect(transportClient.state()).toBe("connected");

      // Disable ws server ping listener and run through the ping/pong cycle a
      // few more times
      wsServerClient._receiver._events.ping = () => {};
      await delay(5 * (heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON));

      expect(transportClient.state()).toBe("connected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should emit correctly on the transport client", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs: 0,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      // Run through the ping/pong cycle a few times
      await delay(5 * (heartbeatIntervalMs + LATENCY));

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);

      // Disable ws server ping listener and run through the ping/pong cycle a
      // few more times
      wsServerClient._receiver._events.ping = () => {};
      await delay(5 * (heartbeatIntervalMs + heartbeatTimeoutMs + 2 * EPSILON));

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events

    it("should emit correctly on the server", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        heartbeatIntervalMs: 0,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const sListener = createWsServerListener(wsServer);
      const cListener = createWsServerClientListener(wsServerClient);

      // Run through the ping/pong cycle a few times
      await delay(5 * (heartbeatIntervalMs + LATENCY));

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

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });
  });
});

describe("Key ws client configuration options", () => {
  describe("The maxPayload setting, if exceeded", () => {
    const maxPayload = 100;
    // Errors and return values - N/A

    // State functions

    it("should update the state appropriately", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        maxPayload,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      // Have the server not violate max payload
      wsServerClient.send("z".repeat(maxPayload));
      await delay(LATENCY);

      expect(transportClient.state()).toBe("connected");

      // Have the server violate max payload
      wsServerClient.send("z".repeat(maxPayload + 1));
      await delay(LATENCY);

      expect(transportClient.state()).toBe("disconnected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // Transport client events

    it("should emit correctly on the transport client", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        maxPayload: 100,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      // Have the server not violate max payload
      wsServerClient.send("z".repeat(maxPayload));
      await delay(LATENCY);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(1);
      expect(listener.message.mock.calls[0][0]).toBe("z".repeat(maxPayload));

      listener.mockClear();

      // Have the server violate max payload
      wsServerClient.send("z".repeat(maxPayload + 1));
      await delay(LATENCY);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.disconnect.mock.calls[0][0].wsCode).toBe(1009); // Message too big
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events

    it("should emit close on ws server", async () => {
      let wsServerClient;
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`, {
        maxPayload: 100,
      });
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const sListener = createWsServerListener(wsServer);
      const cListener = createWsServerClientListener(wsServerClient);

      // Have the server not violate max payload
      wsServerClient.send("z".repeat(maxPayload));
      await delay(LATENCY);

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

      // Have the server violate max payload
      wsServerClient.send("z".repeat(maxPayload + 1));
      await delay(LATENCY);

      expect(sListener.close.mock.calls.length).toBe(0);
      expect(sListener.connection.mock.calls.length).toBe(0);
      expect(sListener.error.mock.calls.length).toBe(0);
      expect(sListener.listening.mock.calls.length).toBe(0);

      expect(cListener.close.mock.calls.length).toBe(1);
      expect(cListener.close.mock.calls[0].length).toBe(2);
      expect(cListener.close.mock.calls[0][0]).toBe(1006);
      expect(cListener.close.mock.calls[0][1]).toBe("");
      expect(cListener.error.mock.calls.length).toBe(0);
      expect(cListener.message.mock.calls.length).toBe(0);
      expect(cListener.open.mock.calls.length).toBe(0);
      expect(cListener.ping.mock.calls.length).toBe(0);
      expect(cListener.pong.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
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

  // transport client events - N/A

  // WS server events - N/A
});

describe("The transport.connect() function", () => {
  describe("It may fail", () => {
    it("should fail if transport is connecting", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Create a transport client and confirm failure on double-call to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      expect(() => {
        transportClient.connect();
      }).toThrow(new Error("INVALID_STATE: Already connecting or connected."));

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    it("should fail if transport is connected", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client and wait for it to connect
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(() => {
        transportClient.connect();
      }).toThrow(new Error("INVALID_STATE: Already connecting or connected."));

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });
  });

  describe("It may succeed", () => {
    describe("If ws constructor throws", () => {
      // State functions

      it("should update the state correctly", () => {
        // Provide a valid URL so the transport constructor doesn't throw,
        // but an invalid ws option to make its constructor throw
        // State should become disconnected synchronously
        const transportClient = transportWsClient("ws://localhost", {
          protocolVersion: "junk",
        });
        expect(transportClient.state()).toBe("disconnected");
        transportClient.connect();
        expect(transportClient.state()).toBe("disconnected");
      });

      // transport client events

      it("should asynchronously emit transport connecting and then disconnect", async () => {
        // Provide a valid URL so the transport constructor doesn't throw,
        // but an invalid ws option to make its constructor throw
        const transportClient = transportWsClient("ws://localhost", {
          protocolVersion: "junk",
        });

        const listener = createClientListener(transportClient);

        transportClient.connect();

        // Emit nothing synchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Track event order
        const eventOrder = [];
        ["connecting", "disconnect"].forEach((evt) => {
          transportClient.on(evt, () => {
            eventOrder.push(evt);
          });
        });

        await promisify(process.nextTick)();

        // Emit connecting and then disconnect asynchronously
        expect(listener.connecting.mock.calls.length).toBe(1);
        expect(listener.connecting.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(1);
        expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.disconnect.mock.calls[0][0].message).toBe(
          "FAILURE: Could not initialize the WebSocket client.",
        );
        expect(listener.disconnect.mock.calls[0][0].wsError).toBeInstanceOf(
          Error,
        );
        expect(listener.message.mock.calls.length).toBe(0);
        expect(eventOrder).toEqual(["connecting", "disconnect"]);
      });

      // WS server events - N/A
    });

    describe("If ws constructor succeeds - no previous ws connection", () => {
      // State functions

      it("should update the state correctly", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Create a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        expect(transportClient.state()).toBe("disconnected");

        // State should become connecting synchronously
        transportClient.connect();
        expect(transportClient.state()).toBe("connecting");

        // State should become connected later
        await delay(LATENCY);
        expect(transportClient.state()).toBe("connected");

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // transport client events

      it("should asynchronously emit transport connecting and then connect", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Begin connecting a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        const listener = createClientListener(transportClient);
        transportClient.connect();

        // Emit nothing synchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Emit connecting asynchronouly
        await promisify(process.nextTick)();
        expect(listener.connecting.mock.calls.length).toBe(1);
        expect(listener.connecting.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        listener.mockClear();

        // Emit connect later
        await delay(LATENCY);
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(1);
        expect(listener.connect.mock.calls[0].length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // WS server events

      it("should emit ws server connection", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        const sListener = createWsServerListener(wsServer);

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await delay(LATENCY);

        expect(sListener.close.mock.calls.length).toBe(0);
        expect(sListener.connection.mock.calls.length).toBe(1);
        expect(sListener.error.mock.calls.length).toBe(0);
        expect(sListener.listening.mock.calls.length).toBe(0);

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });
    });

    describe("If ws constructor succeeds - previous ws connection still closing", () => {
      // State functions

      it("should update the state correctly", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Create a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        expect(transportClient.state()).toBe("disconnected");

        // State should become connecting synchronously
        transportClient.connect();
        expect(transportClient.state()).toBe("connecting");

        // State should become connected later
        await delay(LATENCY);
        expect(transportClient.state()).toBe("connected");

        // Make the previous ws client closing
        const prevWsClient = transportClient._wsClient;
        transportClient.disconnect();
        expect(prevWsClient.readyState).toBe(prevWsClient.CLOSING);

        // State should become connecting synchronously
        transportClient.connect();
        expect(transportClient.state()).toBe("connecting");

        // State should become connected later
        await delay(LATENCY);
        expect(transportClient.state()).toBe("connected");

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // transport client events

      it("should asynchronously emit transport connecting and then connect", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Begin connecting a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        const listener = createClientListener(transportClient);

        transportClient.connect();

        // Emit nothing synchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Emit connecting asynchronouly
        await promisify(process.nextTick)();
        expect(listener.connecting.mock.calls.length).toBe(1);
        expect(listener.connecting.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        listener.mockClear();

        // Emit connect later
        await delay(LATENCY);
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(1);
        expect(listener.connect.mock.calls[0].length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        listener.mockClear();

        // Make the previous ws client closing
        const prevWsClient = transportClient._wsClient;
        transportClient.disconnect();
        expect(prevWsClient.readyState).toBe(prevWsClient.CLOSING);

        transportClient.connect();

        // Emit nothing synchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Emit disconnect and connecting asynchronouly
        await promisify(process.nextTick)();
        expect(listener.connecting.mock.calls.length).toBe(1);
        expect(listener.connecting.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        listener.mockClear();

        // Emit connect later
        await delay(LATENCY);
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(1);
        expect(listener.connect.mock.calls[0].length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // WS server events

      it("should emit ws server connection", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        const sListener = createWsServerListener(wsServer);

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await delay(LATENCY);

        expect(sListener.close.mock.calls.length).toBe(0);
        expect(sListener.connection.mock.calls.length).toBe(1);
        expect(sListener.error.mock.calls.length).toBe(0);
        expect(sListener.listening.mock.calls.length).toBe(0);
        sListener.mockClear();

        // Make the previous ws client closing
        const prevWsClient = transportClient._wsClient;
        transportClient.disconnect();
        expect(prevWsClient.readyState).toBe(prevWsClient.CLOSING);

        // Reconnect transport client
        transportClient.connect();
        await delay(LATENCY);

        expect(sListener.close.mock.calls.length).toBe(0);
        expect(sListener.connection.mock.calls.length).toBe(1);
        expect(sListener.error.mock.calls.length).toBe(0);
        expect(sListener.listening.mock.calls.length).toBe(0);

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
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
    describe("If the transport is connecting", () => {
      // State functions

      it("should update the state correctly", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Create a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();

        expect(transportClient.state()).toBe("connecting");

        transportClient.disconnect(); // ws is still connecting

        expect(transportClient.state()).toBe("disconnected");

        await delay(LATENCY); // ws has disconnected

        expect(transportClient.state()).toBe("disconnected");

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // transport client events

      it("should asynchronously emit disconnect - with err", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Create a transport client and begin connecting
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();

        await promisify(process.nextTick)(); // Move past connecting event

        const listener = createClientListener(transportClient);

        transportClient.disconnect(err);

        // Emit nothing synchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        await promisify(process.nextTick)();

        // Emit disconnect asynchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(1);
        expect(listener.disconnect.mock.calls[0][0]).toBe(err);
        expect(listener.message.mock.calls.length).toBe(0);
        listener.mockClear();

        await delay(LATENCY);

        // Emit nothing when ws actually disconnects
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      it("should asynchronously emit disconnect - no err", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Create a transport client and begin connecting
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();

        await promisify(process.nextTick)(); // Move past connecting event

        const listener = createClientListener(transportClient);

        transportClient.disconnect();

        // Emit nothing synchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        await promisify(process.nextTick)();

        // Emit disconnect asynchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        listener.mockClear();

        await delay(LATENCY);

        // Emit nothing when ws actually disconnects
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // WS server events

      it("should emit ws server connection and then close", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Create a transport client and begin connecting
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();

        let cListener;
        const sListener = createWsServerListener(wsServer);
        wsServer.once("connection", (ws) => {
          cListener = createWsServerClientListener(ws);
        });

        transportClient.disconnect();

        await delay(LATENCY);

        // Don't worry about event ordering, since server connection event
        // must fire before client close event in order to register a listener
        // on the latter

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

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });
    });

    describe("If the transport is connected", () => {
      // State functions

      it("should update the state correctly", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        expect(transportClient.state()).toBe("connected");

        transportClient.disconnect(); // ws is still disconnecting

        expect(transportClient.state()).toBe("disconnected");

        await delay(LATENCY); // ws actually disconnected

        expect(transportClient.state()).toBe("disconnected");

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // transport client events

      it("should asynchronously emit disconnect - with err", async () => {
        const port = getNextPortNumber();
        const err = new Error("SOME_ERROR");

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        const listener = createClientListener(transportClient);

        transportClient.disconnect(err); // ws is still disconnecting

        // Emit nothing synchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        await promisify(process.nextTick)();

        // Emit disconnect asynchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(1);
        expect(listener.disconnect.mock.calls[0][0]).toBe(err);
        expect(listener.message.mock.calls.length).toBe(0);
        listener.mockClear();

        await delay(LATENCY); // ws actually disconnected

        // Emit nothing when ws actually disconnects
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      it("should aynchronously emit disconnect - no err", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        const listener = createClientListener(transportClient);

        transportClient.disconnect(); // ws is still disconnecting

        // Emit nothing synchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        await promisify(process.nextTick)();

        // Emit disconnect asynchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        listener.mockClear();

        await delay(LATENCY); // ws actually disconnected

        // Emit nothign when ws actually disconnects
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // WS server events

      it("should emit ws server close", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Create client/server listeners
        let cListener;
        const sListener = createWsServerListener(wsServer);
        wsServer.once("connection", (ws) => {
          cListener = createWsServerClientListener(ws);
        });

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        cListener.mockClear();
        sListener.mockClear();

        transportClient.disconnect();

        await delay(LATENCY);

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

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
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

      it("should not change the state", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        expect(transportClient.state()).toBe("connected");

        transportClient.send("msg");

        expect(transportClient.state()).toBe("connected");

        await delay(LATENCY);

        expect(transportClient.state()).toBe("connected");

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // transport client events

      it("should emit nothing on the transport", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        const listener = createClientListener(transportClient);

        transportClient.send("msg");

        await delay(LATENCY);

        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // WS server events

      it("should emit message on ws server", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Create client/server listeners
        let cListener;
        const sListener = createWsServerListener(wsServer);
        wsServer.once("connection", (ws) => {
          cListener = createWsServerClientListener(ws);
        });

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        cListener.mockClear();
        sListener.mockClear();

        transportClient.send("msg");

        await delay(LATENCY);

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

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });
    });

    describe("If ws.send() calls back error", () => {
      // State functions

      it("should change the state to disconnected", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        // Make the call to send() call back error by closing the connection
        // and remove the transport close listener so it doesn't know about it
        transportClient._wsClient.removeAllListeners("close");
        transportClient._wsClient.close();

        expect(transportClient.state()).toBe("connected");

        transportClient.send("msg");

        expect(transportClient.state()).toBe("disconnected");

        await delay(LATENCY);

        expect(transportClient.state()).toBe("disconnected");

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // transport client events

      it("should asynchronously emit transport disconnect", async () => {
        const port = getNextPortNumber();

        // Start a ws server and wait for it to start listening
        const wsServer = new WebSocket.Server({ port });
        await promisifyEvent(wsServer, "listening");

        // Connect a transport client
        const transportClient = transportWsClient(`ws://localhost:${port}`);
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        // Make the call to send() call back error by closing the connection
        // and remove the transport close listener so it doesn't know about it
        transportClient._wsClient.removeAllListeners("close");
        transportClient._wsClient.close();

        const listener = createClientListener(transportClient);

        transportClient.send("msg");

        // Emit nothing synchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        await promisify(process.nextTick)();

        // Emit disconnect asynchronously
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(1);
        expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.disconnect.mock.calls[0][0].message).toBe(
          "FAILURE: WebSocket transmission failed.",
        );
        expect(listener.disconnect.mock.calls[0][0].wsError).toBeInstanceOf(
          Error,
        );
        expect(listener.message.mock.calls.length).toBe(0);
        listener.mockClear();

        await delay(LATENCY);

        // Emit nothing when ws actually disconnects
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);

        // Clean up
        wsServer.close();
        await promisifyEvent(wsServer, "close");
      });

      // WS server events - N/A
    });
  });
});

// Ws-facing event handlers

describe("The transport._processWsOpen() function", () => {
  // State functions

  it("should change the state to connected", async () => {
    const port = getNextPortNumber();

    // Start a ws server and wait for it to start listening
    const wsServer = new WebSocket.Server({ port });
    await promisifyEvent(wsServer, "listening");

    // Start connecting a transport client
    const transportClient = transportWsClient(`ws://localhost:${port}`);
    transportClient.connect();

    expect(transportClient.state()).toBe("connecting");

    await delay(LATENCY);

    expect(transportClient.state()).toBe("connected");

    // Clean up
    wsServer.close();
    await promisifyEvent(wsServer, "close");
  });

  // transport client events

  it("should emit connect", async () => {
    const port = getNextPortNumber();

    // Start a ws server and wait for it to start listening
    const wsServer = new WebSocket.Server({ port });
    await promisifyEvent(wsServer, "listening");

    // Start connecting a transport client
    const transportClient = transportWsClient(`ws://localhost:${port}`);
    transportClient.connect();

    await promisify(process.nextTick)(); // Get past connecting event

    const listener = createClientListener(transportClient);

    await delay(LATENCY);

    expect(listener.connect.mock.calls.length).toBe(1);
    expect(listener.connect.mock.calls[0].length).toBe(0);
    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);

    // Clean up
    wsServer.close();
    await promisifyEvent(wsServer, "close");
  });

  // WS server events

  it("should emit connection on the server", async () => {
    const port = getNextPortNumber();

    // Start a ws server and wait for it to start listening
    const wsServer = new WebSocket.Server({ port });
    await promisifyEvent(wsServer, "listening");

    // Create client/server listeners
    let cListener;
    const sListener = createWsServerListener(wsServer);
    wsServer.once("connection", (ws) => {
      cListener = createWsServerClientListener(ws);
    });

    // Start connecting a transport client
    const transportClient = transportWsClient(`ws://localhost:${port}`);
    transportClient.connect();

    sListener.mockClear();

    await delay(LATENCY);

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

    // Clean up
    wsServer.close();
    await promisifyEvent(wsServer, "close");
  });
});

describe("The transport._processWsMessage() function", () => {
  describe("If it was not a string message", () => {
    // State functions

    it("should change the state to disconnected", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.on("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      // Send a message from the server and await response
      wsServerClient.send(new Float32Array(5));

      await delay(LATENCY);

      expect(transportClient.state()).toBe("disconnected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.on("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      wsServerClient.send(new Float32Array(5));

      await delay(LATENCY);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: Received non-string message on WebSocket connection.",
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events

    it("should emit client close on the ws server", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.on("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const sListener = createWsServerListener(wsServer);
      const cListener = createWsServerClientListener(wsServerClient);

      wsServerClient.send(new Float32Array(5));

      await delay(LATENCY);

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

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });
  });

  describe("If it was a string message", () => {
    // State functions

    it("should not change the state", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.on("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      // Send a message from the server and await response
      wsServerClient.send("msg");

      await delay(LATENCY);

      expect(transportClient.state()).toBe("connected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should emit message", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.on("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      wsServerClient.send("msg");

      await delay(LATENCY);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(1);
      expect(listener.message.mock.calls[0][0]).toBe("msg");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events

    it("should emit nothing on the ws server", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.on("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const sListener = createWsServerListener(wsServer);
      const cListener = createWsServerClientListener(wsServerClient);

      wsServerClient.send("msg");

      await delay(LATENCY);

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

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });
  });
});

describe("The transport._processWsPong() function", () => {
  // Heartbeat is tested as part of configuration (above)
});

describe("The transport._processWsClose() function", () => {
  describe("If the transport state is connecting", () => {
    // State functions

    it("should eventually change the state to connected", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      transportClient.disconnect();
      transportClient.connect(); // ws still disconnecting

      expect(transportClient.state()).toBe("connecting");

      await delay(LATENCY);

      expect(transportClient.state()).toBe("connected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should eventually emit connect", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      transportClient.disconnect();
      transportClient.connect(); // ws still disconnecting

      await promisify(process.nextTick)(); // Move past disconnect/connecting events

      const listener = createClientListener(transportClient);

      await delay(LATENCY);

      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events

    it("should emit connection on the server", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      transportClient.disconnect();
      transportClient.connect(); // ws still disconnecting

      const sListener = createWsServerListener(wsServer);

      await delay(LATENCY);

      expect(sListener.close.mock.calls.length).toBe(0);
      expect(sListener.connection.mock.calls.length).toBe(1);
      expect(sListener.error.mock.calls.length).toBe(0);
      expect(sListener.listening.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });
  });

  describe("If the transport state is connected - server does wsServer.close()", () => {
    // State functions

    it("should change the state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      wsServer.close();

      await delay(LATENCY);

      expect(transportClient.state()).toBe("disconnected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      wsServer.close();

      await delay(LATENCY);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.disconnect.mock.calls[0][0].wsCode).toBe(1006);

      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events - N/A (ws server is stopping)
  });

  describe("If the transport state is connected - server does wsClient.close()", () => {
    // State functions

    it("should change the state to disconnected", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      wsServerClient.close(1000);

      await delay(LATENCY);

      expect(transportClient.state()).toBe("disconnected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      wsServerClient.close(1000);

      await delay(LATENCY);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.disconnect.mock.calls[0][0].wsCode).toBe(1000);

      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events

    it("should emit nothing on the server", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const sListener = createWsServerListener(wsServer);

      wsServerClient.close(1000);

      await delay(LATENCY);

      expect(sListener.close.mock.calls.length).toBe(0);
      expect(sListener.connection.mock.calls.length).toBe(0);
      expect(sListener.error.mock.calls.length).toBe(0);
      expect(sListener.listening.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });
  });

  describe("If the transport state is connected - server does wsClient.terminate()", () => {
    // State functions

    it("should change the state to disconnected", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      wsServerClient.terminate();

      await delay(LATENCY);

      expect(transportClient.state()).toBe("disconnected");

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // transport client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const listener = createClientListener(transportClient);

      wsServerClient.terminate();

      await delay(LATENCY);

      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.disconnect.mock.calls[0][0].wsCode).toBe(1006);

      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });

    // WS server events

    it("should emit nothing on the server", async () => {
      const port = getNextPortNumber();
      let wsServerClient;

      // Start a ws server and wait for it to start listening
      const wsServer = new WebSocket.Server({ port });
      wsServer.once("connection", (ws) => {
        wsServerClient = ws;
      });
      await promisifyEvent(wsServer, "listening");

      // Connect a transport client
      const transportClient = transportWsClient(`ws://localhost:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const sListener = createWsServerListener(wsServer);

      wsServerClient.terminate();

      await delay(LATENCY);

      expect(sListener.close.mock.calls.length).toBe(0);
      expect(sListener.connection.mock.calls.length).toBe(0);
      expect(sListener.error.mock.calls.length).toBe(0);
      expect(sListener.listening.mock.calls.length).toBe(0);

      // Clean up
      wsServer.close();
      await promisifyEvent(wsServer, "close");
    });
  });
});

describe("The transport._processWsError() function", () => {
  // Debug printing only - nothing to test
});

// Test through a few connection cycles

describe("The transport should operate correctly through multiple connection cycles", () => {
  // State functions

  it("should update the state appropriately through the cycle", async () => {
    const port = getNextPortNumber();

    // Start a ws server and wait for it to start listening
    const wsServer = new WebSocket.Server({ port });
    await promisifyEvent(wsServer, "listening");

    // Run through some connection cycles

    const transportClient = transportWsClient(`ws://localhost:${port}`);

    expect(transportClient.state()).toBe("disconnected");

    transportClient.connect();

    expect(transportClient.state()).toBe("connecting");

    await delay(LATENCY);

    expect(transportClient.state()).toBe("connected");

    transportClient.disconnect();

    await delay(LATENCY);

    expect(transportClient.state()).toBe("disconnected");

    transportClient.connect();

    expect(transportClient.state()).toBe("connecting");

    await delay(LATENCY);

    expect(transportClient.state()).toBe("connected");

    transportClient.disconnect();

    await delay(LATENCY);

    expect(transportClient.state()).toBe("disconnected");

    // Clean up
    wsServer.close();
    await promisifyEvent(wsServer, "close");
  });

  // transport client events

  it("should emit events appropriately through the cycle", async () => {
    const port = getNextPortNumber();

    // Start a ws server and wait for it to start listening
    const wsServer = new WebSocket.Server({ port });
    await promisifyEvent(wsServer, "listening");

    // Run through some connection cycles

    const transportClient = transportWsClient(`ws://localhost:${port}`);

    const listener = createClientListener(transportClient);

    transportClient.connect();

    // Emit nothing synchronously
    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);

    await promisify(process.nextTick)();

    // Emit connecting asynchronously
    expect(listener.connecting.mock.calls.length).toBe(1);
    expect(listener.connecting.mock.calls[0].length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    listener.mockClear();

    await delay(LATENCY);

    // Emit connect asynchronously
    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(1);
    expect(listener.connect.mock.calls[0].length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    listener.mockClear();

    transportClient.disconnect();

    // Emit nothing synchronously
    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);

    await promisify(process.nextTick)();

    // Emit disconnect asynchronously
    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(1);
    expect(listener.disconnect.mock.calls[0].length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    listener.mockClear();

    transportClient.connect();

    // Emit nothing synchronously
    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);

    await promisify(process.nextTick)();

    // Emit connecting asynchronously
    expect(listener.connecting.mock.calls.length).toBe(1);
    expect(listener.connecting.mock.calls[0].length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    listener.mockClear();

    await delay(LATENCY);

    // Emit connect asynchronously
    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(1);
    expect(listener.connect.mock.calls[0].length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    listener.mockClear();

    transportClient.disconnect();

    // Emit nothing synchronously
    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);

    await promisify(process.nextTick)();

    // Emit disconnect asynchronously
    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(1);
    expect(listener.disconnect.mock.calls[0].length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);

    // Clean up
    wsServer.close();
    await promisifyEvent(wsServer, "close");
  });

  // WS server events

  it("should emit server events appropriately through the cycle", async () => {
    const port = getNextPortNumber();
    let cListener;

    // Start a ws server and wait for it to start listening
    const wsServer = new WebSocket.Server({ port });
    await promisifyEvent(wsServer, "listening");

    // Run through some connection cycles

    const transportClient = transportWsClient(`ws://localhost:${port}`);

    const sListener = createWsServerListener(wsServer);

    wsServer.once("connection", (ws) => {
      cListener = createWsServerClientListener(ws);
    });

    transportClient.connect();

    await delay(LATENCY);

    // Emit connection
    expect(sListener.close.mock.calls.length).toBe(0);
    expect(sListener.connection.mock.calls.length).toBe(1);
    expect(sListener.error.mock.calls.length).toBe(0);
    expect(sListener.listening.mock.calls.length).toBe(0);
    sListener.mockClear();

    transportClient.disconnect();

    await delay(LATENCY);

    // Emit client close
    expect(cListener.close.mock.calls.length).toBe(1);
    expect(cListener.error.mock.calls.length).toBe(0);
    expect(cListener.message.mock.calls.length).toBe(0);
    expect(cListener.open.mock.calls.length).toBe(0);
    expect(cListener.ping.mock.calls.length).toBe(0);
    expect(cListener.pong.mock.calls.length).toBe(0);

    transportClient.connect();

    await delay(LATENCY);

    // Emit connection
    expect(sListener.close.mock.calls.length).toBe(0);
    expect(sListener.connection.mock.calls.length).toBe(1);
    expect(sListener.error.mock.calls.length).toBe(0);
    expect(sListener.listening.mock.calls.length).toBe(0);
    sListener.mockClear();

    transportClient.disconnect();

    await delay(LATENCY);

    // Emit client close
    expect(cListener.close.mock.calls.length).toBe(1);
    expect(cListener.error.mock.calls.length).toBe(0);
    expect(cListener.message.mock.calls.length).toBe(0);
    expect(cListener.open.mock.calls.length).toBe(0);
    expect(cListener.ping.mock.calls.length).toBe(0);
    expect(cListener.pong.mock.calls.length).toBe(0);

    // Clean up
    wsServer.close();
    await promisifyEvent(wsServer, "close");
  });
});
