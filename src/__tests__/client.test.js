import ws from "ws";
import feedmeTransportWsClient from "../client";

// Configuration for testing server
const PORT = 8080;
const URL = `http://localhost:${PORT}`;

/*

Testing strategy:

For all methods:
- Test all errors thrown
- Test each possible success type by branch
  - Check client event emissions
  - Check server event emissions
  - Check internal state
  - Check return value

*/

describe("The client factory function", () => {
  describe("can fail", () => {
    it("should throw on missing ws argument", () => {
      expect(() => {
        feedmeTransportWsClient();
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid ws argument."));
    });

    it("should throw on invalid ws argument", () => {
      expect(() => {
        feedmeTransportWsClient("junk");
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid ws argument."));
    });

    it("should throw on missing address argument", () => {
      expect(() => {
        feedmeTransportWsClient(ws);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid address argument."));
    });

    it("should throw on invalid address argument", () => {
      expect(() => {
        feedmeTransportWsClient(ws, 123);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid address argument."));
    });

    it("should throw on invalid protocols argument", () => {
      expect(() => {
        feedmeTransportWsClient(ws, "url", false);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid protocols argument."));
    });

    it("should throw on invalid protocols argument", () => {
      expect(() => {
        feedmeTransportWsClient(ws, "url", [false]);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid protocols argument."));
    });

    it("should throw on invalid options argument", () => {
      expect(() => {
        feedmeTransportWsClient(ws, "url", [], "junk");
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid options object."));
    });

    it("should return an object - no protocol or options", () => {
      expect(feedmeTransportWsClient(ws, "url")).toBeInstanceOf(Object);
    });
  });

  describe("can succeed", () => {
    it("should return an object - string protocol, no options", () => {
      expect(feedmeTransportWsClient(ws, URL, "protocol")).toBeInstanceOf(
        Object
      );
    });

    it("should return an object - array protocol, no options", () => {
      expect(feedmeTransportWsClient(ws, URL, ["protocol"])).toBeInstanceOf(
        Object
      );
    });

    it("should return an object - protocol and options", () => {
      expect(feedmeTransportWsClient(ws, URL, "protocol", {})).toBeInstanceOf(
        Object
      );
    });
  });
});

// /////////
describe("Server test", () => {
  it("should work", done => {
    const wsServer = new ws.Server({
      port: PORT
    });

    let c;
    wsServer.on("listening", () => {
      c = feedmeTransportWsClient(ws, URL);
      c.on("connect", () => {});
      c.on("message", msg => {
        console.log(`Client received: ${msg}`);
        c.send("ola");
      });
      c.connect();
    });

    wsServer.on("close", () => {});

    // eslint-disable-next-line
    wsServer.on("connection", socket => {
      socket.on("message", msg => {
        console.log(`Server received: ${msg}`);
        wsServer.close(() => {
          done(); // Must shut down the server to end Jest tests
        });
      });

      socket.send("hi");

      // eslint-disable-next-line
      socket.on("close", (code, reason) => {});
    });
  });
});
