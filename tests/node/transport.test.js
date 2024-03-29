import check from "check-types";
import http from "http";
import promisifyEvent from "promisify-event";
import { setTimeout as delay } from "node:timers/promises";
import transportWsServer from "../../build/server";
import transportWsClient from "../../build/client";

/*

Test the transport client and transport server against each another.

Test only that the invokations on the library-facing side of the client API
generate the correct events and state on the  server, and vice versa.

*/

let nextPortNumber = 4000; // Avoid conflicts across test suites
const getNextPortNumber = () => {
  nextPortNumber += 1;
  return nextPortNumber - 1;
};

const createServerListener = (transportServer) => {
  const evts = [
    "starting",
    "start",
    "stopping",
    "stop",
    "connect",
    "message",
    "disconnect",
  ];
  const l = {};
  evts.forEach((evt) => {
    l[evt] = jest.fn();
    transportServer.on(evt, l[evt]);
  });
  l.mockClear = () => {
    evts.forEach((evt) => {
      l[evt].mockClear();
    });
  };
  return l;
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

// Client library-facing API

describe("The client.connect() function", () => {
  describe("against a server in stand-alone mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      expect(server.state()).toBe("started");

      client.connect();
      await promisifyEvent(client, "connect");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
    });

    // Server events

    it("should emit connect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      const sListener = createServerListener(server);

      client.connect();
      await promisifyEvent(client, "connect");

      expect(sListener.starting.mock.calls.length).toBe(0);
      expect(sListener.start.mock.calls.length).toBe(0);
      expect(sListener.stopping.mock.calls.length).toBe(0);
      expect(sListener.stop.mock.calls.length).toBe(0);
      expect(sListener.connect.mock.calls.length).toBe(1);
      expect(sListener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(sListener.connect.mock.calls[0][0])).toBe(true);
      expect(sListener.message.mock.calls.length).toBe(0);
      expect(sListener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
    });
  });

  describe("against a server in external server mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      expect(server.state()).toBe("started");

      client.connect();
      await promisifyEvent(client, "connect");

      expect(server.state()).toBe("started");

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Server events

    it("should emit connect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      const sListener = createServerListener(server);

      client.connect();
      await promisifyEvent(client, "connect");

      expect(sListener.starting.mock.calls.length).toBe(0);
      expect(sListener.start.mock.calls.length).toBe(0);
      expect(sListener.stopping.mock.calls.length).toBe(0);
      expect(sListener.stop.mock.calls.length).toBe(0);
      expect(sListener.connect.mock.calls.length).toBe(1);
      expect(sListener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(sListener.connect.mock.calls[0][0])).toBe(true);
      expect(sListener.message.mock.calls.length).toBe(0);
      expect(sListener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });

  describe("against a server in noServer mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      expect(server.state()).toBe("started");

      client.connect();
      await promisifyEvent(client, "connect");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Server events

    it("should emit connect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      const sListener = createServerListener(server);

      client.connect();
      await promisifyEvent(client, "connect");

      expect(sListener.starting.mock.calls.length).toBe(0);
      expect(sListener.start.mock.calls.length).toBe(0);
      expect(sListener.stopping.mock.calls.length).toBe(0);
      expect(sListener.stop.mock.calls.length).toBe(0);
      expect(sListener.connect.mock.calls.length).toBe(1);
      expect(sListener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(sListener.connect.mock.calls[0][0])).toBe(true);
      expect(sListener.message.mock.calls.length).toBe(0);
      expect(sListener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });
});

describe("The client.disconnect() function", () => {
  describe("against a server in stand-alone mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(server.state()).toBe("started");

      client.disconnect();
      await promisifyEvent(server, "disconnect");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
    });

    // Server events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const sListener = createServerListener(server);

      client.disconnect();
      await promisifyEvent(server, "disconnect");

      expect(sListener.starting.mock.calls.length).toBe(0);
      expect(sListener.start.mock.calls.length).toBe(0);
      expect(sListener.stopping.mock.calls.length).toBe(0);
      expect(sListener.stop.mock.calls.length).toBe(0);
      expect(sListener.connect.mock.calls.length).toBe(0);
      expect(sListener.message.mock.calls.length).toBe(0);
      expect(sListener.disconnect.mock.calls.length).toBe(1);
      expect(sListener.disconnect.mock.calls[0].length).toBe(2);
      expect(sListener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(sListener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(sListener.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: The WebSocket closed.",
      );

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
    });
  });

  describe("against a server in external server mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(server.state()).toBe("started");

      client.disconnect();
      await promisifyEvent(server, "disconnect");

      expect(server.state()).toBe("started");

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Server events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const sListener = createServerListener(server);

      client.disconnect();
      await promisifyEvent(server, "disconnect");

      expect(sListener.starting.mock.calls.length).toBe(0);
      expect(sListener.start.mock.calls.length).toBe(0);
      expect(sListener.stopping.mock.calls.length).toBe(0);
      expect(sListener.stop.mock.calls.length).toBe(0);
      expect(sListener.connect.mock.calls.length).toBe(0);
      expect(sListener.message.mock.calls.length).toBe(0);
      expect(sListener.disconnect.mock.calls.length).toBe(1);
      expect(sListener.disconnect.mock.calls[0].length).toBe(2);
      expect(sListener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(sListener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(sListener.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: The WebSocket closed.",
      );

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });

  describe("against a server in noServer mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(server.state()).toBe("started");

      client.disconnect();
      await promisifyEvent(server, "disconnect");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Server events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const sListener = createServerListener(server);

      client.disconnect();
      await promisifyEvent(server, "disconnect");

      expect(sListener.starting.mock.calls.length).toBe(0);
      expect(sListener.start.mock.calls.length).toBe(0);
      expect(sListener.stopping.mock.calls.length).toBe(0);
      expect(sListener.stop.mock.calls.length).toBe(0);
      expect(sListener.connect.mock.calls.length).toBe(0);
      expect(sListener.message.mock.calls.length).toBe(0);
      expect(sListener.disconnect.mock.calls.length).toBe(1);
      expect(sListener.disconnect.mock.calls[0].length).toBe(2);
      expect(sListener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(sListener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(sListener.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: The WebSocket closed.",
      );

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });
});

describe("The client.send() function", () => {
  describe("against a server in stand-alone mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(server.state()).toBe("started");

      client.send("msg");
      await promisifyEvent(server, "message");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
    });

    // Server events

    it("should emit message", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const sListener = createServerListener(server);

      client.send("msg");
      await promisifyEvent(server, "message");

      expect(sListener.starting.mock.calls.length).toBe(0);
      expect(sListener.start.mock.calls.length).toBe(0);
      expect(sListener.stopping.mock.calls.length).toBe(0);
      expect(sListener.stop.mock.calls.length).toBe(0);
      expect(sListener.connect.mock.calls.length).toBe(0);
      expect(sListener.message.mock.calls.length).toBe(1);
      expect(sListener.message.mock.calls[0].length).toBe(2);
      expect(sListener.message.mock.calls[0][0]).toBe(cid);
      expect(sListener.message.mock.calls[0][1]).toBe("msg");
      expect(sListener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
    });
  });

  describe("against a server in external server mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(server.state()).toBe("started");

      client.send("msg");
      await promisifyEvent(server, "message");

      expect(server.state()).toBe("started");

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Server events

    it("should emit message", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const sListener = createServerListener(server);

      client.send("msg");
      await promisifyEvent(server, "message");

      expect(sListener.starting.mock.calls.length).toBe(0);
      expect(sListener.start.mock.calls.length).toBe(0);
      expect(sListener.stopping.mock.calls.length).toBe(0);
      expect(sListener.stop.mock.calls.length).toBe(0);
      expect(sListener.connect.mock.calls.length).toBe(0);
      expect(sListener.message.mock.calls.length).toBe(1);
      expect(sListener.message.mock.calls[0].length).toBe(2);
      expect(sListener.message.mock.calls[0][0]).toBe(cid);
      expect(sListener.message.mock.calls[0][1]).toBe("msg");
      expect(sListener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });

  describe("against a server in noServer mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(server.state()).toBe("started");

      client.send("msg");
      await promisifyEvent(server, "message");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Server events

    it("should emit message", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const sListener = createServerListener(server);

      client.send("msg");
      await promisifyEvent(server, "message");

      expect(sListener.starting.mock.calls.length).toBe(0);
      expect(sListener.start.mock.calls.length).toBe(0);
      expect(sListener.stopping.mock.calls.length).toBe(0);
      expect(sListener.stop.mock.calls.length).toBe(0);
      expect(sListener.connect.mock.calls.length).toBe(0);
      expect(sListener.message.mock.calls.length).toBe(1);
      expect(sListener.message.mock.calls[0].length).toBe(2);
      expect(sListener.message.mock.calls[0][0]).toBe(cid);
      expect(sListener.message.mock.calls[0][1]).toBe("msg");
      expect(sListener.disconnect.mock.calls.length).toBe(0);

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });
});

// Server library-facing API

describe("The server.start() function", () => {
  // N/A - No client impact
});

describe("The server.stop() function", () => {
  describe("on a server in stand-alone mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      server.stop();
      await promisifyEvent(client, "disconnect");

      expect(client.state()).toBe("disconnected");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      server.stop();
      await promisifyEvent(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.message.mock.calls.length).toBe(0);
    });
  });

  describe("on a server in external server mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      server.stop();
      await promisifyEvent(client, "disconnect");

      expect(client.state()).toBe("disconnected");

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      server.stop();
      await promisifyEvent(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });

  describe("on a server in noServer mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      server.stop();
      await promisifyEvent(client, "disconnect");

      expect(client.state()).toBe("disconnected");

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      server.stop();
      await promisifyEvent(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });
});

describe("The httpServer.close() function", () => {
  describe("on a server in external server mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      httpServer.close();
      await promisifyEvent(client, "disconnect");

      expect(client.state()).toBe("disconnected");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      httpServer.close();
      await promisifyEvent(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.message.mock.calls.length).toBe(0);
    });
  });

  describe("on a server in noServer mode", () => {
    // Client state

    it("should not change the state until subsequent call to transport.stop()", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      httpServer.close(); // Will not emit close due to outstanding ws connection
      await delay(500);

      expect(client.state()).toBe("connected");

      server.stop();
      await promisifyEvent(client, "disconnect");

      expect(client.state()).toBe("disconnected");
    });

    // Client events

    it("should emit nothing until subsequent call to transport.stop()", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      httpServer.close(); // Will not emit close due to outstanding ws connection
      await delay(500);

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);

      server.stop();
      await promisifyEvent(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );

      expect(listener.message.mock.calls.length).toBe(0);
    });
  });
});

describe("The server.send() function", () => {
  describe("on a server in stand-alone mode", () => {
    // Client state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      server.send(cid, "msg");
      await promisifyEvent(client, "message");

      expect(client.state()).toBe("connected");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
    });

    // Client events

    it("should emit should emit message", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      server.send(cid, "msg");
      await promisifyEvent(client, "message");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(1);
      expect(listener.message.mock.calls[0][0]).toBe("msg");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
    });
  });

  describe("on a server in external server mode", () => {
    // Client state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      server.send(cid, "msg");
      await promisifyEvent(client, "message");

      expect(client.state()).toBe("connected");

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Client events

    it("should emit should emit message", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      server.send(cid, "msg");
      await promisifyEvent(client, "message");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(1);
      expect(listener.message.mock.calls[0][0]).toBe("msg");

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });

  describe("on a server in noServer mode", () => {
    // Client state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      server.send(cid, "msg");
      await promisifyEvent(client, "message");

      expect(client.state()).toBe("connected");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Client events

    it("should emit message", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      server.send(cid, "msg");
      await promisifyEvent(client, "message");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(1);
      expect(listener.message.mock.calls[0][0]).toBe("msg");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });
});

describe("The server.disconnect() function", () => {
  describe("on a server in stand-alone mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      server.disconnect(cid);
      await promisifyEvent(client, "disconnect");

      expect(client.state()).toBe("disconnected");

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      server.disconnect(cid);
      await promisifyEvent(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      server.stop();
      await promisifyEvent(server, "stop");
    });
  });

  describe("on a server in external server mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      server.disconnect(cid);
      await promisifyEvent(client, "disconnect");

      expect(client.state()).toBe("disconnected");

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      server.disconnect(cid);
      await promisifyEvent(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });

  describe("on a server in noServer mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      expect(client.state()).toBe("connected");

      server.disconnect(cid);
      await promisifyEvent(client, "disconnect");

      expect(client.state()).toBe("disconnected");

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await promisifyEvent(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", (c) => {
        cid = c;
      });
      server.start();
      await promisifyEvent(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await promisifyEvent(client, "connect");

      const listener = createClientListener(client);

      server.disconnect(cid);
      await promisifyEvent(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly.",
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await promisifyEvent(httpServer, "close");
    });
  });
});

describe("The server.handleUpgrade() function (noServer only)", () => {
  // Tested above in noServer cases
});

// Misc

it("The transport should be able to exchange long messages", async () => {
  const port = getNextPortNumber();
  const msg = "z".repeat(1e8); // 100mb

  // Start a server
  const server = transportWsServer({ port });
  let cid;
  server.on("connect", (c) => {
    cid = c;
  });
  server.start();
  await promisifyEvent(server, "start");

  // Connnect a client
  const client = transportWsClient(`ws://localhost:${port}`);
  client.connect();
  await promisifyEvent(client, "connect");

  // Client-to-server message
  const sListner = createServerListener(server);
  client.send(msg);
  await promisifyEvent(server, "message");
  expect(sListner.message.mock.calls[0][1]).toBe(msg);

  // Server-to-client message
  const cListener = createClientListener(client);
  server.send(cid, msg);
  await promisifyEvent(client, "message");
  expect(cListener.message.mock.calls[0][0]).toBe(msg);

  // Clean up
  server.stop();
  await promisifyEvent(server, "stop");
});
