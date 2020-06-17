import check from "check-types";
import http from "http";
import transportWsServer from "../../build/server";
import transportWsClient from "../../build/client";
import asyncUtil from "./asyncutil";

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

// Client library-facing API

describe("the client.connect() function", () => {
  describe("against a server in stand-alone mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      expect(server.state()).toBe("started");

      client.connect();
      await asyncUtil.once(client, "connect");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
    });

    // Server events

    it("should emit connect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      const sListener = createServerListener(server);

      client.connect();
      await asyncUtil.once(client, "connect");

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
      await asyncUtil.once(server, "stop");
    });
  });

  describe("against a server in external server mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      expect(server.state()).toBe("started");

      client.connect();
      await asyncUtil.once(client, "connect");

      expect(server.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Server events

    it("should emit connect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      const sListener = createServerListener(server);

      client.connect();
      await asyncUtil.once(client, "connect");

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
      await asyncUtil.once(httpServer, "close");
    });
  });

  describe("against a server in noServer mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      expect(server.state()).toBe("started");

      client.connect();
      await asyncUtil.once(client, "connect");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Server events

    it("should emit connect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);

      const sListener = createServerListener(server);

      client.connect();
      await asyncUtil.once(client, "connect");

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
      await asyncUtil.once(server, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });
});

describe("the client.disconnect() function", () => {
  describe("against a server in stand-alone mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(server.state()).toBe("started");

      client.disconnect();
      await asyncUtil.once(server, "disconnect");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
    });

    // Server events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const sListener = createServerListener(server);

      client.disconnect();
      await asyncUtil.once(server, "disconnect");

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
        "FAILURE: The WebSocket closed."
      );

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
    });
  });

  describe("against a server in external server mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(server.state()).toBe("started");

      client.disconnect();
      await asyncUtil.once(server, "disconnect");

      expect(server.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Server events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const sListener = createServerListener(server);

      client.disconnect();
      await asyncUtil.once(server, "disconnect");

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
        "FAILURE: The WebSocket closed."
      );

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });

  describe("against a server in noServer mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(server.state()).toBe("started");

      client.disconnect();
      await asyncUtil.once(server, "disconnect");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Server events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const sListener = createServerListener(server);

      client.disconnect();
      await asyncUtil.once(server, "disconnect");

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
        "FAILURE: The WebSocket closed."
      );

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });
});

describe("the client.send() function", () => {
  describe("against a server in stand-alone mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(server.state()).toBe("started");

      client.send("msg");
      await asyncUtil.once(server, "message");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
    });

    // Server events

    it("should emit message", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const sListener = createServerListener(server);

      client.send("msg");
      await asyncUtil.once(server, "message");

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
      await asyncUtil.once(server, "stop");
    });
  });

  describe("against a server in external server mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(server.state()).toBe("started");

      client.send("msg");
      await asyncUtil.once(server, "message");

      expect(server.state()).toBe("started");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Server events

    it("should emit message", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const sListener = createServerListener(server);

      client.send("msg");
      await asyncUtil.once(server, "message");

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
      await asyncUtil.once(httpServer, "close");
    });
  });

  describe("against a server in noServer mode", () => {
    // Server state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(server.state()).toBe("started");

      client.send("msg");
      await asyncUtil.once(server, "message");

      expect(server.state()).toBe("started");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Server events

    it("should emit message", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Create a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const sListener = createServerListener(server);

      client.send("msg");
      await asyncUtil.once(server, "message");

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
      await asyncUtil.once(server, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });
});

// Server library-facing API

describe("the server.start() function", () => {
  // N/A - No client impact
});

describe("the server.stop() function", () => {
  describe("on a server in stand-alone mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      server.stop();
      await asyncUtil.once(client, "disconnect");

      expect(client.state()).toBe("disconnected");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      server.stop();
      await asyncUtil.once(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly."
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
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      server.stop();
      await asyncUtil.once(client, "disconnect");

      expect(client.state()).toBe("disconnected");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      server.stop();
      await asyncUtil.once(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly."
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });

  describe("on a server in noServer mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      server.stop();
      await asyncUtil.once(client, "disconnect");

      expect(client.state()).toBe("disconnected");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      server.stop();
      await asyncUtil.once(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly."
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });
});

describe("the httpServer.close() function", () => {
  describe("on a server in external server mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      httpServer.close();
      await asyncUtil.once(client, "disconnect");

      expect(client.state()).toBe("disconnected");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      httpServer.close();
      await asyncUtil.once(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly."
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
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      httpServer.close(); // Will not emit close due to outstanding ws connection
      await asyncUtil.setTimeout(500);

      expect(client.state()).toBe("connected");

      server.stop();
      await asyncUtil.once(client, "disconnect");

      expect(client.state()).toBe("disconnected");
    });

    // Client events

    it("should emit nothing until subsequent call to transport.stop()", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      httpServer.close(); // Will not emit close due to outstanding ws connection
      await asyncUtil.setTimeout(500);

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);

      server.stop();
      await asyncUtil.once(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly."
      );

      expect(listener.message.mock.calls.length).toBe(0);
    });
  });
});

describe("the server.send() function", () => {
  describe("on a server in stand-alone mode", () => {
    // Client state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      server.send(cid, "msg");
      await asyncUtil.once(client, "message");

      expect(client.state()).toBe("connected");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
    });

    // Client events

    it("should emit should emit message", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      server.send(cid, "msg");
      await asyncUtil.once(client, "message");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(1);
      expect(listener.message.mock.calls[0][0]).toBe("msg");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
    });
  });

  describe("on a server in external server mode", () => {
    // Client state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      server.send(cid, "msg");
      await asyncUtil.once(client, "message");

      expect(client.state()).toBe("connected");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Client events

    it("should emit should emit message", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      server.send(cid, "msg");
      await asyncUtil.once(client, "message");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(1);
      expect(listener.message.mock.calls[0][0]).toBe("msg");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });

  describe("on a server in noServer mode", () => {
    // Client state

    it("should not change the state", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      server.send(cid, "msg");
      await asyncUtil.once(client, "message");

      expect(client.state()).toBe("connected");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Client events

    it("should emit message", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      server.send(cid, "msg");
      await asyncUtil.once(client, "message");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(1);
      expect(listener.message.mock.calls[0][0]).toBe("msg");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });
});

describe("the server.disconnect() function", () => {
  describe("on a server in stand-alone mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      server.disconnect(cid);
      await asyncUtil.once(client, "disconnect");

      expect(client.state()).toBe("disconnected");

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start a transport server
      const server = transportWsServer({ port });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      server.disconnect(cid);
      await asyncUtil.once(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly."
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      server.stop();
      await asyncUtil.once(server, "stop");
    });
  });

  describe("on a server in external server mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      server.disconnect(cid);
      await asyncUtil.once(client, "disconnect");

      expect(client.state()).toBe("disconnected");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ server: httpServer });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      server.disconnect(cid);
      await asyncUtil.once(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly."
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });

  describe("on a server in noServer mode", () => {
    // Client state

    it("should change state to disconnected", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      expect(client.state()).toBe("connected");

      server.disconnect(cid);
      await asyncUtil.once(client, "disconnect");

      expect(client.state()).toBe("disconnected");

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });

    // Client events

    it("should emit disconnect", async () => {
      const port = getNextPortNumber();

      // Start an http server
      const httpServer = http.createServer(() => {});
      httpServer.listen(port);
      await asyncUtil.once(httpServer, "listening");

      // Start a transport server
      const server = transportWsServer({ noServer: true });
      let cid;
      server.on("connect", c => {
        cid = c;
      });
      server.start();
      await asyncUtil.once(server, "start");

      // Route WebSocket upgrade requests
      httpServer.on("upgrade", (req, socket, head) => {
        server.handleUpgrade(req, socket, head);
      });

      // Connect a client
      const client = transportWsClient(`ws://localhost:${port}`);
      client.connect();
      await asyncUtil.once(client, "connect");

      const listener = createClientListener(client);

      server.disconnect(cid);
      await asyncUtil.once(client, "disconnect");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly."
      );
      expect(listener.message.mock.calls.length).toBe(0);

      // Clean up
      httpServer.close();
      await asyncUtil.once(httpServer, "close");
    });
  });
});

describe("the server.handleUpgrade() function (noServer only)", () => {
  // Tested above in noServer cases
});
