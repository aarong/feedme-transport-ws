/* eslint-disable import/no-extraneous-dependencies */
import feedmeClient from "feedme-client/bundle"; // Avoid source-map-support warning
import promisifyEvent from "promisify-event";
import promisify from "util.promisify";
import promiseTimeout from "promise-timeout";

// Included using <script> tags in index.html
/* global feedmeTransportWsClient */

/*

Browser functional tests. Tests the browser client against:
  - A raw WebSocket server
  - A transport server
  - A Feedme server.

Checks:
  - Errors and return values
  - State functions - transport.state()
  - Client transport events
  - Server events (WebSocket, transport, Feedme)

Don't worry about testing invalid arguments (done in unit tests) or that return
values are empty (only state() returns a value and it's checked everywhere).

Tests fail periodicially due to connectivity issues, so they are retried several
times before considered to have truly failed. For the same reason, a new controller
client is established for each test.

*/

// Jasmine configuration
jasmine.DEFAULT_TIMEOUT_INTERVAL = 120000; // Per test - including any retries

// Test configuration
const PORT = 3000; // Port for controller Feedme API
const TARGET_URL = "ws://testinghost.com"; // Target URL for all testing servers
const BAD_URL = "ws://nothing"; // For testing failed connection attempts
const RETRY_LIMIT = 5; // Number of times to attempt each test before failing
const ATTEMPT_TIMEOUT = 30000; // Limit per individual test attempt

const createClientListener = transportClient => {
  const evts = ["connecting", "connect", "disconnect", "message"];
  const l = {};
  evts.forEach(evt => {
    l[evt] = jasmine.createSpy();
    transportClient.on(evt, l[evt]);
  });
  l.spyClear = () => {
    evts.forEach(evt => {
      l[evt].calls.reset();
    });
  };
  return l;
};

// Wrapper that retries an asynchronous test function
// Retries if the test throws (which occurs on failure) and if it times out
// after ATTEMPT_TIMEOUT (which occurs when the controller or transport
// WebSocket connection is unexpectedly lost).
const retry = test => async () => {
  let err;
  let i;
  for (i = 0; i < RETRY_LIMIT; i += 1) {
    err = null;
    try {
      await promiseTimeout(test, ATTEMPT_TIMEOUT); // eslint-disable-line no-await-in-loop
    } catch (e) {
      err = e;
    }
    if (!err) {
      return; // Success
    }
  }
  err.message += ` (Retry # ${i})`;
  throw err; // All attempts failed - throw the final error
};

// Create a and connect Feedme server controller client
const connectController = async () => {
  const fmController = feedmeClient({
    transport: feedmeTransportWsClient(`${TARGET_URL}:${PORT}`),
    connectRetryMs: -1 // Do not retry connection attempts here - entire test is retried
  });
  fmController.connect();
  await promisifyEvent(fmController, "connect");
  return fmController;
};

// Disconnect a Feedme server controller client
const disconnectController = async fmClient => {
  fmClient.disconnect();
  await promisifyEvent(fmClient, "disconnect");
};

describe("The factory function", () => {
  // Errors and return values

  it("should return an object", () => {
    expect(feedmeTransportWsClient(TARGET_URL)).toEqual(jasmine.any(Object));
  });

  // State functions

  it("should initialize disconnected", () => {
    const transportClient = feedmeTransportWsClient(TARGET_URL);
    expect(transportClient.state()).toBe("disconnected");
  });

  // Client events - N/A

  // Server events - N/A
});

// Tests against raw WebSocket server

describe("The transport.connect() function", () => {
  describe("may fail", () => {
    it(
      "should throw if the transport is connecting",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Make transport client connecting
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        expect(transportClient.state()).toBe("connecting");
        expect(() => {
          transportClient.connect();
        }).toThrow(
          new Error("INVALID_STATE: Already connecting or connected.")
        );

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    it(
      "should throw if the transport is connected",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Make transport client connecting
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        expect(transportClient.state()).toBe("connected");
        expect(() => {
          transportClient.connect();
        }).toThrow(
          new Error("INVALID_STATE: Already connecting or connected.")
        );

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );
  });

  describe("may succeed", () => {
    describe("WebSocket initializes successfully", () => {
      // State functions

      it(
        "should update the state appropriately",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          expect(transportClient.state()).toBe("connecting");

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Client events

      it(
        "should asynchronously emit connecting",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          const clientListener = createClientListener(transportClient);

          transportClient.connect();

          // Emit nothing synchronously
          expect(clientListener.connecting.calls.count()).toBe(0);
          expect(clientListener.connect.calls.count()).toBe(0);
          expect(clientListener.disconnect.calls.count()).toBe(0);
          expect(clientListener.message.calls.count()).toBe(0);

          await promisify(process.nextTick)();

          // Emit connecting asynchronously
          expect(clientListener.connecting.calls.count()).toBe(1);
          expect(clientListener.connecting.calls.argsFor(0).length).toBe(0);
          expect(clientListener.connect.calls.count()).toBe(0);
          expect(clientListener.disconnect.calls.count()).toBe(0);
          expect(clientListener.message.calls.count()).toBe(0);

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Server events

      it(
        "should emit server connection",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Make transport client connecting
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          const evtRevelation = await promisifyEvent(serverEventFeed, "action");

          expect(evtRevelation[0]).toBe("Event");
          expect(evtRevelation[1].Name).toBe("connection");
          expect(evtRevelation[1].Arguments).toEqual([]);

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );
    });

    describe("WebSocket initialization fails", () => {
      // State functions

      it(
        "should update the state appropriately",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient._address = {}; // Make ws initialization fail
          transportClient.connect();

          expect(transportClient.state()).toBe("disconnected");

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Client events

      it(
        "should asynchronously emit connecting and then disconnect",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );
          transportClient._address = {}; // Make ws initialization fail

          const clientListener = createClientListener(transportClient);

          transportClient.connect();

          // Emit nothing synchronously
          expect(clientListener.connecting.calls.count()).toBe(0);
          expect(clientListener.connect.calls.count()).toBe(0);
          expect(clientListener.disconnect.calls.count()).toBe(0);
          expect(clientListener.message.calls.count()).toBe(0);

          const evtOrder = [];
          ["connecting", "disconnect"].forEach(evt => {
            transportClient.on(evt, () => {
              evtOrder.push(evt);
            });
          });

          await promisify(process.nextTick)();

          // Emit connecting asynchronously
          expect(clientListener.connecting.calls.count()).toBe(1);
          expect(clientListener.connecting.calls.argsFor(0).length).toBe(0);
          expect(clientListener.connect.calls.count()).toBe(0);
          expect(clientListener.disconnect.calls.count()).toBe(1);
          expect(clientListener.disconnect.calls.argsFor(0).length).toBe(1);
          expect(clientListener.message.calls.count()).toBe(0);
          expect(evtOrder).toEqual(["connecting", "disconnect"]);

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Server events - N/A
    });
  });
});

describe("The transport.disconnect() function", () => {
  describe("may fail", () => {
    it(
      "should throw if the transport is disconnected",
      retry(async () => {
        const transportClient = feedmeTransportWsClient(TARGET_URL);
        expect(() => {
          transportClient.disconnect();
        }).toThrow(new Error("INVALID_STATE: Already disconnected."));
      })
    );
  });

  describe("may succeed", () => {
    describe("client was connecting - no error", () => {
      // State functions

      it(
        "should update the state appropriately",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          expect(transportClient.state()).toBe("connecting");

          transportClient.disconnect();

          expect(transportClient.state()).toBe("disconnected");

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Client events

      it(
        "should asynchronously emit disconnect",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          expect(transportClient.state()).toBe("connecting");

          await promisify(process.nextTick)(); // Move past connecting event

          const clientListener = createClientListener(transportClient);

          transportClient.disconnect();

          // Emit nothing synchronously
          expect(clientListener.connecting.calls.count()).toBe(0);
          expect(clientListener.connect.calls.count()).toBe(0);
          expect(clientListener.disconnect.calls.count()).toBe(0);
          expect(clientListener.message.calls.count()).toBe(0);

          await promisify(process.nextTick)();

          // Emit disconnect asynchronously
          expect(clientListener.connecting.calls.count()).toBe(0);
          expect(clientListener.connect.calls.count()).toBeGreaterThanOrEqual(
            0
          ); // May have connected
          expect(clientListener.disconnect.calls.count()).toBe(1);
          expect(clientListener.disconnect.calls.argsFor(0).length).toBe(0);
          expect(clientListener.message.calls.count()).toBe(0);

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Server events - N/A
    });

    describe("client was connecting - error", () => {
      // State functions

      it(
        "should update the state appropriately",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          expect(transportClient.state()).toBe("connecting");

          transportClient.disconnect(new Error("SOME_ERROR"));

          expect(transportClient.state()).toBe("disconnected");

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Client events

      it(
        "should asynchronously emit disconnect",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          expect(transportClient.state()).toBe("connecting");

          await promisify(process.nextTick)(); // Move past connecting event

          const clientListener = createClientListener(transportClient);

          const err = new Error("SOME_ERROR");
          transportClient.disconnect(err);

          // Emit nothing synchronously
          expect(clientListener.connecting.calls.count()).toBe(0);
          expect(clientListener.connect.calls.count()).toBe(0);
          expect(clientListener.disconnect.calls.count()).toBe(0);
          expect(clientListener.message.calls.count()).toBe(0);

          await promisify(process.nextTick)();

          // Emit disconnect asynchronously
          expect(clientListener.connecting.calls.count()).toBe(0);
          expect(clientListener.connect.calls.count()).toBeGreaterThanOrEqual(
            0
          ); // May have connected
          expect(clientListener.disconnect.calls.count()).toBe(1);
          expect(clientListener.disconnect.calls.argsFor(0).length).toBe(1);
          expect(clientListener.disconnect.calls.argsFor(0)[0]).toBe(err);
          expect(clientListener.message.calls.count()).toBe(0);

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Server events - N/A
    });

    describe("client was connected - no error", () => {
      // State functions

      it(
        "should update the state appropriately",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          await promisifyEvent(transportClient, "connect");

          expect(transportClient.state()).toBe("connected");

          transportClient.disconnect();

          expect(transportClient.state()).toBe("disconnected");

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Client events

      it(
        "should asynchronously emit disconnect",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          await promisifyEvent(transportClient, "connect");

          expect(transportClient.state()).toBe("connected");

          await promisify(process.nextTick)(); // Move past connecting/connected events

          const clientListener = createClientListener(transportClient);

          transportClient.disconnect();

          // Emit nothing synchronously
          expect(clientListener.connecting.calls.count()).toBe(0);
          expect(clientListener.connect.calls.count()).toBe(0);
          expect(clientListener.disconnect.calls.count()).toBe(0);
          expect(clientListener.message.calls.count()).toBe(0);

          await promisify(process.nextTick)();

          // Emit disconnect asynchronously
          expect(clientListener.connecting.calls.count()).toBe(0);
          expect(clientListener.connect.calls.count()).toBe(0);
          expect(clientListener.disconnect.calls.count()).toBe(1);
          expect(clientListener.disconnect.calls.argsFor(0).length).toBe(0);
          expect(clientListener.message.calls.count()).toBe(0);

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Server events
      it(
        "should emit server client close",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Make transport client connecting
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          await Promise.all([
            promisifyEvent(transportClient, "connect"),
            promisifyEvent(serverEventFeed, "action") // connection
          ]);

          transportClient.disconnect();

          const evtRevelation = await promisifyEvent(serverEventFeed, "action");

          expect(evtRevelation[0]).toBe("Event");
          expect(evtRevelation[1].Name).toBe("clientClose");
          expect(evtRevelation[1].Arguments).toEqual([1000, ""]);

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );
    });

    describe("client was connected - error", () => {
      // State functions

      it(
        "should update the state appropriately",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          await promisifyEvent(transportClient, "connect");

          expect(transportClient.state()).toBe("connected");

          transportClient.disconnect(new Error("SOME_ERROR"));

          expect(transportClient.state()).toBe("disconnected");

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Client events

      it(
        "should asynchronously emit disconnect",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Create transport client
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          await promisifyEvent(transportClient, "connect");

          expect(transportClient.state()).toBe("connected");

          await promisify(process.nextTick)(); // Move past connecting/connected events

          const clientListener = createClientListener(transportClient);

          const err = new Error("SOME_ERROR");
          transportClient.disconnect(err);

          // Emit nothing synchronously
          expect(clientListener.connecting.calls.count()).toBe(0);
          expect(clientListener.connect.calls.count()).toBe(0);
          expect(clientListener.disconnect.calls.count()).toBe(0);
          expect(clientListener.message.calls.count()).toBe(0);

          await promisify(process.nextTick)();

          // Emit disconnect asynchronously
          expect(clientListener.connecting.calls.count()).toBe(0);
          expect(clientListener.connect.calls.count()).toBe(0);
          expect(clientListener.disconnect.calls.count()).toBe(1);
          expect(clientListener.disconnect.calls.argsFor(0).length).toBe(1);
          expect(clientListener.disconnect.calls.argsFor(0)[0]).toBe(err);
          expect(clientListener.message.calls.count()).toBe(0);

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );

      // Server events
      it(
        "should emit server client close",
        retry(async () => {
          const fmController = await connectController();

          // Establish a WS server port and open the events feed
          const { Port: port } = await fmController.action(
            "EstablishWsPort",
            {}
          );
          const serverEventFeed = fmController.feed("WsEvents", {
            Port: `${port}`
          });
          serverEventFeed.desireOpen();
          await promisifyEvent(serverEventFeed, "open");

          // Initilize WS server an wait until listening
          fmController.action("InitWsServer", { Port: `${port}` });
          const eventArgs = await promisifyEvent(serverEventFeed, "action");
          expect(eventArgs[0]).toBe("Event");
          expect(eventArgs[1].Name).toBe("listening");

          // Make transport client connecting
          const transportClient = feedmeTransportWsClient(
            `${TARGET_URL}:${port}`
          );

          transportClient.connect();

          await Promise.all([
            promisifyEvent(transportClient, "connect"),
            promisifyEvent(serverEventFeed, "action") // connection
          ]);

          transportClient.disconnect(new Error("SOME_ERROR"));

          const evtRevelation = await promisifyEvent(serverEventFeed, "action");

          expect(evtRevelation[0]).toBe("Event");
          expect(evtRevelation[1].Name).toBe("clientClose");
          expect(evtRevelation[1].Arguments).toEqual([1000, ""]);

          // Clean up
          await fmController.action("DestroyWsServer", { Port: port });
          disconnectController(fmController);
        })
      );
    });
  });
});

describe("The transport.send() function", () => {
  describe("may fail", () => {
    it(
      "should throw if the transport is disconnected",
      retry(async () => {
        const transportClient = feedmeTransportWsClient(TARGET_URL);
        expect(() => {
          transportClient.send("msg");
        }).toThrow(new Error("INVALID_STATE: Not connected."));
      })
    );

    it(
      "should throw if the transport is connecting",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Make transport client connecting
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        expect(transportClient.state()).toBe("connecting");
        expect(() => {
          transportClient.send("msg");
        }).toThrow(new Error("INVALID_STATE: Not connected."));

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );
  });

  describe("may succeed", () => {
    // State functions

    it(
      "should not change the state",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        expect(transportClient.state()).toBe("connected");

        transportClient.send("msg");

        expect(transportClient.state()).toBe("connected");

        await promisify(process.nextTick)();

        expect(transportClient.state()).toBe("connected");

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Client events

    it(
      "should emit nothing",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Create transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );

        transportClient.connect();

        await promisifyEvent(transportClient, "connect");

        expect(transportClient.state()).toBe("connected");

        await promisify(process.nextTick)(); // Move past connecting/connected events

        const clientListener = createClientListener(transportClient);

        transportClient.send("msg");

        // Emit nothing synchronously
        expect(clientListener.connecting.calls.count()).toBe(0);
        expect(clientListener.connect.calls.count()).toBe(0);
        expect(clientListener.disconnect.calls.count()).toBe(0);
        expect(clientListener.message.calls.count()).toBe(0);

        await promisify(process.nextTick)();

        // Emit nothing asynchronously
        expect(clientListener.connecting.calls.count()).toBe(0);
        expect(clientListener.connect.calls.count()).toBe(0);
        expect(clientListener.disconnect.calls.count()).toBe(0);
        expect(clientListener.message.calls.count()).toBe(0);

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Server events

    it(
      "should emit server client message",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Make transport client connecting
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );

        transportClient.connect();

        await Promise.all([
          promisifyEvent(transportClient, "connect"),
          promisifyEvent(serverEventFeed, "action") // connection
        ]);

        transportClient.send("msg");

        const evtRevelation = await promisifyEvent(serverEventFeed, "action");

        expect(evtRevelation[0]).toBe("Event");
        expect(evtRevelation[1].Name).toBe("clientMessage");
        expect(evtRevelation[1].Arguments).toEqual(["msg"]);

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );
  });
});

describe("The transport._processWsOpen() function", () => {
  // State functions

  it(
    "should change the state to connected",
    retry(async () => {
      const fmController = await connectController();

      // Establish a WS server port and open the events feed
      const { Port: port } = await fmController.action("EstablishWsPort", {});
      const serverEventFeed = fmController.feed("WsEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Initilize WS server an wait until listening
      fmController.action("InitWsServer", { Port: `${port}` });
      const eventArgs = await promisifyEvent(serverEventFeed, "action");
      expect(eventArgs[0]).toBe("Event");
      expect(eventArgs[1].Name).toBe("listening");

      // Connect a transport client
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);
      transportClient.connect();

      expect(transportClient.state()).toBe("connecting");

      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      await promisify(process.nextTick)();

      expect(transportClient.state()).toBe("connected");

      // Clean up
      await fmController.action("DestroyWsServer", { Port: port });
      disconnectController(fmController);
    })
  );

  // Client events

  it(
    "should asynchronously emit connect",
    retry(async () => {
      const fmController = await connectController();

      // Establish a WS server port and open the events feed
      const { Port: port } = await fmController.action("EstablishWsPort", {});
      const serverEventFeed = fmController.feed("WsEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Initilize WS server an wait until listening
      fmController.action("InitWsServer", { Port: `${port}` });
      const eventArgs = await promisifyEvent(serverEventFeed, "action");
      expect(eventArgs[0]).toBe("Event");
      expect(eventArgs[1].Name).toBe("listening");

      // Create transport client
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);

      transportClient.connect();

      expect(transportClient.state()).toBe("connecting");

      await promisify(process.nextTick)(); // Move past connecting event

      const clientListener = createClientListener(transportClient);

      await promisifyEvent(transportClient, "connect");

      // Emit connect asynchronously
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(1);
      expect(clientListener.connect.calls.argsFor(0).length).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);

      // Clean up
      await fmController.action("DestroyWsServer", { Port: port });
      disconnectController(fmController);
    })
  );

  // Server events - N/A
});

describe("The transport._processWsMessage() function", () => {
  describe("for a non-string message", () => {
    // State functions

    it(
      "should change the state to disconnected",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        // Await connection on both sides and get server client id
        const results = await Promise.all([
          promisifyEvent(serverEventFeed, "action"),
          promisifyEvent(transportClient, "connect")
        ]);
        const serverClientId = results[0][1].ClientId;

        expect(transportClient.state()).toBe("connected");

        // Send a message from the server
        fmController.action("InvokeWsClientMethod", {
          Port: `${port}`,
          Method: "send",
          ClientId: serverClientId,
          Arguments: ["binary"] // server changes "binary" to actual binary
        });

        await promisifyEvent(transportClient, "disconnect");

        expect(transportClient.state()).toBe("disconnected");

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Client events

    it(
      "should asynchronously emit disconnect",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        // Await connection on both sides and get server client id
        const results = await Promise.all([
          promisifyEvent(serverEventFeed, "action"),
          promisifyEvent(transportClient, "connect")
        ]);
        const serverClientId = results[0][1].ClientId;

        const clientListener = createClientListener(transportClient);

        // Send a message from the server
        fmController.action("InvokeWsClientMethod", {
          Port: `${port}`,
          Method: "send",
          ClientId: serverClientId,
          Arguments: ["binary"] // server changes "binary" to actual binary
        });
        await promisifyEvent(transportClient, "disconnect");

        // Emit disconnect asynchronously
        expect(clientListener.connecting.calls.count()).toBe(0);
        expect(clientListener.connect.calls.count()).toBe(0);
        expect(clientListener.disconnect.calls.count()).toBe(1);
        expect(clientListener.disconnect.calls.argsFor(0).length).toBe(1);
        expect(clientListener.disconnect.calls.argsFor(0)[0]).toEqual(
          jasmine.any(Error)
        );
        expect(clientListener.disconnect.calls.argsFor(0)[0].message).toEqual(
          "FAILURE: Received non-string message on WebSocket connection."
        );
        expect(clientListener.message.calls.count()).toBe(0);

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Server events

    it(
      "should emit server client close",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        // Await connection on both sides and get server client id
        const results = await Promise.all([
          promisifyEvent(serverEventFeed, "action"),
          promisifyEvent(transportClient, "connect")
        ]);
        const serverClientId = results[0][1].ClientId;

        // Send a message from the server
        fmController.action("InvokeWsClientMethod", {
          Port: `${port}`,
          Method: "send",
          ClientId: serverClientId,
          Arguments: ["binary"] // server changes "binary" to actual binary
        });

        const evt = await promisifyEvent(serverEventFeed, "action");
        expect(evt[0]).toBe("Event");
        expect(evt[1]).toEqual(jasmine.any(Object));
        expect(evt[1].Name).toBe("clientClose");
        expect(evt[1].Arguments).toEqual([1000, ""]);
        expect(evt[1].ClientId).toBe(serverClientId);

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );
  });

  describe("for a string message", () => {
    // State functions

    it(
      "should not change the state",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        // Await connection on both sides and get server client id
        const results = await Promise.all([
          promisifyEvent(serverEventFeed, "action"),
          promisifyEvent(transportClient, "connect")
        ]);
        const serverClientId = results[0][1].ClientId;

        expect(transportClient.state()).toBe("connected");

        // Send a message from the server
        fmController.action("InvokeWsClientMethod", {
          Port: `${port}`,
          Method: "send",
          ClientId: serverClientId,
          Arguments: ["msg"]
        });

        await promisifyEvent(transportClient, "message");

        expect(transportClient.state()).toBe("connected");

        await promisify(process.nextTick)();

        expect(transportClient.state()).toBe("connected");

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Client events

    it(
      "should asynchronously emit message",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        // Await connection on both sides and get server client id
        const results = await Promise.all([
          promisifyEvent(serverEventFeed, "action"),
          promisifyEvent(transportClient, "connect")
        ]);
        const serverClientId = results[0][1].ClientId;

        const clientListener = createClientListener(transportClient);

        // Send a message from the server
        fmController.action("InvokeWsClientMethod", {
          Port: `${port}`,
          Method: "send",
          ClientId: serverClientId,
          Arguments: ["msg"]
        });
        await promisifyEvent(transportClient, "message");

        // Emit message asynchronously
        expect(clientListener.connecting.calls.count()).toBe(0);
        expect(clientListener.connect.calls.count()).toBe(0);
        expect(clientListener.disconnect.calls.count()).toBe(0);
        expect(clientListener.message.calls.count()).toBe(1);
        expect(clientListener.message.calls.argsFor(0).length).toBe(1);
        expect(clientListener.message.calls.argsFor(0)[0]).toBe("msg");

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Server events - N/A
  });
});

describe("The transport._processWsClose() function", () => {
  describe("If the transport state is connecting", () => {
    // State functions

    it(
      "should change the state to disconnected",
      retry(async () => {
        // Start connecting a transport client
        const transportClient = feedmeTransportWsClient(BAD_URL);
        transportClient.connect();

        expect(transportClient.state()).toBe("connecting");

        await promisifyEvent(transportClient, "disconnect");

        expect(transportClient.state()).toBe("disconnected");
      })
    );

    // Client events

    it(
      "should emit disconnect",
      retry(async () => {
        // Start connecting a transport client
        const transportClient = feedmeTransportWsClient(BAD_URL);
        transportClient.connect();

        await promisify(process.nextTick)(); // Move past connecting event

        const clientListener = createClientListener(transportClient);

        await promisifyEvent(transportClient, "disconnect");

        expect(clientListener.connecting.calls.count()).toBe(0);
        expect(clientListener.connect.calls.count()).toBe(0);
        expect(clientListener.disconnect.calls.count()).toBe(1);
        expect(clientListener.disconnect.calls.argsFor(0).length).toBe(1);
        expect(clientListener.disconnect.calls.argsFor(0)[0]).toEqual(
          jasmine.any(Error)
        );
        expect(clientListener.disconnect.calls.argsFor(0)[0].message).toBe(
          "FAILURE: The WebSocket could not be opened."
        );
        expect(clientListener.message.calls.count()).toBe(0);
      })
    );

    // Server events - N/A
  });

  describe("If the transport state is connected - server does wsServer.close()", () => {
    // State functions

    it(
      "should change the state to disconnected",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        expect(transportClient.state()).toBe("connected");

        // Stop the server
        fmController.action("InvokeWsMethod", {
          Port: `${port}`,
          Method: "close",
          Arguments: []
        });

        await promisifyEvent(transportClient, "disconnect");

        expect(transportClient.state()).toBe("disconnected");

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Client events

    it(
      "should asynchronously emit disconnect",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();
        await promisifyEvent(transportClient, "connect");

        const clientListener = createClientListener(transportClient);

        expect(transportClient.state()).toBe("connected");

        // Stop the server
        fmController.action("InvokeWsMethod", {
          Port: `${port}`,
          Method: "close",
          Arguments: []
        });

        await promisifyEvent(transportClient, "disconnect");

        // Emit disconnect asynchronously
        expect(clientListener.connecting.calls.count()).toBe(0);
        expect(clientListener.connect.calls.count()).toBe(0);
        expect(clientListener.disconnect.calls.count()).toBe(1);
        expect(clientListener.disconnect.calls.argsFor(0).length).toBe(1);
        expect(clientListener.disconnect.calls.argsFor(0)[0]).toEqual(
          jasmine.any(Error)
        );
        expect(clientListener.disconnect.calls.argsFor(0)[0].message).toBe(
          "FAILURE: The WebSocket closed unexpectedly."
        );
        expect(clientListener.message.calls.count()).toBe(0);

        expect(transportClient.state()).toBe("disconnected");

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Server events - N/A
  });

  describe("If the transport state is connected - server does wsClient.close()", () => {
    // State functions

    it(
      "should change the state to disconnected",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        // Await connection on both sides and get server client id
        const results = await Promise.all([
          promisifyEvent(serverEventFeed, "action"),
          promisifyEvent(transportClient, "connect")
        ]);
        const serverClientId = results[0][1].ClientId;

        expect(transportClient.state()).toBe("connected");

        // Disconnect the client
        fmController.action("InvokeWsClientMethod", {
          Port: `${port}`,
          Method: "close",
          Arguments: [],
          ClientId: serverClientId
        });

        await promisifyEvent(transportClient, "disconnect");

        expect(transportClient.state()).toBe("disconnected");

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Client events

    it(
      "should asynchronously emit disconnect",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        // Await connection on both sides and get server client id
        const results = await Promise.all([
          promisifyEvent(serverEventFeed, "action"),
          promisifyEvent(transportClient, "connect")
        ]);
        const serverClientId = results[0][1].ClientId;

        const clientListener = createClientListener(transportClient);

        expect(transportClient.state()).toBe("connected");

        // Disconnect the client
        fmController.action("InvokeWsClientMethod", {
          Port: `${port}`,
          Method: "close",
          Arguments: [],
          ClientId: serverClientId
        });

        await promisifyEvent(transportClient, "disconnect");

        // Emit disconnect asynchronously
        expect(clientListener.connecting.calls.count()).toBe(0);
        expect(clientListener.connect.calls.count()).toBe(0);
        expect(clientListener.disconnect.calls.count()).toBe(1);
        expect(clientListener.disconnect.calls.argsFor(0).length).toBe(1);
        expect(clientListener.disconnect.calls.argsFor(0)[0]).toEqual(
          jasmine.any(Error)
        );
        expect(clientListener.disconnect.calls.argsFor(0)[0].message).toBe(
          "FAILURE: The WebSocket closed unexpectedly."
        );
        expect(clientListener.message.calls.count()).toBe(0);

        expect(transportClient.state()).toBe("disconnected");

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Server events - N/A
  });

  describe("If the transport state is connected - server does wsClient.terminate()", () => {
    // State functions

    it(
      "should change the state to disconnected",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        // Await connection on both sides and get server client id
        const results = await Promise.all([
          promisifyEvent(serverEventFeed, "action"),
          promisifyEvent(transportClient, "connect")
        ]);
        const serverClientId = results[0][1].ClientId;

        expect(transportClient.state()).toBe("connected");

        // Disconnect the client
        fmController.action("InvokeWsClientMethod", {
          Port: `${port}`,
          Method: "terminate",
          Arguments: [],
          ClientId: serverClientId
        });

        await promisifyEvent(transportClient, "disconnect");

        expect(transportClient.state()).toBe("disconnected");

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Client events

    it(
      "should asynchronously emit disconnect",
      retry(async () => {
        const fmController = await connectController();

        // Establish a WS server port and open the events feed
        const { Port: port } = await fmController.action("EstablishWsPort", {});
        const serverEventFeed = fmController.feed("WsEvents", {
          Port: `${port}`
        });
        serverEventFeed.desireOpen();
        await promisifyEvent(serverEventFeed, "open");

        // Initilize WS server an wait until listening
        fmController.action("InitWsServer", { Port: `${port}` });
        const eventArgs = await promisifyEvent(serverEventFeed, "action");
        expect(eventArgs[0]).toBe("Event");
        expect(eventArgs[1].Name).toBe("listening");

        // Connect a transport client
        const transportClient = feedmeTransportWsClient(
          `${TARGET_URL}:${port}`
        );
        transportClient.connect();

        // Await connection on both sides and get server client id
        const results = await Promise.all([
          promisifyEvent(serverEventFeed, "action"),
          promisifyEvent(transportClient, "connect")
        ]);
        const serverClientId = results[0][1].ClientId;

        const clientListener = createClientListener(transportClient);

        expect(transportClient.state()).toBe("connected");

        // Disconnect the client
        fmController.action("InvokeWsClientMethod", {
          Port: `${port}`,
          Method: "terminate",
          Arguments: [],
          ClientId: serverClientId
        });

        await promisifyEvent(transportClient, "disconnect");

        // Emit disconnect asynchronously
        expect(clientListener.connecting.calls.count()).toBe(0);
        expect(clientListener.connect.calls.count()).toBe(0);
        expect(clientListener.disconnect.calls.count()).toBe(1);
        expect(clientListener.disconnect.calls.argsFor(0).length).toBe(1);
        expect(clientListener.disconnect.calls.argsFor(0)[0]).toEqual(
          jasmine.any(Error)
        );
        expect(clientListener.disconnect.calls.argsFor(0)[0].message).toBe(
          "FAILURE: The WebSocket closed unexpectedly."
        );
        expect(clientListener.message.calls.count()).toBe(0);

        expect(transportClient.state()).toBe("disconnected");

        // Clean up
        await fmController.action("DestroyWsServer", { Port: port });
        disconnectController(fmController);
      })
    );

    // Server events - N/A
  });
});

describe("The transport._processWsError() function", () => {
  // Debug printing only - nothing to test
});

describe("The transport should operate correctly through multiple connection cycles", () => {
  // State functions

  it(
    "should update the state appropriately through the cycle",
    retry(async () => {
      const fmController = await connectController();

      // Establish a WS server port and open the events feed
      const { Port: port } = await fmController.action("EstablishWsPort", {});
      const serverEventFeed = fmController.feed("WsEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Initilize WS server an wait until listening
      fmController.action("InitWsServer", { Port: `${port}` });
      const eventArgs = await promisifyEvent(serverEventFeed, "action");
      expect(eventArgs[0]).toBe("Event");
      expect(eventArgs[1].Name).toBe("listening");

      // Connect a transport client
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);

      expect(transportClient.state()).toBe("disconnected");

      transportClient.connect();

      expect(transportClient.state()).toBe("connecting");

      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      transportClient.disconnect();

      expect(transportClient.state()).toBe("disconnected");

      transportClient.connect();

      expect(transportClient.state()).toBe("connecting");

      await promisifyEvent(transportClient, "connect");

      expect(transportClient.state()).toBe("connected");

      transportClient.disconnect();

      expect(transportClient.state()).toBe("disconnected");

      // Clean up
      await fmController.action("DestroyWsServer", { Port: port });
      disconnectController(fmController);
    })
  );

  // Transport client events

  it(
    "should emit events appropriately through the cycle",
    retry(async () => {
      const fmController = await connectController();

      // Establish a WS server port and open the events feed
      const { Port: port } = await fmController.action("EstablishWsPort", {});
      const serverEventFeed = fmController.feed("WsEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Initilize WS server an wait until listening
      fmController.action("InitWsServer", { Port: `${port}` });
      const eventArgs = await promisifyEvent(serverEventFeed, "action");
      expect(eventArgs[0]).toBe("Event");
      expect(eventArgs[1].Name).toBe("listening");

      // Connect a transport client
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);

      const clientListener = createClientListener(transportClient);

      transportClient.connect();

      // Emit nothing synchronously
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);

      await promisify(process.nextTick)();

      // Emit connecting asynchronously
      expect(clientListener.connecting.calls.count()).toBe(1);
      expect(clientListener.connecting.calls.argsFor(0).length).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);
      clientListener.spyClear();

      await promisifyEvent(transportClient, "connect");

      // Emit connect
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(1);
      expect(clientListener.connect.calls.argsFor(0).length).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);
      clientListener.spyClear();

      transportClient.disconnect();

      // Emit nothing synchronously
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);

      await promisify(process.nextTick)();

      // Emit disconnect asynchronously
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(1);
      expect(clientListener.disconnect.calls.argsFor(0).length).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);
      clientListener.spyClear();

      transportClient.connect();

      // Emit nothing synchronously
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);

      await promisify(process.nextTick)();

      // Emit connecting asynchronously
      expect(clientListener.connecting.calls.count()).toBe(1);
      expect(clientListener.connecting.calls.argsFor(0).length).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);
      clientListener.spyClear();

      await promisifyEvent(transportClient, "connect");

      // Emit connect
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(1);
      expect(clientListener.connect.calls.argsFor(0).length).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);
      clientListener.spyClear();

      transportClient.disconnect();

      // Emit nothing synchronously
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);

      await promisify(process.nextTick)();

      // Emit disconnect asynchronously
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(1);
      expect(clientListener.disconnect.calls.argsFor(0).length).toBe(0);
      expect(clientListener.message.calls.count()).toBe(0);
      clientListener.spyClear();

      // Clean up
      await fmController.action("DestroyWsServer", { Port: port });
      disconnectController(fmController);
    })
  );

  // Server events

  it(
    "should emit server events appropriately through the cycle",
    retry(async () => {
      const fmController = await connectController();

      // Establish a WS server port and open the events feed
      const { Port: port } = await fmController.action("EstablishWsPort", {});
      const serverEventFeed = fmController.feed("WsEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Initilize WS server an wait until listening
      fmController.action("InitWsServer", { Port: `${port}` });
      const eventArgs = await promisifyEvent(serverEventFeed, "action");
      expect(eventArgs[0]).toBe("Event");
      expect(eventArgs[1].Name).toBe("listening");

      // Connect a transport client
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);

      transportClient.connect();

      // Server should emit connecting event
      let results = await Promise.all([
        promisifyEvent(serverEventFeed, "action"),
        promisifyEvent(transportClient, "connect")
      ]);
      let evt = results[0];
      expect(evt[0]).toBe("Event");
      expect(evt[1].Name).toBe("connection");
      expect(evt[1].Arguments).toEqual([]);

      transportClient.disconnect();

      // Server should emit disconnect event
      results = await Promise.all([
        promisifyEvent(serverEventFeed, "action"),
        promisifyEvent(transportClient, "disconnect")
      ]);
      [evt] = results;
      expect(evt[0]).toBe("Event");
      expect(evt[1].Name).toBe("clientClose");
      expect(evt[1].Arguments).toEqual([1000, ""]);

      transportClient.connect();

      // Server should emit connecting event
      results = await Promise.all([
        promisifyEvent(serverEventFeed, "action"),
        promisifyEvent(transportClient, "connect")
      ]);
      [evt] = results;
      expect(evt[0]).toBe("Event");
      expect(evt[1].Name).toBe("connection");
      expect(evt[1].Arguments).toEqual([]);

      transportClient.disconnect();

      // Server should emit disconnect event
      results = await Promise.all([
        promisifyEvent(serverEventFeed, "action"),
        promisifyEvent(transportClient, "disconnect")
      ]);
      [evt] = results;
      expect(evt[0]).toBe("Event");
      expect(evt[1].Name).toBe("clientClose");
      expect(evt[1].Arguments).toEqual([1000, ""]);

      // Clean up
      await fmController.action("DestroyWsServer", { Port: port });
      disconnectController(fmController);
    })
  );
});

// Tests against a transport server
// Test only that the invokations on the library-facing side of the client API
// generate the correct events on the server, and vice versa

describe("The transport.connect() function", () => {
  it(
    "should emit connect on the server",
    retry(async () => {
      const fmController = await connectController();

      // Initialize a transport server and open the events feed
      const { Port: port } = await fmController.action(
        "InitTransportServer",
        {}
      );
      const serverEventFeed = fmController.feed("TransportEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Start the transport server and wait until started
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "start",
        Arguments: []
      });
      await new Promise(resolve => {
        serverEventFeed.on("action", (an, ad) => {
          if (an === "Event" && ad.Name === "start") {
            serverEventFeed.removeAllListeners("action");
            resolve();
          }
        });
      });

      // Connect a transport client and check the server event
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);
      transportClient.connect();
      const evt = await promisifyEvent(serverEventFeed, "action");
      expect(evt[0]).toBe("Event");
      expect(evt[1].Name).toBe("connect");
      expect(evt[1].Arguments.length).toBe(1);
      expect(evt[1].Arguments[0]).toEqual(jasmine.any(String));

      // Clean up
      await fmController.action("DestroyTransportServer", { Port: port });
      disconnectController(fmController);
    })
  );
});

describe("The transport.disconnect() function", () => {
  it(
    "should emit disconnect on the server",
    retry(async () => {
      const fmController = await connectController();

      // Initialize a transport server and open the events feed
      const { Port: port } = await fmController.action(
        "InitTransportServer",
        {}
      );
      const serverEventFeed = fmController.feed("TransportEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Start the transport server and wait until started
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "start",
        Arguments: []
      });
      await new Promise(resolve => {
        serverEventFeed.on("action", (an, ad) => {
          if (an === "Event" && ad.Name === "start") {
            serverEventFeed.removeAllListeners("action");
            resolve();
          }
        });
      });

      // Connect a transport client and get server client id
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);
      transportClient.connect();
      const evts = await Promise.all([
        promisifyEvent(transportClient, "connect"),
        promisifyEvent(serverEventFeed, "action") // connection
      ]);
      const serverClientId = evts[1][1].Arguments[0];

      // Disconnect the client and check the server event
      transportClient.disconnect();
      const evt = await promisifyEvent(serverEventFeed, "action");
      expect(evt[0]).toBe("Event");
      expect(evt[1].Name).toBe("disconnect");
      expect(evt[1].Arguments.length).toBe(2); // Client ID and Error object
      expect(evt[1].Arguments[0]).toBe(serverClientId);

      // Clean up
      await fmController.action("DestroyTransportServer", { Port: port });
      disconnectController(fmController);
    })
  );
});

describe("The transport.send() function", () => {
  it(
    "should emit message on the server",
    retry(async () => {
      const fmController = await connectController();

      // Initialize a transport server and open the events feed
      const { Port: port } = await fmController.action(
        "InitTransportServer",
        {}
      );
      const serverEventFeed = fmController.feed("TransportEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Start the transport server and wait until started
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "start",
        Arguments: []
      });
      await new Promise(resolve => {
        serverEventFeed.on("action", (an, ad) => {
          if (an === "Event" && ad.Name === "start") {
            serverEventFeed.removeAllListeners("action");
            resolve();
          }
        });
      });

      // Connect a transport client and get server client id
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);
      transportClient.connect();
      const evts = await Promise.all([
        promisifyEvent(transportClient, "connect"),
        promisifyEvent(serverEventFeed, "action") // connection
      ]);
      const serverClientId = evts[1][1].Arguments[0];

      // Send the server a message and check the server event
      transportClient.send("msg");
      const evt = await promisifyEvent(serverEventFeed, "action");
      expect(evt[0]).toBe("Event");
      expect(evt[1].Name).toBe("message");
      expect(evt[1].Arguments.length).toBe(2);
      expect(evt[1].Arguments[0]).toBe(serverClientId);
      expect(evt[1].Arguments[1]).toBe("msg");

      // Clean up
      await fmController.action("DestroyTransportServer", { Port: port });
      disconnectController(fmController);
    })
  );
});

describe("The server.stop() function", () => {
  it(
    "should emit disconnect on the client",
    retry(async () => {
      const fmController = await connectController();

      // Initialize a transport server and open the events feed
      const { Port: port } = await fmController.action(
        "InitTransportServer",
        {}
      );
      const serverEventFeed = fmController.feed("TransportEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Start the transport server and wait until started
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "start",
        Arguments: []
      });
      await new Promise(resolve => {
        serverEventFeed.on("action", (an, ad) => {
          if (an === "Event" && ad.Name === "start") {
            serverEventFeed.removeAllListeners("action");
            resolve();
          }
        });
      });

      // Connect a transport client
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);
      transportClient.connect();
      await promisifyEvent(transportClient, "connect");

      const clientListener = createClientListener(transportClient);

      // Stop the server
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "stop",
        Arguments: []
      });

      // Check the client event
      await promisifyEvent(transportClient, "disconnect");
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(1);
      expect(clientListener.disconnect.calls.argsFor(0).length).toBe(1);
      expect(clientListener.disconnect.calls.argsFor(0)[0]).toEqual(
        jasmine.any(Error)
      );
      expect(clientListener.disconnect.calls.argsFor(0)[0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly."
      );
      expect(clientListener.message.calls.count()).toBe(0);

      // Clean up
      await fmController.action("DestroyTransportServer", { Port: port });
      disconnectController(fmController);
    })
  );
});

describe("The server.send() function", () => {
  it(
    "should emit message on the client",
    retry(async () => {
      const fmController = await connectController();

      // Initialize a transport server and open the events feed
      const { Port: port } = await fmController.action(
        "InitTransportServer",
        {}
      );
      const serverEventFeed = fmController.feed("TransportEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Start the transport server and wait until started
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "start",
        Arguments: []
      });
      await new Promise(resolve => {
        serverEventFeed.on("action", (an, ad) => {
          if (an === "Event" && ad.Name === "start") {
            serverEventFeed.removeAllListeners("action");
            resolve();
          }
        });
      });

      // Connect a transport client
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);
      transportClient.connect();
      const results = await Promise.all([
        promisifyEvent(serverEventFeed, "action"),
        promisifyEvent(transportClient, "connect")
      ]);
      const serverClientId = results[0][1].Arguments[0];

      const clientListener = createClientListener(transportClient);

      // Send a message
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "send",
        Arguments: [serverClientId, "msg"]
      });

      // Check the client event
      await promisifyEvent(transportClient, "message");
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(1);
      expect(clientListener.message.calls.argsFor(0).length).toBe(1);
      expect(clientListener.message.calls.argsFor(0)[0]).toBe("msg");

      // Clean up
      await fmController.action("DestroyTransportServer", { Port: port });
      disconnectController(fmController);
    })
  );
});

describe("The server.disconnect() function", () => {
  it(
    "should emit disconnect on the client",
    retry(async () => {
      const fmController = await connectController();

      // Initialize a transport server and open the events feed
      const { Port: port } = await fmController.action(
        "InitTransportServer",
        {}
      );
      const serverEventFeed = fmController.feed("TransportEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Start the transport server and wait until started
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "start",
        Arguments: []
      });
      await new Promise(resolve => {
        serverEventFeed.on("action", (an, ad) => {
          if (an === "Event" && ad.Name === "start") {
            serverEventFeed.removeAllListeners("action");
            resolve();
          }
        });
      });

      // Connect a transport client
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);
      transportClient.connect();
      const results = await Promise.all([
        promisifyEvent(serverEventFeed, "action"),
        promisifyEvent(transportClient, "connect")
      ]);
      const serverClientId = results[0][1].Arguments[0];

      const clientListener = createClientListener(transportClient);

      // Disconnect the client
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "disconnect",
        Arguments: [serverClientId]
      });

      // Check the client event
      await promisifyEvent(transportClient, "disconnect");
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(1);
      expect(clientListener.disconnect.calls.argsFor(0).length).toBe(1);
      expect(clientListener.disconnect.calls.argsFor(0)[0]).toEqual(
        jasmine.any(Error)
      );
      expect(clientListener.disconnect.calls.argsFor(0)[0].message).toBe(
        "FAILURE: The WebSocket closed unexpectedly."
      );
      expect(clientListener.message.calls.count()).toBe(0);

      // Clean up
      await fmController.action("DestroyTransportServer", { Port: port });
      disconnectController(fmController);
    })
  );
});

describe("The transport should be able to exchange long messages", () => {
  it(
    "server to client",
    retry(async () => {
      const fmController = await connectController();

      // Initialize a transport server and open the events feed
      const { Port: port } = await fmController.action(
        "InitTransportServer",
        {}
      );
      const serverEventFeed = fmController.feed("TransportEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Start the transport server and wait until started
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "start",
        Arguments: []
      });
      await new Promise(resolve => {
        serverEventFeed.on("action", (an, ad) => {
          if (an === "Event" && ad.Name === "start") {
            serverEventFeed.removeAllListeners("action");
            resolve();
          }
        });
      });

      // Connect a transport client
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);
      transportClient.connect();
      const results = await Promise.all([
        promisifyEvent(serverEventFeed, "action"),
        promisifyEvent(transportClient, "connect")
      ]);
      const serverClientId = results[0][1].Arguments[0];

      const clientListener = createClientListener(transportClient);

      const msg = "z".repeat(1e6); // 1mb (not too long to avoid timeouts on Sauce)

      // Send a long message server -> client
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "send",
        Arguments: [serverClientId, msg]
      });

      // Check the client event
      await promisifyEvent(transportClient, "message");
      expect(clientListener.connecting.calls.count()).toBe(0);
      expect(clientListener.connect.calls.count()).toBe(0);
      expect(clientListener.disconnect.calls.count()).toBe(0);
      expect(clientListener.message.calls.count()).toBe(1);
      expect(clientListener.message.calls.argsFor(0).length).toBe(1);
      expect(clientListener.message.calls.argsFor(0)[0]).toBe(msg);

      // Clean up
      await fmController.action("DestroyTransportServer", { Port: port });
      disconnectController(fmController);
    })
  );

  it(
    "client to server",
    retry(async () => {
      const fmController = await connectController();

      // Initialize a transport server and open the events feed
      const { Port: port } = await fmController.action(
        "InitTransportServer",
        {}
      );
      const serverEventFeed = fmController.feed("TransportEvents", {
        Port: `${port}`
      });
      serverEventFeed.desireOpen();
      await promisifyEvent(serverEventFeed, "open");

      // Start the transport server and wait until started
      fmController.action("InvokeTransportMethod", {
        Port: port,
        Method: "start",
        Arguments: []
      });
      await new Promise(resolve => {
        serverEventFeed.on("action", (an, ad) => {
          if (an === "Event" && ad.Name === "start") {
            serverEventFeed.removeAllListeners("action");
            resolve();
          }
        });
      });

      // Connect a transport client
      const transportClient = feedmeTransportWsClient(`${TARGET_URL}:${port}`);
      transportClient.connect();
      const results = await Promise.all([
        promisifyEvent(serverEventFeed, "action"),
        promisifyEvent(transportClient, "connect")
      ]);
      const serverClientId = results[0][1].Arguments[0];

      const msg = "z".repeat(1e6); // 1mb (not too long to avoid timeouts on Sauce)

      // Send a long message client -> server
      transportClient.send(msg);

      // Check the server event
      const evt = await promisifyEvent(serverEventFeed, "action");
      expect(evt[0]).toBe("Event");
      expect(evt[1].Name).toBe("message");
      expect(evt[1].Arguments.length).toBe(2);
      expect(evt[1].Arguments[0]).toBe(serverClientId);
      expect(evt[1].Arguments[1]).toBe(msg);

      // Clean up
      await fmController.action("DestroyTransportServer", { Port: port });
      disconnectController(fmController);
    })
  );
});

// Library-to-library tests

it(
  "should work through all major operations",
  retry(async () => {
    const fmController = await connectController();

    // Initialize a Feedme server and open the events feed
    const { Port: port } = await fmController.action("InitFeedmeServer", {});
    const serverEventFeed = fmController.feed("FeedmeEvents", {
      Port: `${port}`
    });
    serverEventFeed.desireOpen();
    await promisifyEvent(serverEventFeed, "open");

    // Start the Feedme server and wait until started
    fmController.action("InvokeFeedmeMethod", {
      Port: port,
      Method: "start",
      Arguments: []
    });
    await new Promise(resolve => {
      serverEventFeed.on("action", (an, ad) => {
        if (an === "Event" && ad.Name === "start") {
          serverEventFeed.removeAllListeners("action");
          resolve();
        }
      });
    });

    // Connect a Feedme client
    const fmClient = feedmeClient({
      transport: feedmeTransportWsClient(`${TARGET_URL}:${port}`)
    });
    fmClient.connect();
    await promisifyEvent(fmClient, "connect");

    // Try a rejected action
    try {
      await fmClient.action("failing_action", {
        Action: "Args"
      });
    } catch (e) {
      expect(e).toEqual(jasmine.any(Error));
      expect(e.message).toBe("REJECTED: Server rejected the action request.");
      expect(e.serverErrorCode).toBe("SOME_ERROR");
      expect(e.serverErrorData).toEqual({ Error: "Data" });
    }

    // Try a successful action
    const actionData = await fmClient.action("successful_action", {
      Action: "Args"
    });
    expect(actionData).toEqual({ Action: "Data" });

    // Try a rejected feed open
    const feed1 = fmClient.feed("failing_feed", { Feed: "Args" });
    feed1.desireOpen();
    const evt1 = await promisifyEvent(feed1, "close");
    expect(evt1[0]).toEqual(jasmine.any(Error));
    expect(evt1[0].message).toBe(
      "REJECTED: Server rejected the feed open request."
    );
    expect(evt1[0].serverErrorCode).toBe("SOME_ERROR");
    expect(evt1[0].serverErrorData).toEqual({ Error: "Data" });
    feed1.desireClosed();

    // Try a successful feed open
    const feed2 = fmClient.feed("successful_feed", { Feed: "Args" });
    feed2.desireOpen();
    await promisifyEvent(feed2, "open");
    expect(feed2.data()).toEqual({ Feed: "Data" });

    // Try a feed closure
    feed2.desireClosed();
    // await promisifyEvent(feed2, "close"); // close is emitted synchronously (changing))

    // Try an action revelation
    feed2.desireOpen();
    await promisifyEvent(feed2, "open");
    fmController.action("InvokeFeedmeMethod", {
      Port: port,
      Method: "actionRevelation",
      Arguments: [
        {
          actionName: "SomeAction",
          actionData: { Action: "Data" },
          feedName: "successful_feed",
          feedArgs: { Feed: "Args" },
          feedDeltas: [{ Operation: "Append", Path: ["Feed"], Value: "New" }]
        }
      ]
    });
    const evt2 = await promisifyEvent(feed2, "action");
    expect(evt2[0]).toBe("SomeAction");
    expect(evt2[1]).toEqual({ Action: "Data" });
    expect(evt2[2]).toEqual({ Feed: "DataNew" });
    expect(evt2[3]).toEqual({ Feed: "Data" });

    // Try a feed termination
    fmController.action("InvokeFeedmeMethod", {
      Port: port,
      Method: "feedTermination",
      Arguments: [
        {
          feedName: "successful_feed",
          feedArgs: { Feed: "Args" },
          errorCode: "SOME_ERROR",
          errorData: { Error: "Data" }
        }
      ]
    });
    const evt3 = await promisifyEvent(feed2, "close");
    expect(evt3[0]).toEqual(jasmine.any(Error));
    expect(evt3[0].message).toBe("TERMINATED: The server terminated the feed.");
    expect(evt3[0].serverErrorCode).toBe("SOME_ERROR");
    expect(evt3[0].serverErrorData).toEqual({ Error: "Data" });

    // Try a server disconnect
    fmController.action("InvokeFeedmeMethod", {
      Port: port,
      Method: "disconnect",
      Arguments: [fmClient.id()]
    });
    const evt4 = await promisifyEvent(fmClient, "disconnect");
    expect(evt4[0]).toEqual(jasmine.any(Error));
    expect(evt4[0].message).toBe("FAILURE: The WebSocket closed unexpectedly.");

    // Try a client disconnect
    // fmClient.connect();
    // await promisifyEvent(fmClient, "connect");
    // fmClient.disconnect();
    // await promisifyEvent(fmClient, "disconnect");

    // // Try a server stoppage (also cleans up)
    // fmClient.connect();
    // await promisifyEvent(fmClient, "connect");
    // fmServer.stop();
    // fmClient.once("disconnect", err => {
    //   expect(err).toBeInstanceOf(Error);
    //   expect(err.message).toBe("FAILURE: The WebSocket closed unexpectedly.");
    // });
    // await promisifyEvent(fmClient, "disconnect");

    // Clean up
    // await fmController.action("DestroyFeedmeServer", { Port: port });
    // disconnectController(fmController);
  })
);
