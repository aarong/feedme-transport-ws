import _ from "lodash";
import check from "check-types";
import emitter from "component-emitter";
import http from "http";
import stream from "stream";
import server from "../server.main";
import serverConfig from "../server.config";
import asyncUtil from "./asyncutil";

/*

Testing strategy

The ws module is mocked -- these are unit tests only. The integration tests that
are run on the build ensure that the transport plays nicely with actual ws.

1. Test state-modifying functionality
    For all outside function calls and ws events
      Test all errors (thrown)
      For each possible success type (by branch)
        Check outbound events (no extra)
        Check internal state
        Check ws calls
        Check mock function calls (set/clearTimeout and set/clearInterval)
        Check outbound callbacks are called
        Check inbound callbacks from ws and timers/intervals
          Check outbound events
          Check internal state
          Check outbound callbacks are called
        Check return value

2. Test state-getting functionality.
    No need to worry about events, state change, transport calls, or callbacks.
    Test that each "type" of state results in the correct error being thrown or
    return value being returned.

State: Object members
  ._wsConstructor
  ._wsServer
  ._state
  ._wsClients
  ._heartbeatIntervals
  ._heartbeatTimeouts
  ._options
  ._httpHandlers
  ._httpListeningTimeout
  ._httpPollingInterval

1. State-modifying functionality
  Triggered by library
    server()
    server.start()
    server.stop()
    server.send(cid, msg)
    server.disconnect(cid, [err])
  Triggered by ws
    _processServerListening()
    _processServerClose()
    _processServerError()
    _processWsServerConnection()
    _processWsClientMessage()
    _processWsClientPong()
    _processWsClientClose()
    _processWsClientError()

2. State-getting functionality
    .state()

3. Stateless functionality
    ._processHandleProtocols()

*/

const PORT = 3000;

jest.useFakeTimers();

// Harness

const harnessProto = {};

const harness = function harness(options, wsConstructor) {
  const h = Object.create(harnessProto);

  // Create mock wsConstructor (if not overridden)
  let constructor;
  if (wsConstructor) {
    constructor = wsConstructor;
  } else {
    constructor = function c() {
      emitter(this);
      this.close = jest.fn();
      this.handleUpgrade = jest.fn();
      this.mockClear = () => {
        this.close.mockClear();
        this.handleUpgrade.mockClear();
      };
    };
  }

  h.server = server(constructor, options);
  return h;
};

harnessProto.getWs = function getWs() {
  // The ws instance changes over time, so you can't store it as a property of the harness
  return this.server._wsServer;
};

harnessProto.createServerListener = function createServerListener() {
  const l = {
    starting: jest.fn(),
    start: jest.fn(),
    stopping: jest.fn(),
    stop: jest.fn(),
    connect: jest.fn(),
    message: jest.fn(),
    disconnect: jest.fn()
  };
  l.mockClear = () => {
    l.starting.mockClear();
    l.start.mockClear();
    l.stopping.mockClear();
    l.stop.mockClear();
    l.connect.mockClear();
    l.message.mockClear();
    l.disconnect.mockClear();
  };
  this.server.on("starting", l.starting);
  this.server.on("start", l.start);
  this.server.on("stopping", l.stopping);
  this.server.on("stop", l.stop);
  this.server.on("connect", l.connect);
  this.server.on("message", l.message);
  this.server.on("disconnect", l.disconnect);
  return l;
};

harnessProto.createMockWs = function createMockWs() {
  // Create a mock client ws that can be emitted to the transport server
  const ws = emitter({
    ping: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    terminate: jest.fn(),
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    readyState: 1 // connection event emitted when client is open
  });
  ws.mockClear = () => {
    ws.ping.mockClear();
    ws.send.mockClear();
    ws.close.mockClear();
    ws.terminate.mockClear();
  };
  return ws;
};

harnessProto.getServerState = function getServerState() {
  const state = {};
  state._wsConstructor = this.server._wsConstructor; // Object reference
  state._wsServer = this.server._wsServer; // Object reference
  state._state = this.server._state; // String
  state._wsClients = {};
  _.each(this.server._wsClients, (ws, cid) => {
    state._wsClients[cid] = true; // Boolean - checking keys only
  });
  state._heartbeatIntervals = {};
  _.each(this.server._heartbeatIntervals, (iid, cid) => {
    state._heartbeatIntervals[cid] = true; // Boolean - checking keys only
  });
  state._heartbeatTimeouts = {};
  _.each(this.server._heartbeatTimeouts, (tid, cid) => {
    state._heartbeatTimeouts[cid] = true; // Boolean - checking keys only
  });
  state._options = _.clone(this.server._options); // Object copy
  state._httpHandlers = this.server._httpHandlers; // Null or object with three fn references
  state._httpListeningTimeout = this.server._httpListeningTimeout; // Number
  state._httpPollingInterval = this.server._httpPollingInterval; // Number
  return state;
};

const toHaveState = function toHaveState(receivedServer, expectedState) {
  // Check ._wsConstructor
  if (receivedServer._wsConstructor !== expectedState._wsConstructor) {
    return {
      pass: false,
      message() {
        return "expected ._wsConstructor to match, but they didn't";
      }
    };
  }

  // Check ._wsServer (both objects or both null)
  if (
    (check.object(receivedServer._wsServer) &&
      !check.object(expectedState._wsServer)) ||
    (!check.object(receivedServer._wsServer) &&
      check.object(expectedState._wsServer)) ||
    (receivedServer._wsServer === null && expectedState._wsServer !== null) ||
    (receivedServer._wsServer !== null && expectedState._wsServer === null)
  ) {
    return {
      pass: false,
      message() {
        return "expected ._wsServer to match, but they didn't";
      }
    };
  }

  // Check _state
  if (receivedServer._state !== expectedState._state) {
    return {
      pass: false,
      message() {
        return "expected ._state to match, but they didn't";
      }
    };
  }

  // Check _wsClients
  if (
    !_.isEqual(
      _.keys(receivedServer._wsClients).sort(),
      _.keys(expectedState._wsClients).sort()
    )
  ) {
    return {
      pass: false,
      message() {
        return "expected ._wsClients to match, but they didn't";
      }
    };
  }

  // Check _heartbeatIntervals
  if (
    !_.isEqual(
      _.keys(receivedServer._heartbeatIntervals).sort(),
      _.keys(expectedState._heartbeatIntervals).sort()
    )
  ) {
    return {
      pass: false,
      message() {
        return "expected ._heartbeatIntervals to match, but they didn't";
      }
    };
  }

  // Check _heartbeatTimeouts
  if (
    !_.isEqual(
      _.keys(receivedServer._heartbeatTimeouts).sort(),
      _.keys(expectedState._heartbeatTimeouts).sort()
    )
  ) {
    return {
      pass: false,
      message() {
        return "expected ._heartbeatTimeouts to match, but they didn't";
      }
    };
  }

  // Check _options
  if (!_.isEqual(receivedServer._options, expectedState._options)) {
    return {
      pass: false,
      message() {
        return "expected ._options to match, but they didn't";
      }
    };
  }

  // Check ._httpHandlers (both null or both objects with three fn references)

  if (
    !(
      receivedServer._httpHandlers === expectedState._httpHandlers ||
      (check.object(receivedServer._httpHandlers) &&
        check.object(expectedState._httpHandlers) &&
        check.function(receivedServer._httpHandlers.listening) &&
        check.function(expectedState._httpHandlers.listening) &&
        check.function(receivedServer._httpHandlers.close) &&
        check.function(expectedState._httpHandlers.close) &&
        check.function(receivedServer._httpHandlers.error) &&
        check.function(expectedState._httpHandlers.error))
    )
  ) {
    return {
      pass: false,
      message() {
        return "expected ._httpHandlers to match, but they didn't";
      }
    };
  }

  // Check ._httpListeningTimeout (both null or both numbers)
  if (
    !(
      (check.number(receivedServer._httpListeningTimeout) &&
        check.number(expectedState._httpListeningTimeout)) ||
      receivedServer._httpListeningTimeout ===
        expectedState._httpListeningTimeout
    )
  ) {
    return {
      pass: false,
      message() {
        return "expected ._httpListeningTimeout to match, but they didn't";
      }
    };
  }

  // Check ._httpPollingInterval (both null or both numbers)
  if (
    !(
      (check.number(receivedServer._httpPollingInterval) &&
        check.number(expectedState._httpPollingInterval)) ||
      receivedServer._httpPollingInterval === expectedState._httpPollingInterval
    )
  ) {
    return {
      pass: false,
      message() {
        return "expected ._httpPollingInterval to match, but they didn't";
      }
    };
  }

  // Match
  return { pass: true };
};

expect.extend({ toHaveState });

describe("The toHaveState() function", () => {
  describe("can fail", () => {
    it("should fail if _wsConstructor don't match", () => {
      const result = toHaveState(
        { _wsConstructor: () => {} },
        { _wsConstructor: () => {} }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._wsConstructor to match, but they didn't"
      );
    });

    it("should fail if _wsServer values don't match - case 1", () => {
      const result = toHaveState({ _wsServer: null }, { _wsServer: {} });
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._wsServer to match, but they didn't"
      );
    });

    it("should fail if _wsServer values don't match - case 2", () => {
      const result = toHaveState({ _wsServer: {} }, { _wsServer: null });
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._wsServer to match, but they didn't"
      );
    });

    it("should fail if _state values don't match", () => {
      const result = toHaveState({ _state: "123" }, { _state: "456" });
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._state to match, but they didn't"
      );
    });

    it("should fail if _wsClients keys don't match", () => {
      const result = toHaveState(
        { _wsClients: { one: 123 } },
        { _wsClients: {} }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._wsClients to match, but they didn't"
      );
    });

    it("should fail if _heartbeatIntervals keys don't match", () => {
      const result = toHaveState(
        { _heartbeatIntervals: { one: 123 } },
        { _heartbeatIntervals: {} }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._heartbeatIntervals to match, but they didn't"
      );
    });

    it("should fail if _heartbeatTimeouts keys don't match", () => {
      const result = toHaveState(
        { _heartbeatTimeouts: { one: 123 } },
        { _heartbeatTimeouts: {} }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._heartbeatTimeouts to match, but they didn't"
      );
    });

    it("should fail if _options don't match", () => {
      const result = toHaveState(
        { _options: { _heartbeatIntervalMs: 123 } },
        { _options: {} }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._options to match, but they didn't"
      );
    });

    it("should fail if _httpHandlers values don't match - case 1", () => {
      const result = toHaveState(
        { _httpHandlers: null },
        { _httpHandlers: {} }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._httpHandlers to match, but they didn't"
      );
    });

    it("should fail if _httpHandlers values don't match - case 2", () => {
      const result = toHaveState(
        { _httpHandlers: {} },
        { _httpHandlers: null }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._httpHandlers to match, but they didn't"
      );
    });

    it("should fail if _httpHandlers values don't match - case 3", () => {
      const result = toHaveState({ _httpHandlers: {} }, { _httpHandlers: {} });
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._httpHandlers to match, but they didn't"
      );
    });

    it("should fail if _httpListeningTimeout values don't match - case 1", () => {
      const result = toHaveState(
        { _httpListeningTimeout: 123 },
        { _httpListeningTimeout: null }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._httpListeningTimeout to match, but they didn't"
      );
    });

    it("should fail if _httpListeningTimeout values don't match - case 2", () => {
      const result = toHaveState(
        { _httpListeningTimeout: null },
        { _httpListeningTimeout: 123 }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._httpListeningTimeout to match, but they didn't"
      );
    });

    it("should fail if _httpPollingInterval values don't match - case 1", () => {
      const result = toHaveState(
        { _httpPollingInterval: 123 },
        { _httpPollingInterval: null }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._httpPollingInterval to match, but they didn't"
      );
    });

    it("should fail if _httpPollingInterval values don't match - case 2", () => {
      const result = toHaveState(
        { _httpPollingInterval: null },
        { _httpPollingInterval: 123 }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._httpPollingInterval to match, but they didn't"
      );
    });
  });

  describe("can pass", () => {
    it("should pass if _wsConstructor matches", () => {
      const f = () => {};
      const result = toHaveState({ _wsConstructor: f }, { _wsConstructor: f });
      expect(result.pass).toBe(true);
    });

    it("should pass if _wsServer matches - case 1", () => {
      const result = toHaveState({ _wsServer: {} }, { _wsServer: {} });
      expect(result.pass).toBe(true);
    });

    it("should pass if _wsServer matches - case 2", () => {
      const result = toHaveState({ _wsServer: null }, { _wsServer: null });
      expect(result.pass).toBe(true);
    });

    it("should pass if _state matches", () => {
      const result = toHaveState({ _state: "stopped" }, { _state: "stopped" });
      expect(result.pass).toBe(true);
    });

    it("should pass if _wsClients match", () => {
      const result = toHaveState(
        { _wsClients: { cid: {} } },
        { _wsClients: { cid: {} } }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _heartbeatIntervals match", () => {
      const result = toHaveState(
        { _heartbeatIntervals: { cid: {} } },
        { _heartbeatIntervals: { cid: {} } }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _heartbeatTimeouts match", () => {
      const result = toHaveState(
        { _heartbeatTimeouts: { cid: {} } },
        { _heartbeatTimeouts: { cid: {} } }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _options match", () => {
      const result = toHaveState(
        { _options: { someOption: "val" } },
        { _options: { someOption: "val" } }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _httpHandlers matches - case 1", () => {
      const result = toHaveState(
        {
          _httpHandlers: {
            listening: () => {},
            close: () => {},
            error: () => {}
          }
        },
        {
          _httpHandlers: {
            listening: () => {},
            close: () => {},
            error: () => {}
          }
        }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _httpHandlers matches - case 2", () => {
      const result = toHaveState(
        { _httpHandlers: null },
        { _httpHandlers: null }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _httpListeningTimeout matches - case 1", () => {
      const result = toHaveState(
        { _httpListeningTimeout: 123 },
        { _httpListeningTimeout: 123 }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _httpListeningTimeout matches - case 2", () => {
      const result = toHaveState(
        { _httpListeningTimeout: null },
        { _httpListeningTimeout: null }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _httpPollingInterval matches - case 1", () => {
      const result = toHaveState(
        { _httpPollingInterval: 123 },
        { _httpPollingInterval: 123 }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _httpPollingInterval matches - case 2", () => {
      const result = toHaveState(
        { _httpPollingInterval: null },
        { _httpPollingInterval: null }
      );
      expect(result.pass).toBe(true);
    });
  });
});

// Server tests

describe("The server() function", () => {
  describe("can fail", () => {
    it("should throw on missing wsConstructor", () => {
      expect(() => {
        server();
      }).toThrow(
        new Error("INVALID_ARGUMENT: Invalid wsConstructor argument.")
      );
    });

    it("should throw on invalid wsConstructor", () => {
      expect(() => {
        server("junk");
      }).toThrow(
        new Error("INVALID_ARGUMENT: Invalid wsConstructor argument.")
      );
    });

    it("should throw on missing options", () => {
      expect(() => {
        harness();
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid options argument."));
    });

    it("should throw on invalid options type", () => {
      expect(() => {
        harness("junk");
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid options argument."));
    });

    it("should throw on invalid options.port type", () => {
      expect(() => {
        harness({ port: "junk" });
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid options.port argument."));
    });

    it("should throw on invalid options.port range - low", () => {
      expect(() => {
        harness({ port: -1 });
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid options.port argument."));
    });

    it("should throw on invalid options.port range - high", () => {
      expect(() => {
        harness({ port: 2 ** 16 });
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid options.port argument."));
    });

    it("should throw if no port, server, and noServer setting", () => {
      expect(() => {
        harness({});
      }).toThrow(
        new Error(
          "INVALID_ARGUMENT: Must specify a valid port, server, or noServer option."
        )
      );
    });

    it("should throw if invalid server setting", () => {
      expect(() => {
        harness({ server: 123 });
      }).toThrow(
        new Error("INVALID_ARGUMENT: Invalid options.server argument.")
      );
    });

    it("should throw if invalid noServer setting", () => {
      expect(() => {
        harness({ noServer: 123 });
      }).toThrow(
        new Error("INVALID_ARGUMENT: Invalid options.noServer argument.")
      );
    });

    it("should throw if handleProtocols is present", () => {
      expect(() => {
        harness({ port: 123, handleProtocols: () => {} });
      }).toThrow(
        new Error("INVALID_ARGUMENT: Must not specify options.handleProtocols.")
      );
    });

    it("should throw on invalid options.heartbeatIntervalMs - type", () => {
      expect(() => {
        harness({ port: PORT, heartbeatIntervalMs: "junk" });
      }).toThrow(
        new Error(
          "INVALID_ARGUMENT: Invalid options.heartbeatIntervalMs argument."
        )
      );
    });

    it("should throw on invalid options.heartbeatIntervalMs - negative", () => {
      expect(() => {
        harness({ port: PORT, heartbeatIntervalMs: -1 });
      }).toThrow(
        new Error(
          "INVALID_ARGUMENT: Invalid options.heartbeatIntervalMs argument."
        )
      );
    });

    it("should throw on invalid options.heartbeatTimeoutMs - type", () => {
      expect(() => {
        harness({ port: PORT, heartbeatTimeoutMs: "junk" });
      }).toThrow(
        new Error(
          "INVALID_ARGUMENT: Invalid options.heartbeatTimeoutMs argument."
        )
      );
    });

    it("should throw on invalid options.heartbeatTimeoutMs - zero", () => {
      expect(() => {
        harness({ port: PORT, heartbeatTimeoutMs: 0 });
      }).toThrow(
        new Error(
          "INVALID_ARGUMENT: Invalid options.heartbeatTimeoutMs argument."
        )
      );
    });

    it("should throw if options.heartbeatTimeoutMs >= options.heartbeatIntervalMs", () => {
      expect(() => {
        harness({ port: PORT, heartbeatIntervalMs: 1, heartbeatTimeoutMs: 1 });
      }).toThrow(
        new Error(
          "INVALID_ARGUMENT: Invalid options.heartbeatTimeoutMs argument."
        )
      );
    });
  });

  describe("can succeed", () => {
    // Events - N/A

    // State

    it("should have the correct state - default options", () => {
      const harn = harness({
        port: PORT
      });
      expect(harn.getServerState()).toHaveState({
        _wsConstructor: harn.server._wsConstructor,
        _wsServer: null,
        _state: "stopped",
        _wsClients: {},
        _heartbeatIntervals: {},
        _heartbeatTimeouts: {},
        _options: {
          port: PORT,
          heartbeatIntervalMs: serverConfig.defaults.heartbeatIntervalMs,
          heartbeatTimeoutMs: serverConfig.defaults.heartbeatTimeoutMs
        },
        _httpHandlers: null,
        _httpListeningTimeout: null,
        _httpPollingInterval: null
      });
    });

    it("should have the correct state - custom options with stand-alone server", () => {
      const harn = harness({
        port: PORT,
        heartbeatIntervalMs: 456,
        heartbeatTimeoutMs: 123
      });
      expect(harn.getServerState()).toHaveState({
        _wsConstructor: harn.server._wsConstructor,
        _wsServer: null,
        _state: "stopped",
        _wsClients: {},
        _heartbeatIntervals: {},
        _heartbeatTimeouts: {},
        _options: {
          port: PORT,
          heartbeatIntervalMs: 456,
          heartbeatTimeoutMs: 123
        },
        _httpHandlers: null,
        _httpListeningTimeout: null,
        _httpPollingInterval: null
      });
    });

    // Function calls - N/A

    // Calls on ws - N/A

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A

    // Return value

    it("should return an object", () => {
      expect(harness({ port: PORT })).toBeInstanceOf(Object);
    });
  });
});

// State-modifying functions - triggered by library

describe("The server.start() function", () => {
  describe("can fail", () => {
    it("should throw if the server is not stopped", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      expect(() => {
        harn.server.start();
      }).toThrow(new Error("INVALID_STATE: The server is not stopped."));
    });
  });

  describe("can succeed", () => {
    // Events

    it("stand-alone server - ws constructor succeeds - should asynchronously emit starting", async () => {
      const harn = harness({ port: PORT });
      const listener = harn.createServerListener();
      harn.server.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    it("stand-alone server - if the ws constructor throws - should asynchronously emit starting, stopping, stopped", async () => {
      const err = new Error("SOME_ERROR");
      const harn = harness({ port: PORT }, () => {
        throw err;
      });
      const listener = harn.createServerListener();
      harn.server.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      const eventOrder = [];
      ["starting", "stopping", "stop"].forEach(evt => {
        harn.server.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: Could not initialize WebSocket server."
      );
      expect(listener.stopping.mock.calls[0][0].wsError).toBe(err);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: Could not initialize WebSocket server."
      );
      expect(listener.stop.mock.calls[0][0].wsError).toBe(err);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      expect(eventOrder).toEqual(["starting", "stopping", "stop"]);
    });

    it("external server not listening - if the ws constructor succeeds - should asynchronously emit starting", async () => {
      const harn = harness({ server: emitter({}) });
      const listener = harn.createServerListener();
      harn.server.start();
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    it("external server not listening - if the ws constructor fails - should asynchronously emit starting, stopping, stopped", async () => {
      const err = new Error("SOME_ERROR");
      const harn = harness({ server: emitter({}) }, () => {
        throw err;
      });

      const listener = harn.createServerListener();

      const eventOrder = [];
      ["starting", "stopping", "stop"].forEach(evt => {
        harn.server.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      harn.server.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: Could not initialize WebSocket server."
      );
      expect(listener.stopping.mock.calls[0][0].wsError).toBe(err);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: Could not initialize WebSocket server."
      );
      expect(listener.stop.mock.calls[0][0].wsError).toBe(err);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "stopping", "stop"]);
    });

    it("external server already listening - if the ws constructor succeeds - should asynchronously emit starting and start", async () => {
      const harn = harness({ server: emitter({ listening: true }) });
      const listener = harn.createServerListener();
      harn.server.start();
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      const eventOrder = [];
      ["starting", "start"].forEach(evt => {
        harn.server.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.nextTick();

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

    it("external server already listening - if the ws constructor fails - should asynchronously emit starting, stopping, stop", async () => {
      const err = new Error("SOME_ERROR");
      const harn = harness({ server: emitter({ listening: true }) }, () => {
        throw err;
      });

      const listener = harn.createServerListener();

      const eventOrder = [];
      ["starting", "stopping", "stop"].forEach(evt => {
        harn.server.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      harn.server.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: Could not initialize WebSocket server."
      );
      expect(listener.stopping.mock.calls[0][0].wsError).toBe(err);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: Could not initialize WebSocket server."
      );
      expect(listener.stop.mock.calls[0][0].wsError).toBe(err);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "stopping", "stop"]);
    });

    it("noServer mode - if the ws constructor succeeds - should asynchronously emit starting and start", async () => {
      const harn = harness({ noServer: true });
      const listener = harn.createServerListener();
      harn.server.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      const eventOrder = [];
      ["starting", "start"].forEach(evt => {
        harn.server.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.nextTick();

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

    it("noServer mode - if the ws constructor fails - should asynchronously emit starting and start", async () => {
      const err = new Error("SOME_ERROR");
      const harn = harness({ noServer: true }, () => {
        throw err;
      });

      const listener = harn.createServerListener();

      const eventOrder = [];
      ["starting", "stopping", "stop"].forEach(evt => {
        harn.server.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      harn.server.start();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(1);
      expect(listener.starting.mock.calls[0].length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: Could not initialize WebSocket server."
      );
      expect(listener.stopping.mock.calls[0][0].wsError).toBe(err);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: Could not initialize WebSocket server."
      );
      expect(listener.stop.mock.calls[0][0].wsError).toBe(err);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["starting", "stopping", "stop"]);
    });

    // State

    it("stand-alone server - ws constructor succeeds - should update the state correctly", () => {
      const harn = harness({ port: PORT });
      const newState = harn.getServerState();
      harn.server.start();
      newState._wsServer = {};
      newState._state = "starting";
      expect(harn.server).toHaveState(newState);
    });

    it("stand-alone server - ws constructor throws - should not change the state", () => {
      const harn = harness({ port: PORT }, () => {
        throw new Error("SOME_ERROR");
      });
      const newState = harn.getServerState();
      harn.server.start();
      expect(harn.server).toHaveState(newState);
    });

    it("external server not listening - the ws constructor succeeds - should update the state correctly", () => {
      const harn = harness({ server: emitter({}) });
      const newState = harn.getServerState();
      newState._wsServer = {};
      newState._state = "starting";
      newState._httpHandlers = {
        listening: () => {},
        close: () => {},
        error: () => {}
      };
      newState._httpListeningTimeout = 123;
      harn.server.start();
      expect(harn.server).toHaveState(newState);
    });

    it("external server not listening - the ws constructor throws - should update the state correctly", () => {
      const harn = harness({ server: emitter({}) }, () => {
        throw new Error("SOME_ERROR");
      });
      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopped";
      harn.server.start();
      expect(harn.server).toHaveState(newState);
    });

    it("external server already listening - ws constructor succeeds - should update the state correctly", () => {
      const harn = harness({ server: emitter({ listening: true }) });
      const newState = harn.getServerState();
      newState._wsServer = {};
      newState._state = "started";
      newState._httpHandlers = {
        listening: () => {},
        close: () => {},
        error: () => {}
      };
      newState._httpPollingInterval = 123;
      harn.server.start();
      expect(harn.server).toHaveState(newState);
    });

    it("external server already listening - ws constructor fails - should update the state correctly", () => {
      const harn = harness({ server: emitter({ listening: true }) }, () => {
        throw new Error("SOME_ERROR");
      });
      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopped";
      harn.server.start();
      expect(harn.server).toHaveState(newState);
    });

    it("noServer mode - ws constructor succeeds - should update the state correctly", () => {
      const harn = harness({ noServer: true });
      const newState = harn.getServerState();
      newState._wsServer = {};
      newState._state = "started";
      harn.server.start();
      expect(harn.server).toHaveState(newState);
    });

    it("noServer mode - ws constructor fails - should update the state correctly", () => {
      const harn = harness({ noServer: true }, () => {
        throw new Error("SOME_ERROR");
      });
      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopped";
      harn.server.start();
      expect(harn.server).toHaveState(newState);
    });

    // Function calls

    it("stand-alone server - should initialize the ws server with correct options", () => {
      // Manual mock constructor - can't use jest.fn()
      const opts = { port: PORT };
      let calledTimes = 0;
      let calledOpts = null;
      const WsCon = function wsCon(o) {
        emitter(this);
        calledTimes += 1;
        calledOpts = o;
      };
      const harn = harness(opts, WsCon);
      harn.server.start();
      expect(calledTimes).toBe(1);
      expect(calledOpts).toBeInstanceOf(Object);
      expect(_.keys(calledOpts).sort()).toEqual(["handleProtocols", "port"]);
      expect(calledOpts.handleProtocols).toBeInstanceOf(Function);
      expect(calledOpts.port).toBe(PORT);
    });

    it("external server - should initialize the ws server with correct options", () => {
      // Manual mock constructor - can't use jest.fn()
      const s = emitter({ listening: true });
      const opts = { server: s };
      let calledTimes = 0;
      let calledOpts = null;
      const WsCon = function wsCon(o) {
        emitter(this);
        calledTimes += 1;
        calledOpts = o;
      };
      const harn = harness(opts, WsCon);
      harn.server.start();
      expect(calledTimes).toBe(1);
      expect(calledOpts).toBeInstanceOf(Object);
      expect(_.keys(calledOpts).sort()).toEqual(["handleProtocols", "server"]);
      expect(calledOpts.handleProtocols).toBeInstanceOf(Function);
      expect(calledOpts.server).toBe(s);
    });

    it("noServer mode - should initialize the ws server with correct options", () => {
      // Manual mock constructor - can't use jest.fn()
      const opts = { noServer: true };
      let calledTimes = 0;
      let calledOpts = null;
      const WsCon = function wsCon(o) {
        emitter(this);
        calledTimes += 1;
        calledOpts = o;
      };
      const harn = harness(opts, WsCon);
      harn.server.start();
      expect(calledTimes).toBe(1);
      expect(calledOpts).toBeInstanceOf(Object);
      expect(_.keys(calledOpts).sort()).toEqual([
        "handleProtocols",
        "noServer"
      ]);
      expect(calledOpts.handleProtocols).toBeInstanceOf(Function);
      expect(calledOpts.noServer).toBe(true);
    });

    // Calls on ws - N/A (initialized on start())

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks)

    describe("the httpListeningTimeout callback", () => {
      it("should asynchronously emit stopping and then stop", async () => {
        const harn = harness({ server: emitter({}) });
        harn.server.start();
        const wsServer = harn.getWs();

        await asyncUtil.nextTick(); // Move past queued events

        const listener = harn.createServerListener();

        jest.advanceTimersByTime(serverConfig.httpListeningMs);

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.nextTick();

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(1);
        expect(listener.stopping.mock.calls[0].length).toBe(1);
        expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.stopping.mock.calls[0][0].message).toBe(
          "FAILURE: The external http server did not start within the allocated time."
        );
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        listener.mockClear();

        wsServer.close.mock.calls[0][0](); // Run ws.close() callback

        await asyncUtil.nextTick();

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(1);
        expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.stop.mock.calls[0][0].message).toBe(
          "FAILURE: The external http server did not start within the allocated time."
        );
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      it("should update the state appropriately", async () => {
        const harn = harness({ server: emitter({}) });
        harn.server.start();
        const wsServer = harn.getWs();

        const newState = harn.getServerState();

        jest.advanceTimersByTime(serverConfig.httpListeningMs);

        newState._wsServer = null;
        newState._state = "stopping";
        newState._httpHandlers = null;
        newState._httpListeningTimeout = null;
        expect(harn.server).toHaveState(newState);

        wsServer.close.mock.calls[0][0](); // Run ws.close() callback

        newState._state = "stopped";
        expect(harn.server).toHaveState(newState);
      });

      it("should call ws.close()", () => {
        const harn = harness({ server: emitter({}) });
        harn.server.start();
        const wsServer = harn.getWs();

        jest.advanceTimersByTime(serverConfig.httpListeningMs);

        expect(wsServer.close.mock.calls.length).toBe(1);
        expect(wsServer.close.mock.calls[0].length).toBe(1);
        expect(wsServer.close.mock.calls[0][0]).toBeInstanceOf(Function);
        expect(wsServer.handleUpgrade.mock.calls.length).toBe(0);
      });
    });

    // Return value

    it("should return nothing", () => {
      const harn = harness({ port: PORT });
      expect(harn.server.start()).toBeUndefined();
    });
  });
});

describe("The server.stop() function", () => {
  describe("can fail", () => {
    it("should throw if the state is not started", () => {
      const harn = harness({ port: PORT });
      expect(() => {
        harn.server.stop();
      }).toThrow(new Error("INVALID_STATE: The server is not started."));
    });
  });

  describe("can succeed", () => {
    // Events

    it("stand-alone server - should asynchronously emit disconnect for both clients, then stopping", async () => {
      // Set up two connected clients
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs1 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs1);
      const mockWs2 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs2);

      await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

      const listener = harn.createServerListener();

      const mockWs = harn.getWs();
      mockWs.mockClear();

      harn.server.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      const eventOrder = [];
      ["stopping", "disconnect"].forEach(evt => {
        harn.server.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(2);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(listener.disconnect.mock.calls[1].length).toBe(2);
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[1][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[1][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "disconnect", "stopping"]);

      listener.mockClear();

      const cb = mockWs.close.mock.calls[0][0];
      cb();

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    it("external server - should asynchronously emit disconnect for both clients, then stopping", async () => {
      // Set up two connected clients
      const harn = harness({ server: emitter({ listening: true }) });
      harn.server.start();
      const mockWs1 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs1);
      const mockWs2 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs2);

      await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

      const listener = harn.createServerListener();

      harn.server.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      const eventOrder = [];
      ["stopping", "disconnect"].forEach(evt => {
        harn.server.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(2);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(listener.disconnect.mock.calls[1].length).toBe(2);
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[1][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[1][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "disconnect", "stopping"]);
    });

    it("noServer mode - should asynchronously emit disconnect for both clients, then stopping", async () => {
      // Set up two connected clients
      const harn = harness({ noServer: true });
      harn.server.start();
      const mockWs1 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs1);
      const mockWs2 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs2);

      await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

      const listener = harn.createServerListener();

      harn.server.stop();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      const eventOrder = [];
      ["stopping", "disconnect"].forEach(evt => {
        harn.server.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(2);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(listener.disconnect.mock.calls[1].length).toBe(2);
      expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
      expect(listener.disconnect.mock.calls[1][1]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[1][1].message).toBe(
        "STOPPING: The server is stopping."
      );
      expect(eventOrder).toEqual(["disconnect", "disconnect", "stopping"]);
    });

    // State

    it("stand-alone server - should update the state appropriately", async () => {
      // Set up two connected clients
      // One with no heartbeat timeout and one with
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs1 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs1);
      jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
      const mockWs2 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs2);

      await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopping";
      newState._wsClients = {};
      newState._heartbeatIntervals = {};
      newState._heartbeatTimeouts = {};
      harn.server.stop();
      expect(harn.server).toHaveState(newState);
    });

    it("external http server - should update the state appropriately", async () => {
      // Set up two connected clients
      const harn = harness({ server: emitter({ listening: true }) });
      harn.server.start();
      const mockWs1 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs1);
      jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
      const mockWs2 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs2);

      await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopping";
      newState._wsClients = {};
      newState._heartbeatIntervals = {};
      newState._heartbeatTimeouts = {};
      newState._httpHandlers = null;
      newState._httpPollingInterval = null;
      harn.server.stop();
      expect(harn.server).toHaveState(newState);
    });

    it("noServer mode - should update the state appropriately", async () => {
      // Set up two connected clients
      const harn = harness({ noServer: true });
      harn.server.start();
      const mockWs1 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs1);
      jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
      const mockWs2 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs2);

      await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopping";
      newState._wsClients = {};
      newState._heartbeatIntervals = {};
      newState._heartbeatTimeouts = {};
      harn.server.stop();
      expect(harn.server).toHaveState(newState);
    });

    // Function calls

    it("should call clearInterval on client heartbeat intervals and http polling interval", async () => {
      // Set up two connected clients
      // One with no heartbeat timeout and one with
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs1 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs1);
      jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
      const mockWs2 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs2);

      await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

      clearInterval.mockClear();
      harn.server.stop();
      expect(clearInterval.mock.calls.length).toBe(3);
      expect(clearInterval.mock.calls[0].length).toBe(1);
      expect(clearInterval.mock.calls[1].length).toBe(1);
      expect(check.integer(clearInterval.mock.calls[1][0])).toBe(true);
      expect(clearInterval.mock.calls[2].length).toBe(1);
      expect(check.integer(clearInterval.mock.calls[2][0])).toBe(true);
    });

    it("should call clearTimeout on client heartbeat timeout and http listening timeout", async () => {
      // Set up two connected clients
      // One with no heartbeat timeout and one with
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs1 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs1);
      jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
      const mockWs2 = harn.createMockWs();
      harn.getWs().emit("connection", mockWs2);

      await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

      clearTimeout.mockClear();
      harn.server.stop();
      expect(clearTimeout.mock.calls.length).toBe(2);
    });

    // Calls on ws

    it("stand-alone server - should call ws.close()", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");

      await asyncUtil.nextTick(); // Get past emitted events

      const prevWs = harn.getWs();
      harn.getWs().mockClear();
      harn.server.stop();
      expect(prevWs.close.mock.calls.length).toBe(1);
      expect(prevWs.close.mock.calls[0].length).toBe(1);
      expect(prevWs.close.mock.calls[0][0]).toBeInstanceOf(Function);
      expect(prevWs.handleUpgrade.mock.calls.length).toBe(0);
    });

    it("external http server - should call ws.close()", async () => {
      const harn = harness({ server: emitter({ listening: true }) });
      harn.server.start();

      await asyncUtil.nextTick(); // Get past emitted events

      const prevWs = harn.getWs();
      harn.getWs().mockClear();
      harn.server.stop();
      expect(prevWs.close.mock.calls.length).toBe(1);
      expect(prevWs.close.mock.calls[0].length).toBe(1);
      expect(prevWs.close.mock.calls[0][0]).toBeInstanceOf(Function);
      expect(prevWs.handleUpgrade.mock.calls.length).toBe(0);
    });

    it("noServer mode - should call ws.close()", async () => {
      const harn = harness({ noServer: true });
      harn.server.start();

      await asyncUtil.nextTick(); // Get past emitted events

      const prevWs = harn.getWs();
      harn.getWs().mockClear();
      harn.server.stop();
      expect(prevWs.close.mock.calls.length).toBe(1);
      expect(prevWs.close.mock.calls[0].length).toBe(1);
      expect(prevWs.close.mock.calls[0][0]).toBeInstanceOf(Function);
      expect(prevWs.handleUpgrade.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks)

    describe("on ws.close() callback - stand-alone server", () => {
      it("should emit stop next tick", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");

        const prevWs = harn.getWs();
        harn.getWs().mockClear();

        harn.server.stop();

        await asyncUtil.nextTick(); // Move past queued events

        const listener = harn.createServerListener();
        prevWs.close.mock.calls[0][0](); // fire ws.close callback

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.nextTick();

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      it("should update the state appropriately", async () => {
        // Set up two connected clients
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const mockWs1 = harn.createMockWs();
        harn.getWs().emit("connection", mockWs1);
        jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
        const mockWs2 = harn.createMockWs();
        harn.getWs().emit("connection", mockWs2);

        await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

        const prevWs = harn.getWs();
        harn.getWs().mockClear();

        harn.server.stop();

        const newState = harn.getServerState();
        newState._state = "stopped";

        prevWs.close.mock.calls[0][0](); // fire ws.close callback

        expect(harn.server).toHaveState(newState);
      });
    });

    describe("on ws.close() callback - external server", () => {
      it("should emit stop next tick", async () => {
        const harn = harness({ server: emitter({ listening: true }) });
        harn.server.start();

        const prevWs = harn.getWs();
        harn.getWs().mockClear();

        harn.server.stop();

        await asyncUtil.nextTick(); // Move past queued events

        const listener = harn.createServerListener();
        prevWs.close.mock.calls[0][0](); // fire ws.close callback

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.nextTick();

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      it("should update the state appropriately", async () => {
        // Set up two connected clients
        const harn = harness({ server: emitter({ listening: true }) });
        harn.server.start();
        const mockWs1 = harn.createMockWs();
        harn.getWs().emit("connection", mockWs1);
        jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
        const mockWs2 = harn.createMockWs();
        harn.getWs().emit("connection", mockWs2);

        await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

        const prevWs = harn.getWs();
        harn.getWs().mockClear();

        harn.server.stop();

        const newState = harn.getServerState();
        newState._state = "stopped";

        prevWs.close.mock.calls[0][0](); // fire ws.close callback

        expect(harn.server).toHaveState(newState);
      });
    });

    describe("on ws.close() callback - noServer mode", () => {
      it("should emit stop next tick", async () => {
        const harn = harness({ noServer: true });
        harn.server.start();

        const prevWs = harn.getWs();
        harn.getWs().mockClear();

        harn.server.stop();

        await asyncUtil.nextTick(); // Move past queued events

        const listener = harn.createServerListener();
        prevWs.close.mock.calls[0][0](); // fire ws.close callback

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.nextTick();

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      it("should update the state appropriately", async () => {
        // Set up two connected clients
        const harn = harness({ noServer: true });
        harn.server.start();
        const mockWs1 = harn.createMockWs();
        harn.getWs().emit("connection", mockWs1);
        jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
        const mockWs2 = harn.createMockWs();
        harn.getWs().emit("connection", mockWs2);

        await asyncUtil.nextTick(); // Get past transport starting, started, and connect events

        const prevWs = harn.getWs();
        harn.getWs().mockClear();

        harn.server.stop();

        const newState = harn.getServerState();
        newState._state = "stopped";

        prevWs.close.mock.calls[0][0](); // fire ws.close callback

        expect(harn.server).toHaveState(newState);
      });
    });

    // Return value

    it("should return nothing", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      expect(harn.server.stop()).toBe(undefined);
    });
  });
});

describe("The server.send() function", () => {
  describe("can fail", () => {
    it("should throw on invalid client id", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      expect(() => {
        harn.server.send(123, "msg");
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid client id or message."));
    });

    it("should throw on invalid message", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      expect(() => {
        harn.server.send("cid", 123);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid client id or message."));
    });

    it("should throw if server not started", () => {
      const harn = harness({ port: PORT });
      expect(() => {
        harn.server.send("cid", "msg");
      }).toThrow(new Error("INVALID_STATE: The server is not started."));
    });

    it("should throw if client not connected", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      expect(() => {
        harn.server.send("cid", "msg");
      }).toThrow(new Error("INVALID_STATE: The client is not connected."));
    });
  });

  describe("can succeed", () => {
    describe("the ws.send() callback may return success", () => {
      // Events

      it("should emit nothing next tick", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        await asyncUtil.nextTick(); // Move past starting, start, connect events

        const listener = harn.createServerListener();
        harn.server.send(cid, "msg");
        const cb = ws.send.mock.calls[0][1];
        cb();

        await asyncUtil.nextTick();

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      // State

      it("should not change the state", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        await asyncUtil.nextTick(); // Move past queued events

        const newState = harn.getServerState();
        harn.server.send(cid, "msg");
        const cb = ws.send.mock.calls[0][1];
        cb();
        expect(harn.server).toHaveState(newState);
      });

      // Function calls - N/A

      // Calls on ws

      it("should call ws ws.send()", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        ws.mockClear();

        await asyncUtil.nextTick(); // Move past queued events

        harn.server.send(cid, "msg");
        const cb = ws.send.mock.calls[0][1];
        cb();
        expect(ws.ping.mock.calls.length).toBe(0);
        expect(ws.send.mock.calls.length).toBe(1);
        expect(ws.send.mock.calls[0].length).toBe(2);
        expect(ws.send.mock.calls[0][0]).toBe("msg");
        expect(check.function(ws.send.mock.calls[0][1])).toBe(true);
        expect(ws.close.mock.calls.length).toBe(0);
        expect(ws.terminate.mock.calls.length).toBe(0);
      });

      // Outbound callbacks - N/A

      // Inbound callbacks (events, state, ws, callbacks) - N/A

      // Return value

      it("should return nothing", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        await asyncUtil.nextTick(); // Move past queued events

        expect(harn.server.send(cid, "msg")).toBe(undefined);
      });
    });

    describe("the ws.send() callback may return failure and the client is still present", () => {
      // Events

      it("should emit disconnect next tick", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        await asyncUtil.nextTick(); // Move past queued events

        const listener = harn.createServerListener();
        harn.server.send(cid, "msg");
        const cb = ws.send.mock.calls[0][1];
        const err = new Error("SOME_ERROR");
        cb(err);

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.nextTick();

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
          "FAILURE: WebSocket transmission failed."
        );
        expect(listener.disconnect.mock.calls[0][1].wsError).toBe(err);
      });

      // State

      it("should update the state appropriately", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        await asyncUtil.nextTick(); // Move past queued events

        const newState = harn.getServerState();
        delete newState._wsClients[cid];
        delete newState._heartbeatIntervals[cid];
        harn.server.send(cid, "msg");
        const cb = ws.send.mock.calls[0][1];
        cb(new Error("SOME_ERROR"));
        expect(harn.server).toHaveState(newState);
      });

      // Function calls - N/A

      // Calls on ws

      it("should call ws ws.send() and ws.terminate()", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        await asyncUtil.nextTick(); // Move past queued events

        ws.mockClear();
        harn.server.send(cid, "msg");
        const cb = ws.send.mock.calls[0][1];
        cb(new Error("SOME_ERROR"));
        expect(ws.ping.mock.calls.length).toBe(0);
        expect(ws.send.mock.calls.length).toBe(1);
        expect(ws.send.mock.calls[0].length).toBe(2);
        expect(ws.send.mock.calls[0][0]).toBe("msg");
        expect(check.function(ws.send.mock.calls[0][1])).toBe(true);
        expect(ws.close.mock.calls.length).toBe(0);
        expect(ws.terminate.mock.calls.length).toBe(1);
        expect(ws.terminate.mock.calls[0].length).toBe(0);
      });

      // Outbound callbacks - N/A

      // Inbound callbacks (events, state, ws, callbacks) - N/A

      // Return value

      it("should return nothing", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        await asyncUtil.nextTick(); // Move past queued events

        expect(harn.server.send(cid, "msg")).toBe(undefined);
      });
    });

    describe("the ws.send() callback may return failure and the client has disconnected", () => {
      // Events

      it("should emit nothing next tick", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        await asyncUtil.nextTick(); // Move past queued events

        harn.server.send(cid, "msg");
        const cb = ws.send.mock.calls[0][1];

        ws.readyState = ws.CLOSING;
        ws.emit("close");

        await asyncUtil.nextTick(); // Move past queued events

        const err = new Error("SOME_ERROR");
        const listener = harn.createServerListener();
        cb(err);

        await asyncUtil.nextTick();

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      // State

      it("should not change the state", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        await asyncUtil.nextTick(); // Move past queued events

        harn.server.send(cid, "msg");
        const cb = ws.send.mock.calls[0][1];

        ws.readyState = ws.CLOSING;
        ws.emit("close");

        const newState = harn.getServerState();
        cb(new Error("SOME_ERROR"));
        expect(harn.server).toHaveState(newState);
      });

      // Function calls - N/A

      // Calls on ws

      it("should call ws ws.send() only", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const ws = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", ws);

        await asyncUtil.nextTick(); // Move past queued events

        ws.mockClear();
        harn.server.send(cid, "msg");
        const cb = ws.send.mock.calls[0][1];

        ws.readyState = ws.CLOSING;
        ws.emit("close");

        cb(new Error("SOME_ERROR"));
        expect(ws.ping.mock.calls.length).toBe(0);
        expect(ws.send.mock.calls.length).toBe(1);
        expect(ws.send.mock.calls[0].length).toBe(2);
        expect(ws.send.mock.calls[0][0]).toBe("msg");
        expect(check.function(ws.send.mock.calls[0][1])).toBe(true);
        expect(ws.close.mock.calls.length).toBe(0);
        expect(ws.terminate.mock.calls.length).toBe(0);
      });

      // Outbound callbacks - N/A

      // Inbound callbacks (events, state, ws, callbacks) - N/A

      // Return value - N/A
    });
  });
});

describe("The server.disconnect() function", () => {
  describe("can fail", () => {
    it("should throw on invalid client id", () => {
      const harn = harness({ port: PORT });
      expect(() => {
        harn.server.disconnect(123);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid client id."));
    });

    it("should throw on invalid error arg", () => {
      const harn = harness({ port: PORT });
      expect(() => {
        harn.server.disconnect("cid", "junk");
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid error."));
    });

    it("should throw if server not started", () => {
      const harn = harness({ port: PORT });
      expect(() => {
        harn.server.disconnect("cid", new Error("SOMETHING"));
      }).toThrow(new Error("INVALID_STATE: The server is not started."));
    });

    it("should throw if client not connected", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      expect(() => {
        harn.server.disconnect("cid");
      }).toThrow(new Error("INVALID_STATE: The client is not connected."));
    });
  });

  describe("can succeed", () => {
    // Events

    it("should emit disconnect on next tick - no error", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.getWs().emit("connection", mockWs);

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();
      harn.server.disconnect(cid);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
    });

    it("should emit disconnect on next tick - with error", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.getWs().emit("connection", mockWs);
      const err = new Error("SOMETHING");

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();
      harn.server.disconnect(cid, err);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(2);
      expect(listener.disconnect.mock.calls[0][0]).toBe(cid);
      expect(listener.disconnect.mock.calls[0][1]).toBe(err);
    });

    // State

    it("should update the state appropriately", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.getWs().emit("connection", mockWs);
      jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

      await asyncUtil.nextTick(); // Move past queued events

      const newState = harn.getServerState();
      delete newState._wsClients[cid];
      delete newState._heartbeatIntervals[cid];
      delete newState._heartbeatTimeouts[cid];
      harn.server.disconnect(cid);
      expect(harn.server).toHaveState(newState);
    });

    // Function calls

    it("should clear the heartbeat interval and timeout", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.getWs().emit("connection", mockWs);
      jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

      await asyncUtil.nextTick(); // Move past queued events

      clearInterval.mockClear();
      clearTimeout.mockClear();
      harn.server.disconnect(cid);
      expect(clearInterval.mock.calls.length).toBe(1);
      expect(clearInterval.mock.calls[0].length).toBe(1);
      expect(check.integer(clearInterval.mock.calls[0][0])).toBe(true);
      expect(clearTimeout.mock.calls.length).toBe(1);
      expect(clearTimeout.mock.calls[0].length).toBe(1);
      expect(check.integer(clearTimeout.mock.calls[0][0])).toBe(true);
    });

    // Calls on ws

    it("should call socket.close()", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.getWs().emit("connection", mockWs);

      await asyncUtil.nextTick(); // Move past queued events

      harn.server.disconnect(cid);
      expect(mockWs.ping.mock.calls.length).toBe(0);
      expect(mockWs.send.mock.calls.length).toBe(0);
      expect(mockWs.close.mock.calls.length).toBe(1);
      expect(mockWs.close.mock.calls[0].length).toBe(2);
      expect(mockWs.close.mock.calls[0][0]).toBe(1000);
      expect(mockWs.close.mock.calls[0][1]).toBe("");
      expect(mockWs.terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A

    // Return value

    it("should return nothing", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.getWs().emit("connection", mockWs);

      await asyncUtil.nextTick(); // Move past queued events

      expect(harn.server.disconnect(cid)).toBe(undefined);
    });
  });
});

describe("The server.handleUpgrade() function", () => {
  describe("can fail", () => {
    it("should throw on invalid request argument", () => {
      const harn = harness({ noServer: true });
      expect(() => {
        harn.server.handleUpgrade(123, new stream.Duplex(), Buffer.from("abc"));
      }).toThrow(
        new Error("INVALID_ARGUMENT: Invalid request, socket, or head.")
      );
    });

    it("should throw on invalid socket argument", () => {
      const harn = harness({ noServer: true });
      expect(() => {
        harn.server.handleUpgrade(
          new http.IncomingMessage(),
          123,
          Buffer.from("abc")
        );
      }).toThrow(
        new Error("INVALID_ARGUMENT: Invalid request, socket, or head.")
      );
    });

    it("should throw on invalid head argument", () => {
      const harn = harness({ noServer: true });
      expect(() => {
        harn.server.handleUpgrade(
          new http.IncomingMessage(),
          new stream.Duplex(),
          123
        );
      }).toThrow(
        new Error("INVALID_ARGUMENT: Invalid request, socket, or head.")
      );
    });

    it("should throw if transport is not started", () => {
      const harn = harness({ noServer: true });
      expect(() => {
        harn.server.handleUpgrade(
          new http.IncomingMessage(),
          new stream.Duplex(),
          Buffer.from("abc")
        );
      }).toThrow(
        new Error("INVALID_STATE: The transport server is not started.")
      );
    });

    it("should throw if ws is not in noServer mode", () => {
      const harn = harness({ port: 8080 });
      harn.server.start();
      harn.getWs().emit("listening");
      expect(() => {
        harn.server.handleUpgrade(
          new http.IncomingMessage(),
          new stream.Duplex(),
          Buffer.from("abc")
        );
      }).toThrow(
        new Error("INVALID_STATE: The transport is not in noServer mode.")
      );
    });
  });

  describe("can succeed", () => {
    // Events

    it("should emit nothing next tick", async () => {
      const harn = harness({ noServer: true });
      harn.server.start();

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();
      harn.server.handleUpgrade(
        new http.IncomingMessage(),
        new stream.Duplex(),
        Buffer.from("abc")
      );

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    // State

    it("should not change the state", () => {
      const harn = harness({ noServer: true });
      harn.server.start();

      const newState = harn.getServerState();
      harn.server.handleUpgrade(
        new http.IncomingMessage(),
        new stream.Duplex(),
        Buffer.from("abc")
      );
      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws

    it("should call ws.handleUpgrade()", () => {
      const harn = harness({ noServer: true });
      harn.server.start();

      harn.getWs().mockClear();
      const req = new http.IncomingMessage();
      const socket = new stream.Duplex();
      const head = Buffer.from("abc");
      harn.server.handleUpgrade(req, socket, head);
      expect(harn.getWs().close.mock.calls.length).toBe(0);
      expect(harn.getWs().handleUpgrade.mock.calls.length).toBe(1);
      expect(harn.getWs().handleUpgrade.mock.calls[0].length).toBe(4);
      expect(harn.getWs().handleUpgrade.mock.calls[0][0]).toBe(req);
      expect(harn.getWs().handleUpgrade.mock.calls[0][1]).toBe(socket);
      expect(harn.getWs().handleUpgrade.mock.calls[0][2]).toBe(head);
      expect(check.function(harn.getWs().handleUpgrade.mock.calls[0][3])).toBe(
        true
      );
    });

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks)

    describe("The ws.handleUpgrade() callback", () => {
      it("should emit connect next tick", async () => {
        const harn = harness({ noServer: true });
        harn.server.start();
        harn.getWs().mockClear();
        harn.server.handleUpgrade(
          new http.IncomingMessage(),
          new stream.Duplex(),
          Buffer.from("abc")
        );
        const cb = harn.getWs().handleUpgrade.mock.calls[0][3];

        await asyncUtil.nextTick(); // Move past queued events

        const listener = harn.createServerListener();
        cb(harn.createMockWs());

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);

        await asyncUtil.nextTick();

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(1);
        expect(listener.connect.mock.calls[0].length).toBe(1);
        expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      it("should update the state appropriately", async () => {
        const harn = harness({ noServer: true });
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.server.start();
        harn.getWs().mockClear();
        harn.server.handleUpgrade(
          new http.IncomingMessage(),
          new stream.Duplex(),
          Buffer.from("abc")
        );
        const cb = harn.getWs().handleUpgrade.mock.calls[0][3];
        const newState = harn.getServerState();

        cb(harn.createMockWs()); // Do this first to get clientId
        await asyncUtil.nextTick(); // Move past queued events

        newState._wsClients[cid] = {};
        newState._heartbeatIntervals[cid] = 123;
        expect(harn.server).toHaveState(newState);
      });

      it("should do nothing on ws", () => {
        const harn = harness({ noServer: true });
        harn.server.start();
        harn.getWs().mockClear();
        harn.server.handleUpgrade(
          new http.IncomingMessage(),
          new stream.Duplex(),
          Buffer.from("abc")
        );
        const cb = harn.getWs().handleUpgrade.mock.calls[0][3];

        harn.getWs().mockClear();
        const mockWs = harn.createMockWs();
        cb(mockWs);
        expect(harn.getWs().close.mock.calls.length).toBe(0);
        expect(harn.getWs().handleUpgrade.mock.calls.length).toBe(0);

        expect(mockWs.ping.mock.calls.length).toBe(0);
        expect(mockWs.send.mock.calls.length).toBe(0);
        expect(mockWs.close.mock.calls.length).toBe(0);
        expect(mockWs.terminate.mock.calls.length).toBe(0);
      });
    });

    // Return value

    it("should return nothing", () => {
      const harn = harness({ noServer: true });
      harn.server.start();

      harn.getWs().mockClear();
      const req = new http.IncomingMessage();
      const socket = new stream.Duplex();
      const head = Buffer.from("abc");
      expect(harn.server.handleUpgrade(req, socket, head)).toBe(undefined);
    });
  });
});

// State-modifying functions -- triggered by ws, http, or http no longer listening

describe("The server._processServerListening() function", () => {
  // Events

  it("stand-alone mode triggered by ws - should emit start next tick", async () => {
    const harn = harness({ port: PORT });
    harn.server.start();

    await asyncUtil.nextTick(); // Move past queued events

    const listener = harn.createServerListener();
    harn.getWs().emit("listening");

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);

    await asyncUtil.nextTick();

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(1);
    expect(listener.start.mock.calls[0].length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
  });

  it("external server mode triggered by http - should emit start next tick", async () => {
    const httpServer = emitter({});
    const harn = harness({ server: httpServer });
    harn.server.start();

    await asyncUtil.nextTick(); // Move past queued events

    const listener = harn.createServerListener();

    httpServer.emit("listening");

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);

    await asyncUtil.nextTick();

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(1);
    expect(listener.start.mock.calls[0].length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
  });

  // State

  it("stand-alone mode triggered by ws - should change the state to started", () => {
    const harn = harness({ port: PORT });
    harn.server.start();

    const newState = harn.getServerState();
    newState._state = "started";
    harn.getWs().emit("listening");
    expect(harn.server).toHaveState(newState);
  });

  it("external server mode triggered by http - should change the state to started", () => {
    const httpServer = emitter({});
    const harn = harness({ server: httpServer });
    harn.server.start();

    const newState = harn.getServerState();
    newState._state = "started";
    newState._httpListeningTimeout = null;
    newState._httpPollingInterval = 123;

    httpServer.emit("listening");

    expect(harn.server).toHaveState(newState);
  });

  // Function calls

  it("stand-alone mode triggered by ws - should not create http polling interval", () => {
    const harn = harness({ port: PORT });
    harn.server.start();

    setInterval.mockClear();

    harn.getWs().emit("listening");

    expect(setInterval.mock.calls.length).toBe(0);
  });

  it("external server mode triggered by http - should create http polling interval", () => {
    const httpServer = emitter({});
    const harn = harness({ server: httpServer });
    harn.server.start();

    setInterval.mockClear();

    httpServer.emit("listening");

    expect(setInterval.mock.calls.length).toBe(1);
    expect(setInterval.mock.calls[0].length).toBe(2);
    expect(check.function(setInterval.mock.calls[0][0])).toBe(true);
    expect(check.integer(setInterval.mock.calls[0][1])).toBe(true);
  });

  // Calls on ws

  it("stand-alone mode triggered by ws - should do nothing on ws", () => {
    const harn = harness({ port: PORT });
    harn.server.start();

    harn.getWs().mockClear();

    harn.getWs().emit("listening");

    expect(harn.getWs().close.mock.calls.length).toBe(0);
    expect(harn.getWs().handleUpgrade.mock.calls.length).toBe(0);
  });

  it("external server mode triggered by http - should do nothing on ws", () => {
    const httpServer = emitter({});
    const harn = harness({ server: httpServer });
    harn.server.start();

    harn.getWs().mockClear();

    httpServer.emit("listening");

    expect(harn.getWs().close.mock.calls.length).toBe(0);
    expect(harn.getWs().handleUpgrade.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks)

  describe("external server mode - the polling interval callback, if server still listening", () => {
    it("it should emit nothing", async () => {
      const httpServer = emitter({});
      const harn = harness({ server: httpServer });
      harn.server.start();
      httpServer.listening = true;
      httpServer.emit("listening");

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();

      jest.advanceTimersByTime(serverConfig.httpPollingMs);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    it("it should not change the state", async () => {
      const httpServer = emitter({});
      const harn = harness({ server: httpServer });
      harn.server.start();
      httpServer.listening = true;
      httpServer.emit("listening");

      await asyncUtil.nextTick(); // Move past queued events

      const newState = harn.getServerState();

      jest.advanceTimersByTime(serverConfig.httpPollingMs);

      expect(harn.server).toHaveState(newState);
    });

    it("it should do nothing on ws", async () => {
      const httpServer = emitter({});
      const harn = harness({ server: httpServer });
      harn.server.start();
      httpServer.listening = true;
      httpServer.emit("listening");

      await asyncUtil.nextTick(); // Move past queued events

      const wsServer = harn.getWs();
      wsServer.mockClear();

      jest.advanceTimersByTime(serverConfig.httpPollingMs);

      expect(wsServer.close.mock.calls.length).toBe(0);
      expect(wsServer.handleUpgrade.mock.calls.length).toBe(0);
    });
  });

  describe("external server mode - the polling interval callback, if server no longer listening", () => {
    it("it should emit stopping and then stopped", async () => {
      const httpServer = emitter({});
      const harn = harness({ server: httpServer });
      harn.server.start();
      httpServer.listening = true;
      httpServer.emit("listening");

      await asyncUtil.nextTick(); // Move past queued events

      const wsServer = harn.getWs();
      wsServer.mockClear();

      const listener = harn.createServerListener();

      httpServer.listening = false;

      jest.advanceTimersByTime(serverConfig.httpPollingMs);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: The external http server stopped listening."
      );
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      listener.mockClear();

      wsServer.close.mock.calls[0][0](); // Fire ws close callback

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: The external http server stopped listening."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    it("it should update the state appropriately", async () => {
      const httpServer = emitter({});
      const harn = harness({ server: httpServer });
      harn.server.start();
      httpServer.listening = true;
      httpServer.emit("listening");

      const wsServer = harn.getWs();
      wsServer.mockClear();

      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopping";
      newState._httpHandlers = null;
      newState._httpPollingInterval = null;

      httpServer.listening = false;
      jest.advanceTimersByTime(serverConfig.httpPollingMs);

      expect(harn.server).toHaveState(newState);

      wsServer.close.mock.calls[0][0](); // Fire ws close callback

      newState._state = "stopped";
      expect(harn.server).toHaveState(newState);
    });

    it("it should call ws.close", async () => {
      const httpServer = emitter({});
      const harn = harness({ server: httpServer });
      harn.server.start();
      httpServer.listening = true;
      httpServer.emit("listening");

      await asyncUtil.nextTick(); // Move past queued events

      const wsServer = harn.getWs();
      wsServer.mockClear();

      httpServer.listening = false;

      jest.advanceTimersByTime(serverConfig.httpPollingMs);

      expect(wsServer.close.mock.calls.length).toBe(1);
      expect(wsServer.close.mock.calls[0].length).toBe(1);
      expect(check.function(wsServer.close.mock.calls[0][0])).toBe(true);
      expect(wsServer.handleUpgrade.mock.calls.length).toBe(0);
    });
  });
});

describe("The server._processServerClose() function", () => {
  // Events

  it("stand-alone server - should asynchronously emit client disconnects, stopping, and stopped", async () => {
    // Set up two connected clients
    // One with no heartbeat timeout and one with
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");

    await asyncUtil.nextTick(); // Move past queued events

    const mockWs1 = harn.createMockWs();
    let cid1;
    harn.server.once("connect", c => {
      cid1 = c;
    });
    harn.getWs().emit("connection", mockWs1);

    await asyncUtil.nextTick(); // Move past queued events

    const mockWs2 = harn.createMockWs();
    let cid2;
    harn.server.once("connect", c => {
      cid2 = c;
    });
    harn.getWs().emit("connection", mockWs2);

    await asyncUtil.nextTick(); // Move past queued events

    const eventOrder = [];
    ["stopping", "stop", "disconnect"].forEach(evt => {
      harn.server.on(evt, () => {
        eventOrder.push(evt);
      });
    });

    const listener = harn.createServerListener();
    harn.getWs().emit("close");

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);

    await asyncUtil.nextTick();

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
    expect(listener.disconnect.mock.calls.length).toBe(2);
    expect(listener.disconnect.mock.calls[0].length).toBe(2);
    expect(listener.disconnect.mock.calls[1].length).toBe(2);
    expect(
      (cid1 === listener.disconnect.mock.calls[0][0] &&
        cid2 === listener.disconnect.mock.calls[1][0]) ||
        (cid1 === listener.disconnect.mock.calls[1][0] &&
          cid2 === listener.disconnect.mock.calls[0][0])
    ).toBe(true);
    expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(listener.disconnect.mock.calls[0][1].message).toBe(
      "STOPPING: The server is stopping."
    );
    expect(listener.disconnect.mock.calls[1][1]).toBeInstanceOf(Error);
    expect(listener.disconnect.mock.calls[1][1].message).toBe(
      "STOPPING: The server is stopping."
    );
    expect(eventOrder).toEqual([
      "disconnect",
      "disconnect",
      "stopping",
      "stop"
    ]);
  });

  it("external http server - should asynchronously emit client disconnects, stopping, and stopped", async () => {
    // Set up two connected clients
    // One with no heartbeat timeout and one with
    const httpServer = emitter({ listening: true });
    const harn = harness({ server: httpServer });
    harn.server.start();
    harn.getWs().emit("listening");

    await asyncUtil.nextTick(); // Move past queued events

    const mockWs1 = harn.createMockWs();
    let cid1;
    harn.server.once("connect", c => {
      cid1 = c;
    });
    harn.getWs().emit("connection", mockWs1);

    await asyncUtil.nextTick(); // Move past queued events

    const mockWs2 = harn.createMockWs();
    let cid2;
    harn.server.once("connect", c => {
      cid2 = c;
    });
    harn.getWs().emit("connection", mockWs2);

    await asyncUtil.nextTick(); // Move past queued events

    const eventOrder = [];
    ["stopping", "stop", "disconnect"].forEach(evt => {
      harn.server.on(evt, () => {
        eventOrder.push(evt);
      });
    });

    const wsServer = harn.getWs();

    const listener = harn.createServerListener();
    httpServer.emit("close");

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);

    await asyncUtil.nextTick();

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(1);
    expect(listener.stopping.mock.calls[0].length).toBe(1);
    expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(listener.stopping.mock.calls[0][0].message).toBe(
      "FAILURE: The server stopped unexpectedly."
    );
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(2);
    expect(listener.disconnect.mock.calls[0].length).toBe(2);
    expect(listener.disconnect.mock.calls[1].length).toBe(2);
    expect(
      (cid1 === listener.disconnect.mock.calls[0][0] &&
        cid2 === listener.disconnect.mock.calls[1][0]) ||
        (cid1 === listener.disconnect.mock.calls[1][0] &&
          cid2 === listener.disconnect.mock.calls[0][0])
    ).toBe(true);
    expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(listener.disconnect.mock.calls[0][1].message).toBe(
      "STOPPING: The server is stopping."
    );
    expect(listener.disconnect.mock.calls[1][1]).toBeInstanceOf(Error);
    expect(listener.disconnect.mock.calls[1][1].message).toBe(
      "STOPPING: The server is stopping."
    );
    expect(eventOrder).toEqual(["disconnect", "disconnect", "stopping"]);

    listener.mockClear();
    wsServer.close.mock.calls[0][0](); // Fire ws close callback

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);

    await asyncUtil.nextTick();

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls[0].length).toBe(1);
    expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(listener.stop.mock.calls[0][0].message).toBe(
      "FAILURE: The server stopped unexpectedly."
    );
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
  });

  // State

  it("stand-alone server - should update the state appropriately", () => {
    // Set up two connected clients
    // One with no heartbeat timeout and one with
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");
    const mockWs1 = harn.createMockWs();
    harn.getWs().emit("connection", mockWs1);
    const mockWs2 = harn.createMockWs();
    harn.getWs().emit("connection", mockWs2);
    jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

    const newState = harn.getServerState();
    newState._wsServer = null;
    newState._state = "stopped";
    newState._wsClients = {};
    newState._heartbeatIntervals = {};
    newState._heartbeatTimeouts = {};
    harn.getWs().emit("close");
    expect(harn.server).toHaveState(newState);
  });

  it("external server - should update the state appropriately", () => {
    const httpServer = emitter({ listening: true });
    const harn = harness({ server: httpServer });
    harn.server.start();
    harn.getWs().emit("listening");

    const wsServer = harn.getWs();

    const newState = harn.getServerState();
    newState._wsServer = null;
    newState._state = "stopping"; // Ws server still closing
    newState._httpHandlers = null;
    newState._httpPollingInterval = null;
    httpServer.emit("close");
    expect(harn.server).toHaveState(newState);

    wsServer.close.mock.calls[0][0](); // Run ws.close() callback

    newState._state = "stopped";
    expect(harn.server).toHaveState(newState);
  });

  // Function calls

  it("should call clearInterval and clearTimeout for heartbeats, http listening timeout, http polling interval", () => {
    // Set up two connected clients
    // One with no heartbeat timeout and one with
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");
    const mockWs1 = harn.createMockWs();
    harn.getWs().emit("connection", mockWs1);
    jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
    const mockWs2 = harn.createMockWs();
    harn.getWs().emit("connection", mockWs2);

    clearInterval.mockClear();
    clearTimeout.mockClear();
    harn.getWs().emit("close");
    expect(clearInterval.mock.calls.length).toBe(3);
    expect(clearTimeout.mock.calls.length).toBe(2);
  });

  // Calls on ws

  it("stand-alone server - should call nothing on ws", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");

    const wsServer = harn.getWs();
    wsServer.mockClear();

    harn.getWs().emit("close");

    expect(wsServer.close.mock.calls.length).toBe(0);
    expect(wsServer.handleUpgrade.mock.calls.length).toBe(0);
  });

  it("external server - should call ws.close", () => {
    const httpServer = emitter({ listening: true });
    const harn = harness({ server: httpServer });
    harn.server.start();

    const wsServer = harn.getWs();
    wsServer.mockClear();

    httpServer.emit("close");

    expect(wsServer.close.mock.calls.length).toBe(1);
    expect(wsServer.close.mock.calls[0].length).toBe(1);
    expect(check.function(wsServer.close.mock.calls[0][0])).toBe(true);
    expect(wsServer.handleUpgrade.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks) - N/A
});

describe("The server._processServerError() function", () => {
  describe("If the transport was starting", () => {
    // Events

    it("stand-alone server - should asynchronously emit stopping and stop", async () => {
      const err = new Error("SOME_ERROR");
      // Start a transport server and have ws emit error
      const harn = harness({ port: PORT });
      harn.server.start();

      await asyncUtil.nextTick(); // Move past starting event

      const listener = harn.createServerListener();

      harn.getWs().emit("error", err);

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
        eventOrder.push(evt);
      });

      await asyncUtil.nextTick();

      // Emit stopping and stop asynchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: Failed to listen for connections."
      );
      expect(listener.stopping.mock.calls[0][0].wsError).toBe(err);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: Failed to listen for connections."
      );
      expect(listener.stop.mock.calls[0][0].wsError).toBe(err);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(eventOrder).toEqual(["stopping", "stop"]);
    });

    it("external server - should asynchronously emit stopping and stop", async () => {
      const err = new Error("SOME_ERROR");
      const httpServer = emitter({ listening: false });
      const harn = harness({ server: httpServer });
      harn.server.start();

      await asyncUtil.nextTick(); // Move past starting event

      const wsServer = harn.getWs();

      const listener = harn.createServerListener();

      httpServer.emit("error", err);

      // Emit nothing synchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      // Emit stopping and stop asynchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: Failed to listen for connections."
      );
      expect(listener.stopping.mock.calls[0][0].wsError).toBe(err);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      listener.mockClear();

      wsServer.close.mock.calls[0][0](); // Fire ws close callback

      // Emit nothing synchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      // Emit stopping and stop asynchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: Failed to listen for connections."
      );
      expect(listener.stop.mock.calls[0][0].wsError).toBe(err);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });
    // State

    it("stand-alone server - should update the state appropriately", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();

      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopped";

      harn.getWs().emit("error", new Error("SOME_ERROR"));

      expect(harn.server).toHaveState(newState);
    });

    it("external server - should update the state appropriately", async () => {
      const httpServer = emitter({ listening: false });
      const harn = harness({ server: httpServer });
      harn.server.start();

      const wsServer = harn.getWs();

      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopping";
      newState._httpHandlers = null;
      newState._httpListeningTimeout = null;

      httpServer.emit("error", new Error("SOME_ERROR"));

      expect(harn.server).toHaveState(newState);

      wsServer.close.mock.calls[0][0](); // Run ws.close() callback

      newState._state = "stopped";

      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws

    it("stand-alone server - should do nothing on ws", async () => {
      // Start a transport server and have ws emit error
      const harn = harness({ port: PORT });
      harn.server.start();

      const prevWs = harn.getWs();
      prevWs.mockClear();

      harn.getWs().emit("error", new Error("SOME_ERROR"));

      expect(prevWs.close.mock.calls.length).toBe(0);
      expect(prevWs.handleUpgrade.mock.calls.length).toBe(0);
    });

    it("external server - should call ws.close()", async () => {
      const httpServer = emitter({ listening: false });
      const harn = harness({ server: httpServer });
      harn.server.start();

      const prevWs = harn.getWs();
      prevWs.mockClear();

      httpServer.emit("error", new Error("SOME_ERROR"));

      expect(prevWs.close.mock.calls.length).toBe(1);
      expect(prevWs.close.mock.calls[0].length).toBe(1);
      expect(check.function(prevWs.close.mock.calls[0][0])).toBe(true);
      expect(prevWs.handleUpgrade.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A
  });

  describe("If the transport was started - error comes after close event", () => {
    // Events

    it("stand-alone server - should emit nothing", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");

      const wsServer = harn.getWs();
      harn.getWs().emit("close");

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();

      wsServer.emit("error", new Error("SOME_ERROR"));

      // Emit nothing synchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      // Emit nothing asynchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    it("external server - should emit nothing", async () => {
      const httpServer = emitter({ listening: true });
      const harn = harness({ server: httpServer });
      harn.server.start();

      httpServer.emit("close");

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();

      httpServer.emit("error", new Error("SOME_ERROR"));

      // Emit nothing synchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      // Emit nothing asynchronously
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    // State

    it("stand-alone server - should not change the state", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");

      const wsServer = harn.getWs();
      harn.getWs().emit("close");

      const newState = harn.getServerState();

      wsServer.emit("error", new Error("SOME_ERROR"));

      expect(harn.server).toHaveState(newState);
    });

    it("external server - should not change the state", async () => {
      const httpServer = emitter({ listening: true });
      const harn = harness({ server: httpServer });
      harn.server.start();

      httpServer.emit("close");

      const newState = harn.getServerState();

      httpServer.emit("error", new Error("SOME_ERROR"));

      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws

    it("stand-alone server - should do nothing on ws", async () => {
      // Start a transport server and laterhave ws emit error
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");

      const prevWs = harn.getWs();

      harn.getWs().emit("close");

      prevWs.mockClear();

      prevWs.emit("error", new Error("SOME_ERROR"));

      expect(prevWs.close.mock.calls.length).toBe(0);
      expect(prevWs.handleUpgrade.mock.calls.length).toBe(0);
    });

    it("external server - should do nothing on ws", async () => {
      const httpServer = emitter({ listening: true });
      const harn = harness({ server: httpServer });
      harn.server.start();

      const prevWs = harn.getWs();

      httpServer.emit("close");

      prevWs.mockClear();

      httpServer.emit("error", new Error("SOME_ERROR"));

      expect(prevWs.close.mock.calls.length).toBe(0);
      expect(prevWs.handleUpgrade.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A
  });

  describe("If the transport was started - error comes before close event", () => {
    // Events

    it("stand-alone server - should asynchronously emit stopping and then stopped", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");

      const wsServer = harn.getWs();

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();

      const eventOrder = [];
      ["stopping", "stop"].forEach(evt => {
        harn.server.on(evt, () => {
          eventOrder.push(evt);
        });
      });

      wsServer.emit("error", new Error("SOME_ERROR"));

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

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

    it("external server - should asynchronously emit stopping and then stopped", async () => {
      const httpServer = emitter({ listening: true });
      const harn = harness({ server: httpServer });
      harn.server.start();

      await asyncUtil.nextTick(); // Move past queued events

      const wsServer = harn.getWs();

      const listener = harn.createServerListener();

      httpServer.emit("error", new Error("SOME_ERROR"));

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(1);
      expect(listener.stopping.mock.calls[0].length).toBe(1);
      expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stopping.mock.calls[0][0].message).toBe(
        "FAILURE: Failed to listen for connections."
      );
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      listener.mockClear();

      wsServer.close.mock.calls[0][0](); // Call ws close callback

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(1);
      expect(listener.stop.mock.calls[0].length).toBe(1);
      expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.stop.mock.calls[0][0].message).toBe(
        "FAILURE: Failed to listen for connections."
      );
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    // State

    it("stand-alone server - should update the state appropriately", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");

      const wsServer = harn.getWs();

      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopped";

      wsServer.emit("error", new Error("SOME_ERROR"));

      expect(harn.server).toHaveState(newState);
    });

    it("external server - should update the state appropriately", async () => {
      const httpServer = emitter({ listening: true });
      const harn = harness({ server: httpServer });
      harn.server.start();

      const wsServer = harn.getWs();

      const newState = harn.getServerState();
      newState._wsServer = null;
      newState._state = "stopping";
      newState._httpHandlers = null;
      newState._httpPollingInterval = null;

      httpServer.emit("error", new Error("SOME_ERROR"));

      expect(harn.server).toHaveState(newState);

      wsServer.close.mock.calls[0][0](); // Call ws.close() callback

      newState._state = "stopped";
      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws

    it("stand-alone server - should do nothing on ws", async () => {
      // Start a transport server and laterhave ws emit error
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");

      const prevWs = harn.getWs();
      prevWs.mockClear();

      harn.getWs().emit("error", new Error("SOME_ERROR"));

      expect(prevWs.close.mock.calls.length).toBe(0);
      expect(prevWs.handleUpgrade.mock.calls.length).toBe(0);
    });

    it("external server - should call ws.close()", async () => {
      const httpServer = emitter({ listening: true });
      const harn = harness({ server: httpServer });
      harn.server.start();

      const prevWs = harn.getWs();

      prevWs.mockClear();

      httpServer.emit("error", new Error("SOME_ERROR"));

      expect(prevWs.close.mock.calls.length).toBe(1);
      expect(prevWs.close.mock.calls[0].length).toBe(1);
      expect(check.function(prevWs.close.mock.calls[0][0])).toBe(true);
      expect(prevWs.handleUpgrade.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A
  });
});

describe("The server._processWsServerConnection() function", () => {
  describe("if heartbeat is enabled", () => {
    // Events

    it("should emit connect next tick", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();
      const mockWs = harn.createMockWs();
      harn.getWs().emit("connection", mockWs);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    // State

    it("should update state appropriately", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");

      // Outside code does not have access to the ws client

      const newState = harn.getServerState();
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.getWs().emit("connection", mockWs);

      await asyncUtil.nextTick();

      newState._wsClients[cid] = harn.server._wsClients[cid]; // Basically checking cid
      newState._heartbeatIntervals[cid] = 123;
      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws - N/A

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks)

    describe("when the heartbeat interval fires", () => {
      it("should emit nothing next tick", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const mockWs = harn.createMockWs();
        harn.getWs().emit("connection", mockWs);

        await asyncUtil.nextTick(); // Move past queued events

        const listener = harn.createServerListener();
        jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

        await asyncUtil.nextTick();

        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      it("should update state appropriately", async () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const mockWs = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.getWs().emit("connection", mockWs);

        await asyncUtil.nextTick(); // Move past queued events

        const newState = harn.getServerState();
        jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
        newState._heartbeatTimeouts[cid] = 123;
        expect(harn.server).toHaveState(newState);
      });

      it("should call wsClient.ping()", () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        harn.getWs().emit("listening");
        const mockWs = harn.createMockWs();
        harn.getWs().emit("connection", mockWs);

        mockWs.mockClear();
        jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);
        expect(mockWs.ping.mock.calls.length).toBe(1);
        expect(mockWs.ping.mock.calls[0].length).toBe(1);
        expect(mockWs.ping.mock.calls[0][0]).toBeInstanceOf(Function);
        expect(mockWs.send.mock.calls.length).toBe(0);
        expect(mockWs.close.mock.calls.length).toBe(0);
        expect(mockWs.terminate.mock.calls.length).toBe(0);
      });

      describe("when the heartbeat timeout fires", () => {
        it("should call ws.terminate(cid)", () => {
          const harn = harness({ port: PORT });
          harn.server.start();
          harn.getWs().emit("listening");
          const mockWs = harn.createMockWs();
          harn.getWs().emit("connection", mockWs);
          jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

          mockWs.mockClear();
          jest.advanceTimersByTime(serverConfig.defaults.heartbeatTimeoutMs);
          expect(mockWs.ping.mock.calls.length).toBe(0);
          expect(mockWs.send.mock.calls.length).toBe(0);
          expect(mockWs.close.mock.calls.length).toBe(0);
          expect(mockWs.terminate.mock.calls.length).toBe(1);
          expect(mockWs.terminate.mock.calls[0].length).toBe(0);
        });
      });

      describe("when the ws.ping() callback is invoked", () => {
        describe("if the ping frame was written successfully", () => {
          it("should emit nothing", () => {
            const harn = harness({ port: PORT });
            harn.server.start();
            harn.getWs().emit("listening");
            const mockWs = harn.createMockWs();
            harn.getWs().emit("connection", mockWs);

            jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

            const pingCb = mockWs.ping.mock.calls[0][0];
            const listener = harn.createServerListener();
            pingCb();
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(0);
          });

          it("should not change the state", () => {
            const harn = harness({ port: PORT });
            harn.server.start();
            harn.getWs().emit("listening");
            const mockWs = harn.createMockWs();
            harn.getWs().emit("connection", mockWs);

            jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

            const pingCb = mockWs.ping.mock.calls[0][0];
            const newState = harn.getServerState();
            pingCb();
            expect(harn.server).toHaveState(newState);
          });

          it("should do nothing on ws", () => {
            const harn = harness({ port: PORT });
            harn.server.start();
            harn.getWs().emit("listening");
            const mockWs = harn.createMockWs();
            harn.getWs().emit("connection", mockWs);

            jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

            const pingCb = mockWs.ping.mock.calls[0][0];
            mockWs.mockClear();
            pingCb();
            expect(mockWs.ping.mock.calls.length).toBe(0);
            expect(mockWs.send.mock.calls.length).toBe(0);
            expect(mockWs.close.mock.calls.length).toBe(0);
            expect(mockWs.terminate.mock.calls.length).toBe(0);
          });
        });

        describe("if there was an error writing the ping frame and the client is still there", () => {
          it("should emit disconnect next tick", async () => {
            const harn = harness({ port: PORT });
            harn.server.start();
            harn.getWs().emit("listening");
            let clientId;
            harn.server.once("connect", cid => {
              clientId = cid;
            });
            const mockWs = harn.createMockWs();
            harn.getWs().emit("connection", mockWs);

            await asyncUtil.nextTick(); // Move past queued events

            jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

            const pingCb = mockWs.ping.mock.calls[0][0];
            const listener = harn.createServerListener();
            const err = new Error("SOME_ERROR");
            pingCb(err);

            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(0);

            await asyncUtil.nextTick();

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
            expect(listener.disconnect.mock.calls[0][1].wsError).toBe(err);
          });

          it("should update the state appropriately", async () => {
            const harn = harness({ port: PORT });
            harn.server.start();
            harn.getWs().emit("listening");
            let clientId;
            harn.server.once("connect", cid => {
              clientId = cid;
            });
            const mockWs = harn.createMockWs();
            harn.getWs().emit("connection", mockWs);

            await asyncUtil.nextTick(); // Move past queued events

            jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

            const pingCb = mockWs.ping.mock.calls[0][0];
            const newState = harn.getServerState();
            delete newState._wsClients[clientId];
            delete newState._heartbeatIntervals[clientId];
            delete newState._heartbeatTimeouts[clientId];
            pingCb(new Error("SOME_ERROR"));
            expect(harn.server).toHaveState(newState);
          });

          it("should call ws.terminate()", () => {
            const harn = harness({ port: PORT });
            harn.server.start();
            harn.getWs().emit("listening");
            const mockWs = harn.createMockWs();
            harn.getWs().emit("connection", mockWs);

            jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

            const pingCb = mockWs.ping.mock.calls[0][0];
            mockWs.mockClear();
            pingCb(new Error("SOME_ERROR"));
            expect(mockWs.ping.mock.calls.length).toBe(0);
            expect(mockWs.send.mock.calls.length).toBe(0);
            expect(mockWs.close.mock.calls.length).toBe(0);
            expect(mockWs.terminate.mock.calls.length).toBe(1);
            expect(mockWs.terminate.mock.calls[0].length).toBe(0);
          });
        });

        describe("if there was an error writing the ping frame and the client was already disconnected", () => {
          it("should emit disconnect", () => {
            const harn = harness({ port: PORT });
            harn.server.start();
            harn.getWs().emit("listening");
            const mockWs = harn.createMockWs();
            harn.getWs().emit("connection", mockWs);

            jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

            mockWs.readyState = mockWs.CLOSING;
            mockWs.emit("close");

            const pingCb = mockWs.ping.mock.calls[0][0];
            const listener = harn.createServerListener();
            const err = new Error("SOME_ERROR");
            pingCb(err);
            expect(listener.starting.mock.calls.length).toBe(0);
            expect(listener.start.mock.calls.length).toBe(0);
            expect(listener.stopping.mock.calls.length).toBe(0);
            expect(listener.stop.mock.calls.length).toBe(0);
            expect(listener.connect.mock.calls.length).toBe(0);
            expect(listener.message.mock.calls.length).toBe(0);
            expect(listener.disconnect.mock.calls.length).toBe(0);
          });

          it("should not change the state", () => {
            const harn = harness({ port: PORT });
            harn.server.start();
            harn.getWs().emit("listening");
            const mockWs = harn.createMockWs();
            harn.getWs().emit("connection", mockWs);

            jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

            mockWs.readyState = mockWs.CLOSING;
            mockWs.emit("close");

            const pingCb = mockWs.ping.mock.calls[0][0];
            const newState = harn.getServerState();
            pingCb(new Error("SOME_ERROR"));
            expect(harn.server).toHaveState(newState);
          });

          it("should do nothing on ws", () => {
            const harn = harness({ port: PORT });
            harn.server.start();
            harn.getWs().emit("listening");
            const mockWs = harn.createMockWs();
            harn.getWs().emit("connection", mockWs);

            jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

            mockWs.readyState = mockWs.CLOSING;
            mockWs.emit("close");

            const pingCb = mockWs.ping.mock.calls[0][0];
            mockWs.mockClear();
            pingCb(new Error("SOME_ERROR"));
            expect(mockWs.ping.mock.calls.length).toBe(0);
            expect(mockWs.send.mock.calls.length).toBe(0);
            expect(mockWs.close.mock.calls.length).toBe(0);
            expect(mockWs.terminate.mock.calls.length).toBe(0);
          });
        });
      });
    });
  });

  describe("if heartbeat is disabled", () => {
    // Events

    it("should emit connect next tick", async () => {
      const harn = harness({ port: PORT, heartbeatIntervalMs: 0 });
      harn.server.start();
      harn.getWs().emit("listening");

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();
      const mockWs = harn.createMockWs();
      harn.getWs().emit("connection", mockWs);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(1);
      expect(listener.connect.mock.calls[0].length).toBe(1);
      expect(check.string(listener.connect.mock.calls[0][0])).toBe(true);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    // State

    it("should update state appropriately", async () => {
      const harn = harness({ port: PORT, heartbeatIntervalMs: 0 });
      harn.server.start();
      harn.getWs().emit("listening");

      // Outside code does not have access to the ws client object

      const newState = harn.getServerState();
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.getWs().emit("connection", mockWs);

      await asyncUtil.nextTick(); // Move past queued events

      newState._wsClients[cid] = harn.server._wsClients[cid]; // Basically checking cid
      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws - N/A

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A
  });
});

describe("The server._processWsClientMessage() function", () => {
  describe("if the message was a string", () => {
    // Events

    it("should emit message next tick", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.getWs().emit("connection", mockWs);

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();
      mockWs.emit("message", "some_msg");

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(1);
      expect(listener.message.mock.calls[0].length).toBe(2);
      expect(listener.message.mock.calls[0][0]).toBe(cid);
      expect(listener.message.mock.calls[0][1]).toBe("some_msg");
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    // State

    it("should not change the state", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs = harn.createMockWs();
      harn.getWs().emit("connection", mockWs);

      const newState = harn.getServerState();
      mockWs.emit("message", "some_msg");
      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws - N/A

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A
  });

  describe("if the message was not a string", () => {
    // Events

    it("should emit disconnect next tick", async () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.getWs().emit("connection", mockWs);

      await asyncUtil.nextTick(); // Move past queued events

      const listener = harn.createServerListener();
      mockWs.emit("message", 123);

      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);

      await asyncUtil.nextTick();

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
    });

    // State

    it("should update the state appropriately", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      harn.getWs().emit("listening");
      const mockWs = harn.createMockWs();
      harn.getWs().emit("connection", mockWs);

      const newState = harn.getServerState();
      newState._wsClients = {};
      newState._heartbeatIntervals = {};
      newState._heartbeatTimeouts = {};
      mockWs.emit("message", 123);
      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws - N/A

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A
  });
});

describe("The server._processWsClientPong() function", () => {
  // Events

  it("should emit nothing next tick", async () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");
    const mockWs = harn.createMockWs();
    harn.getWs().emit("connection", mockWs);
    jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

    await asyncUtil.nextTick(); // Move past queued events

    const listener = harn.createServerListener();
    mockWs.emit("pong");

    await asyncUtil.nextTick();

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
  });

  // State

  it("should update the state appropriately", async () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");
    const mockWs = harn.createMockWs();
    let cid;
    harn.server.once("connect", c => {
      cid = c;
    });
    harn.getWs().emit("connection", mockWs);

    await asyncUtil.nextTick(); // Move past queued events

    jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

    const newState = harn.getServerState();
    mockWs.emit("pong");
    delete newState._heartbeatTimeouts[cid];
    expect(harn.server).toHaveState(newState);
  });

  // Function calls

  it("should call clearTimeout()", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");
    const mockWs = harn.createMockWs();
    harn.getWs().emit("connection", mockWs);
    jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

    clearTimeout.mockClear();
    mockWs.emit("pong");
    expect(clearTimeout.mock.calls.length).toBe(1);
    expect(clearTimeout.mock.calls[0].length).toBe(1);
    expect(check.integer(clearTimeout.mock.calls[0][0])).toBe(true);
  });

  // Calls on ws

  it("should do nothing on ws", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");
    const mockWs = harn.createMockWs();
    harn.getWs().emit("connection", mockWs);
    jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

    harn.getWs().mockClear();
    mockWs.emit("pong");
    expect(harn.getWs().close.mock.calls.length).toBe(0);
    expect(harn.getWs().handleUpgrade.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks) - N/A
});

describe("The server._processWsClientClose() function", () => {
  // Events

  it("should emit disconnect next tick", async () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");
    const mockWs = harn.createMockWs();
    let cid;
    harn.server.once("connect", c => {
      cid = c;
    });
    harn.getWs().emit("connection", mockWs);

    await asyncUtil.nextTick(); // Move past queued events

    const listener = harn.createServerListener();
    mockWs.readyState = mockWs.CLOSING;
    mockWs.emit("close");

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);

    await asyncUtil.nextTick();

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
  });

  // State

  it("should update the state appropriately", async () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");
    const mockWs = harn.createMockWs();
    let cid;
    harn.server.once("connect", c => {
      cid = c;
    });
    harn.getWs().emit("connection", mockWs);

    await asyncUtil.nextTick(); // Move past queued events

    jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

    const newState = harn.getServerState();

    mockWs.readyState = mockWs.CLOSING;
    mockWs.emit("close");

    delete newState._wsClients[cid];
    delete newState._heartbeatIntervals[cid];
    delete newState._heartbeatTimeouts[cid];
    expect(harn.server).toHaveState(newState);
  });

  // Function calls

  it("should call clearInterval and clearTimeout", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");
    const mockWs = harn.createMockWs();
    harn.getWs().emit("connection", mockWs);
    jest.advanceTimersByTime(serverConfig.defaults.heartbeatIntervalMs);

    clearInterval.mockClear();
    clearTimeout.mockClear();

    mockWs.readyState = mockWs.CLOSING;
    mockWs.emit("close");

    expect(clearInterval.mock.calls.length).toBe(1);
    expect(clearInterval.mock.calls[0].length).toBe(1);
    expect(check.integer(clearInterval.mock.calls[0][0])).toBe(true);
    expect(clearTimeout.mock.calls.length).toBe(1);
    expect(clearTimeout.mock.calls[0].length).toBe(1);
    expect(check.integer(clearTimeout.mock.calls[0][0])).toBe(true);
  });

  // Calls on ws

  it("should do nothing on ws", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");
    const mockWs = harn.createMockWs();
    harn.getWs().emit("connection", mockWs);

    harn.getWs().mockClear();

    mockWs.readyState = mockWs.CLOSING;
    mockWs.emit("close");

    expect(harn.getWs().close.mock.calls.length).toBe(0);
    expect(harn.getWs().handleUpgrade.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks) - N/A
});

describe("The server._processWsClientError() function", () => {
  // Trivial
});

// State-getting functionality

describe("The server.state() function", () => {
  // Events

  it("should emit nothing next tick", async () => {
    const harn = harness({ port: PORT });
    const listener = harn.createServerListener();
    harn.server.state();

    await asyncUtil.nextTick();

    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
  });

  // State

  it("should not change the state", () => {
    const harn = harness({ port: PORT });

    const newState = harn.getServerState();
    harn.server.state();
    expect(harn.server).toHaveState(newState);
  });

  // Function calls - N/A

  // Calls on ws

  it("should do nothing on ws", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    harn.getWs().emit("listening");

    harn.getWs().mockClear();
    harn.server.state();
    expect(harn.getWs().close.mock.calls.length).toBe(0);
    expect(harn.getWs().handleUpgrade.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks) - N/A

  // Return value

  it("should return the state", () => {
    const harn = harness({ port: PORT });
    expect(harn.server.state()).toBe("stopped");
  });
});

// Stateless functionality

describe("The server._handleProtocols() function", () => {
  // Events - N/A

  // State - N/A

  // Function calls - N/A

  // Calls on ws - N/A

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks) - N/A

  // Return value

  it("should return correctly if feedme is present - only", () => {
    const harn = harness({ port: PORT });
    expect(harn.server._processHandleProtocols(["feedme"])).toBe("feedme");
  });

  it("should return correctly if feedme is present - first", () => {
    const harn = harness({ port: PORT });
    expect(harn.server._processHandleProtocols(["feedme", "something"])).toBe(
      "feedme"
    );
  });

  it("should return correctly if feedme is present - last", () => {
    const harn = harness({ port: PORT });
    expect(harn.server._processHandleProtocols(["something", "feedme"])).toBe(
      "feedme"
    );
  });

  it("should return correctly if feedme is present - mid", () => {
    const harn = harness({ port: PORT });
    expect(
      harn.server._processHandleProtocols([
        "something",
        "feedme",
        "somethingelse"
      ])
    ).toBe("feedme");
  });

  it("should return correctly if feedme is present - preserve alternative case", () => {
    const harn = harness({ port: PORT });
    expect(harn.server._processHandleProtocols(["FeEdMe"])).toBe("FeEdMe");
  });

  it("should return correctly if feedme is missing", () => {
    const harn = harness({ port: PORT });
    expect(
      harn.server._processHandleProtocols(["something", "somethingelse"])
    ).toBe(false);
  });

  // Ws always passes at least one protocol element
});

// Internal functions - tested as part of outward-facing API
