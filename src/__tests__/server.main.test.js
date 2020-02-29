import _ from "lodash";
import check from "check-types";
import emitter from "component-emitter";
import server from "../server.main";
import config from "../server.config";

/*

Testing strategy

The ws module is mocked -- these are unit tests only. The integration tests that
are run on the build ensure that the transport plays nicely with ws.

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

1. State-modifying functionality
  Triggered by library
    server()
    server.start()
    server.stop()
    server.send(cid, msg)
    server.disconnect(cid, [err])
  Triggered by ws
    _processWsServerListening()
    _processWsServerClose()
    _processWsServerConnection()
    _processWsClientMessage()
    _processWsClientPong()
    _processWsClientClose()

2. State-getting functionality
    .state()

*/

const PORT = 3000;
const EPSILON = 1;

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
      this.mockClear = () => {
        this.close.mockClear();
      };
      h.ws = this;
    };
  }

  h.server = server(constructor, options);
  return h;
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
    terminate: jest.fn()
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

  // Match
  return { pass: true };
};

expect.extend({ toHaveState });

// Harness tests

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
          heartbeatIntervalMs: config.defaults.heartbeatIntervalMs,
          heartbeatTimeoutMs: config.defaults.heartbeatTimeoutMs
        }
      });
    });

    it("should have the correct state - custom options", () => {
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
        }
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

    it("should emit nothing this tick", () => {
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
    });

    // State

    it("should update the state correctly", () => {
      const harn = harness({ port: PORT });
      const newState = harn.getServerState();
      harn.server.start();
      newState._state = "starting";
      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws - N/A (not initialized until next tick)

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks)

    it("should initialize the ws server with correct options", () => {
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
      jest.advanceTimersByTime(EPSILON);
      expect(calledTimes).toBe(1);
      expect(calledOpts).toBe(opts);
    });

    describe("on next tick, if ws constructor throws", () => {
      it("should emit appropriately", () => {
        // eslint-disable-next-line prefer-arrow-callback
        const harn = harness({ port: PORT }, function c() {
          throw new Error("SOME_ERROR");
        });
        harn.server.start();
        const listener = harn.createServerListener();
        jest.advanceTimersByTime(EPSILON);
        expect(listener.starting.mock.calls.length).toBe(1);
        expect(listener.starting.mock.calls[0].length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(1);
        expect(listener.stopping.mock.calls[0].length).toBe(1);
        expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.stopping.mock.calls[0][0].message).toBe(
          "FAILURE: Could not initialize WebSocket server."
        );
        expect(listener.stopping.mock.calls[0][0].wsError).toBeInstanceOf(
          Error
        );
        expect(listener.stopping.mock.calls[0][0].wsError.message).toBe(
          "SOME_ERROR"
        );
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(1);
        expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.stop.mock.calls[0][0].message).toBe(
          "FAILURE: Could not initialize WebSocket server."
        );
        expect(listener.stop.mock.calls[0][0].wsError).toBeInstanceOf(Error);
        expect(listener.stop.mock.calls[0][0].wsError.message).toBe(
          "SOME_ERROR"
        );
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      it("should update the state appropriately", () => {
        // eslint-disable-next-line prefer-arrow-callback
        const harn = harness({ port: PORT }, function c() {
          throw new Error("SOME_ERROR");
        });
        harn.server.start();
        const newState = harn.getServerState();
        jest.advanceTimersByTime(EPSILON);
        newState._state = "stopped";
        expect(harn.server).toHaveState(newState);
      });
    });

    describe("on next tick, if ws constructor is successful", () => {
      it("should emit appropriately", () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        jest.advanceTimersByTime(EPSILON);
        const listener = harn.createServerListener();
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      it("should update the state appropriately", () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        const newState = harn.getServerState();
        jest.advanceTimersByTime(EPSILON);
        newState._wsServer = {};
        newState._state = "starting";
        expect(harn.server).toHaveState(newState);
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
    let harn;
    beforeEach(() => {
      // Set up two connected clients
      // One with no heartbeat timeout and one with
      harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs1 = harn.createMockWs();
      harn.ws.emit("connection", mockWs1);
      jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);
      const mockWs2 = harn.createMockWs();
      harn.ws.emit("connection", mockWs2);
    });

    // Events

    it("should emit nothing this tick", () => {
      const listener = harn.createServerListener();
      harn.server.stop();
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    // State

    it("should update the state appropriately", () => {
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

    it("should call clearInterval on client heartbeat", () => {
      clearInterval.mockClear();
      harn.server.stop();
      expect(clearInterval.mock.calls.length).toBe(2);
      expect(clearInterval.mock.calls[0].length).toBe(1);
      expect(check.integer(clearInterval.mock.calls[0][0])).toBe(true);
      expect(clearInterval.mock.calls[1].length).toBe(1);
      expect(check.integer(clearInterval.mock.calls[1][0])).toBe(true);
    });

    it("should call clearTimeout on client heartbeat timeout", () => {
      clearTimeout.mockClear();
      harn.server.stop();
      expect(clearTimeout.mock.calls.length).toBe(1);
      expect(clearTimeout.mock.calls[0].length).toBe(1);
      expect(check.integer(clearTimeout.mock.calls[0][0])).toBe(true);
    });

    // Calls on ws

    it("should call ws.close()", () => {
      harn.ws.mockClear();
      harn.server.stop();
      expect(harn.ws.close.mock.calls.length).toBe(1);
      expect(harn.ws.close.mock.calls[0].length).toBe(1);
      expect(harn.ws.close.mock.calls[0][0]).toBeInstanceOf(Function);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks)

    describe("on ws.close() callback", () => {
      it("should emit disconnect for both clients, then stopping, stop", () => {
        harn.ws.mockClear();
        harn.server.stop();
        const listener = harn.createServerListener();
        harn.ws.close.mock.calls[0][0](); // fire ws.close callback
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(1);
        expect(listener.stopping.mock.calls[0].length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(1);
        expect(listener.stop.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(2);
        expect(listener.disconnect.mock.calls[0].length).toBe(2);
        expect(check.string(listener.disconnect.mock.calls[0][0])).toBe(true);
        expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
        expect(listener.disconnect.mock.calls[0][1].message).toBe(
          "STOPPING: The server is stopping."
        );
      });

      it("should update the state appropriately", () => {
        harn.ws.mockClear();
        harn.server.stop();
        const newState = harn.getServerState();
        newState._state = "stopped";
        harn.ws.close.mock.calls[0][0](); // fire ws.close callback
        expect(harn.server).toHaveState(newState);
      });
    });

    // Return value

    it("should return nothing", () => {
      expect(harn.server.stop()).toBe(undefined);
    });
  });
});

describe("The server.send() function", () => {
  describe("can fail", () => {
    it("should throw on invalid client id", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      expect(() => {
        harn.server.send(123, "msg");
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid client id or message."));
    });

    it("should throw on invalid message", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
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
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      expect(() => {
        harn.server.send("cid", "msg");
      }).toThrow(new Error("INVALID_STATE: The client is not connected."));
    });
  });

  describe("can succeed", () => {
    // Events

    it("should emit nothing", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const ws = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", ws);

      const listener = harn.createServerListener();
      harn.server.send(cid, "msg");
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
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const ws = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", ws);

      const newState = harn.getServerState();
      harn.server.send(cid, "msg");
      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws

    it("should call ws client.send()", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const ws = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", ws);

      ws.mockClear();
      harn.server.send(cid, "msg");
      expect(ws.ping.mock.calls.length).toBe(0);
      expect(ws.send.mock.calls.length).toBe(1);
      expect(ws.send.mock.calls[0].length).toBe(1);
      expect(ws.send.mock.calls[0][0]).toBe("msg");
      expect(ws.close.mock.calls.length).toBe(0);
      expect(ws.terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A

    // Return value

    it("should return nothing", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const ws = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", ws);

      expect(harn.server.send(cid, "msg")).toBe(undefined);
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
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      expect(() => {
        harn.server.disconnect("cid");
      }).toThrow(new Error("INVALID_STATE: The client is not connected."));
    });
  });

  describe("can succeed", () => {
    // Events

    it("should emit nothing this tick", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", mockWs);

      const listener = harn.createServerListener();
      harn.server.disconnect(cid);
      expect(listener.starting.mock.calls.length).toBe(0);
      expect(listener.start.mock.calls.length).toBe(0);
      expect(listener.stopping.mock.calls.length).toBe(0);
      expect(listener.stop.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
    });

    // State

    it("should update the state appropriately", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", mockWs);
      jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);

      const newState = harn.getServerState();
      delete newState._wsClients[cid];
      delete newState._heartbeatIntervals[cid];
      delete newState._heartbeatTimeouts[cid];
      harn.server.disconnect(cid);
      expect(harn.server).toHaveState(newState);
    });

    // Function calls

    it("should clear the heartbeat interval and timeout", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", mockWs);
      jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);

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

    it("should call socket.close()", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", mockWs);

      harn.server.disconnect(cid);
      expect(mockWs.ping.mock.calls.length).toBe(0);
      expect(mockWs.send.mock.calls.length).toBe(0);
      expect(mockWs.close.mock.calls.length).toBe(1);
      expect(mockWs.close.mock.calls[0].length).toBe(2);
      expect(mockWs.close.mock.calls[0][0]).toBe(1000);
      expect(mockWs.close.mock.calls[0][1]).toBe(
        "Connection closed by the server."
      );
      expect(mockWs.terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks)

    describe("on next tick", () => {
      it("should emit disconnect - no error", () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        jest.advanceTimersByTime(EPSILON);
        harn.ws.emit("listening");
        const mockWs = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.ws.emit("connection", mockWs);
        harn.server.disconnect(cid);

        const listener = harn.createServerListener();
        jest.advanceTimersByTime(EPSILON);
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

      it("should emit disconnect - with error", () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        jest.advanceTimersByTime(EPSILON);
        harn.ws.emit("listening");
        const mockWs = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.ws.emit("connection", mockWs);
        const err = new Error("SOMETHING");
        harn.server.disconnect(cid, err);

        const listener = harn.createServerListener();
        jest.advanceTimersByTime(EPSILON);
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
    });

    // Return value

    it("should return nothing", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", mockWs);

      expect(harn.server.disconnect(cid)).toBe(undefined);
    });
  });
});

// State-modifying functions -- triggered by ws

describe("The server._processWsServerListening() function", () => {
  // Events

  it("should emit start", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);

    const listener = harn.createServerListener();
    harn.ws.emit("listening");
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

  it("should change the state to started", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);

    const newState = harn.getServerState();
    newState._state = "started";
    harn.ws.emit("listening");
    expect(harn.server).toHaveState(newState);
  });

  // Function calls - N/A

  // Calls on ws - N/A

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks) - N/A
});

describe("The server._processWsServerClose() function", () => {
  // Events

  it("should emit client disconnects, stopping, and stopped", () => {
    // Set up two connected clients
    // One with no heartbeat timeout and one with
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs1 = harn.createMockWs();
    let cid1;
    harn.server.once("connect", c => {
      cid1 = c;
    });
    harn.ws.emit("connection", mockWs1);
    const mockWs2 = harn.createMockWs();
    let cid2;
    harn.server.once("connect", c => {
      cid2 = c;
    });
    harn.ws.emit("connection", mockWs2);

    // Not checking emit order, but verified disconnect(s), stopping, stop
    // Per requirements

    const listener = harn.createServerListener();
    harn.ws.emit("close");
    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(1);
    expect(listener.stopping.mock.calls[0].length).toBe(1);
    expect(listener.stopping.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(listener.stopping.mock.calls[0][0].message).toBe(
      "FAILURE: The WebSocket server stopped unexpectedly."
    );
    expect(listener.stop.mock.calls.length).toBe(1);
    expect(listener.stop.mock.calls[0].length).toBe(1);
    expect(listener.stop.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(listener.stop.mock.calls[0][0].message).toBe(
      "FAILURE: The WebSocket server stopped unexpectedly."
    );
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(2);
    expect(listener.disconnect.mock.calls[0].length).toBe(2);
    expect(
      _.indexOf([cid1, cid2], listener.disconnect.mock.calls[0][0])
    ).toBeGreaterThanOrEqual(0);
    expect(listener.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
    expect(listener.disconnect.mock.calls[0][1].message).toBe(
      "STOPPING: The server is stopping."
    );
    expect(listener.disconnect.mock.calls[1].length).toBe(2);
    expect(
      _.indexOf([cid1, cid2], listener.disconnect.mock.calls[1][0])
    ).toBeGreaterThanOrEqual(0);
    expect(listener.disconnect.mock.calls[1][1]).toBeInstanceOf(Error);
    expect(listener.disconnect.mock.calls[1][1].message).toBe(
      "STOPPING: The server is stopping."
    );
  });

  // State

  it("should update the state appropriately", () => {
    // Set up two connected clients
    // One with no heartbeat timeout and one with
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs1 = harn.createMockWs();
    harn.ws.emit("connection", mockWs1);
    const mockWs2 = harn.createMockWs();
    harn.ws.emit("connection", mockWs2);
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);

    const newState = harn.getServerState();
    newState._wsServer = null;
    newState._state = "stopped";
    newState._wsClients = {};
    newState._heartbeatIntervals = {};
    newState._heartbeatTimeouts = {};
    harn.ws.emit("close");
    expect(harn.server).toHaveState(newState);
  });

  // Function calls

  it("should call clearInterval and clearTimeout for heartbeats", () => {
    // Set up two connected clients
    // One with no heartbeat timeout and one with
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs1 = harn.createMockWs();
    harn.ws.emit("connection", mockWs1);
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);
    const mockWs2 = harn.createMockWs();
    harn.ws.emit("connection", mockWs2);

    clearInterval.mockClear();
    clearTimeout.mockClear();
    harn.ws.emit("close");
    expect(clearInterval.mock.calls.length).toBe(2);
    expect(clearInterval.mock.calls[0].length).toBe(1);
    expect(check.integer(clearInterval.mock.calls[0][0])).toBe(true);
    expect(clearInterval.mock.calls[1].length).toBe(1);
    expect(check.integer(clearInterval.mock.calls[1][0])).toBe(true);
    expect(clearTimeout.mock.calls.length).toBe(1);
    expect(clearTimeout.mock.calls[0].length).toBe(1);
    expect(check.integer(clearTimeout.mock.calls[0][0])).toBe(true);
  });

  // Calls on ws - N/A

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks) - N/A
});

describe("The server._processWsServerConnection() function", () => {
  describe("if heartbeat is enabled", () => {
    // Events

    it("should emit connect", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");

      const listener = harn.createServerListener();
      const mockWs = harn.createMockWs();
      harn.ws.emit("connection", mockWs);
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

    it("should update state appropriately", () => {
      const harn = harness({ port: PORT });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");

      // Outside code does not have access to the ws client

      const newState = harn.getServerState();
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", mockWs);
      newState._wsClients[cid] = harn.server._wsClients[cid]; // Basically checking cid
      newState._heartbeatIntervals[cid] = 123;
      expect(harn.server).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws - N/A

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks)

    describe("when the heartbeat interval fires", () => {
      it("should emit nothing", () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        jest.advanceTimersByTime(EPSILON);
        harn.ws.emit("listening");
        const mockWs = harn.createMockWs();
        harn.ws.emit("connection", mockWs);

        const listener = harn.createServerListener();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);
        expect(listener.starting.mock.calls.length).toBe(0);
        expect(listener.start.mock.calls.length).toBe(0);
        expect(listener.stopping.mock.calls.length).toBe(0);
        expect(listener.stop.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
      });

      it("should update state appropriately", () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        jest.advanceTimersByTime(EPSILON);
        harn.ws.emit("listening");
        const mockWs = harn.createMockWs();
        let cid;
        harn.server.once("connect", c => {
          cid = c;
        });
        harn.ws.emit("connection", mockWs);

        const newState = harn.getServerState();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);
        newState._heartbeatTimeouts[cid] = 123;
        expect(harn.server).toHaveState(newState);
      });

      it("should call wsClient.ping()", () => {
        const harn = harness({ port: PORT });
        harn.server.start();
        jest.advanceTimersByTime(EPSILON);
        harn.ws.emit("listening");
        const mockWs = harn.createMockWs();
        harn.ws.emit("connection", mockWs);

        mockWs.mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);
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
          jest.advanceTimersByTime(EPSILON);
          harn.ws.emit("listening");
          const mockWs = harn.createMockWs();
          harn.ws.emit("connection", mockWs);
          jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);

          mockWs.mockClear();
          jest.advanceTimersByTime(config.defaults.heartbeatTimeoutMs);
          expect(mockWs.ping.mock.calls.length).toBe(0);
          expect(mockWs.send.mock.calls.length).toBe(0);
          expect(mockWs.close.mock.calls.length).toBe(0);
          expect(mockWs.terminate.mock.calls.length).toBe(1);
          expect(mockWs.terminate.mock.calls[0].length).toBe(0);
        });
      });

      describe("when the ws.ping() callback is invoked", () => {
        it("if the ping frame could not be written and the client is still there, call ws.terminate(cid)", () => {
          const harn = harness({ port: PORT });
          harn.server.start();
          jest.advanceTimersByTime(EPSILON);
          harn.ws.emit("listening");
          const mockWs = harn.createMockWs();
          harn.ws.emit("connection", mockWs);

          jest.advanceTimersByTime(
            config.defaults.heartbeatIntervalMs + EPSILON
          );
          const pingCb = mockWs.ping.mock.calls[0][0];
          mockWs.mockClear();
          pingCb(new Error("SOMETHING"));
          expect(mockWs.ping.mock.calls.length).toBe(0);
          expect(mockWs.send.mock.calls.length).toBe(0);
          expect(mockWs.close.mock.calls.length).toBe(0);
          expect(mockWs.terminate.mock.calls.length).toBe(1);
          expect(mockWs.terminate.mock.calls[0].length).toBe(0);
        });

        it("if the ping frame was written and the client is still there, do nothing", () => {
          const harn = harness({ port: PORT });
          harn.server.start();
          jest.advanceTimersByTime(EPSILON);
          harn.ws.emit("listening");
          const mockWs = harn.createMockWs();
          harn.ws.emit("connection", mockWs);

          jest.advanceTimersByTime(
            config.defaults.heartbeatIntervalMs +
              config.defaults.heartbeatTimeoutMs +
              EPSILON
          );

          const pingCb = mockWs.ping.mock.calls[0][0];
          mockWs.mockClear();
          pingCb();
          expect(mockWs.ping.mock.calls.length).toBe(0);
          expect(mockWs.send.mock.calls.length).toBe(0);
          expect(mockWs.close.mock.calls.length).toBe(0);
          expect(mockWs.terminate.mock.calls.length).toBe(0);
        });

        it("if the ping frame was written but the client was disconnected intentionally, do nothing", () => {
          const harn = harness({ port: PORT });
          harn.server.start();
          jest.advanceTimersByTime(EPSILON);
          harn.ws.emit("listening");
          const mockWs = harn.createMockWs();
          let cid;
          harn.server.once("connect", c => {
            cid = c;
          });
          harn.ws.emit("connection", mockWs);

          jest.advanceTimersByTime(
            config.defaults.heartbeatIntervalMs + EPSILON
          );

          harn.server.disconnect(cid);

          jest.advanceTimersByTime(
            config.defaults.heartbeatTimeoutMs + EPSILON
          );

          const pingCb = mockWs.ping.mock.calls[0][0];
          mockWs.mockClear();
          pingCb();
          expect(mockWs.ping.mock.calls.length).toBe(0);
          expect(mockWs.send.mock.calls.length).toBe(0);
          expect(mockWs.close.mock.calls.length).toBe(0);
          expect(mockWs.terminate.mock.calls.length).toBe(0);
        });

        it("if the ping frame was written but the client disconnected unexpectedly, do nothing", () => {
          const harn = harness({ port: PORT });
          harn.server.start();
          jest.advanceTimersByTime(EPSILON);
          harn.ws.emit("listening");
          const mockWs = harn.createMockWs();
          harn.ws.emit("connection", mockWs);

          jest.advanceTimersByTime(
            config.defaults.heartbeatIntervalMs + EPSILON
          );

          mockWs.emit("close");

          jest.advanceTimersByTime(
            config.defaults.heartbeatTimeoutMs + EPSILON
          );

          const pingCb = mockWs.ping.mock.calls[0][0];
          mockWs.mockClear();
          pingCb();
          expect(mockWs.ping.mock.calls.length).toBe(0);
          expect(mockWs.send.mock.calls.length).toBe(0);
          expect(mockWs.close.mock.calls.length).toBe(0);
          expect(mockWs.terminate.mock.calls.length).toBe(0);
        });
      });
    });
  });

  describe("if heartbeat is disabled", () => {
    // Events

    it("should emit connect", () => {
      const harn = harness({ port: PORT, heartbeatIntervalMs: 0 });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");

      const listener = harn.createServerListener();
      const mockWs = harn.createMockWs();
      harn.ws.emit("connection", mockWs);
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

    it("should update state appropriately", () => {
      const harn = harness({ port: PORT, heartbeatIntervalMs: 0 });
      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");

      // Outside code does not have access to the ws client

      const newState = harn.getServerState();
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", mockWs);
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

    it("should emit message", () => {
      const harn = harness({ port: PORT });
      harn.server.disconnect = jest.fn();

      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", mockWs);

      const listener = harn.createServerListener();
      mockWs.emit("message", "some_msg");
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
      harn.server.disconnect = jest.fn();

      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      harn.ws.emit("connection", mockWs);

      const newState = harn.getServerState();
      mockWs.emit("message", "some_msg");
      expect(harn.server).toHaveState(newState);
    });

    // Function calls

    it("should not call transport.disconnect(...)", () => {
      const harn = harness({ port: PORT });
      harn.server.disconnect = jest.fn();

      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      harn.ws.emit("connection", mockWs);

      mockWs.emit("message", "some_msg");
      expect(harn.server.disconnect.mock.calls.length).toBe(0);
    });

    // Calls on ws - N/A

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A
  });

  describe("if the message was not a string", () => {
    // Events

    it("should emit nothing", () => {
      const harn = harness({ port: PORT });
      harn.server.disconnect = jest.fn();

      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      harn.ws.emit("connection", mockWs);

      const listener = harn.createServerListener();
      mockWs.emit("message", 123);
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
      harn.server.disconnect = jest.fn();

      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      harn.ws.emit("connection", mockWs);

      const newState = harn.getServerState();
      mockWs.emit("message", 123);
      expect(harn.server).toHaveState(newState);
    });

    // Function calls

    it("should call transport.disconnect(...)", () => {
      const harn = harness({ port: PORT });
      harn.server.disconnect = jest.fn();

      harn.server.start();
      jest.advanceTimersByTime(EPSILON);
      harn.ws.emit("listening");
      const mockWs = harn.createMockWs();
      let cid;
      harn.server.once("connect", c => {
        cid = c;
      });
      harn.ws.emit("connection", mockWs);

      mockWs.emit("message", 123);
      expect(harn.server.disconnect.mock.calls.length).toBe(1);
      expect(harn.server.disconnect.mock.calls[0].length).toBe(2);
      expect(harn.server.disconnect.mock.calls[0][0]).toBe(cid);
      expect(harn.server.disconnect.mock.calls[0][1]).toBeInstanceOf(Error);
      expect(harn.server.disconnect.mock.calls[0][1].message).toBe(
        "FAILURE: Received non-string message on WebSocket connection."
      );
    });

    // Calls on ws - N/A

    // Outbound callbacks - N/A

    // Inbound callbacks (events, state, ws, callbacks) - N/A
  });
});

describe("The server._processWsClientPong() function", () => {
  // Events

  it("should emit nothing", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs = harn.createMockWs();
    harn.ws.emit("connection", mockWs);
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);

    const listener = harn.createServerListener();
    mockWs.emit("pong");
    expect(listener.starting.mock.calls.length).toBe(0);
    expect(listener.start.mock.calls.length).toBe(0);
    expect(listener.stopping.mock.calls.length).toBe(0);
    expect(listener.stop.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
  });

  // State

  it("should update the state appropriately", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs = harn.createMockWs();
    let cid;
    harn.server.once("connect", c => {
      cid = c;
    });
    harn.ws.emit("connection", mockWs);
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);

    const newState = harn.getServerState();
    mockWs.emit("pong");
    delete newState._heartbeatTimeouts[cid];
    expect(harn.server).toHaveState(newState);
  });

  // Function calls

  it("should call clearTimeout()", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs = harn.createMockWs();
    harn.ws.emit("connection", mockWs);
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);

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
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs = harn.createMockWs();
    harn.ws.emit("connection", mockWs);
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);

    harn.ws.mockClear();
    mockWs.emit("pong");
    expect(harn.ws.close.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks) - N/A
});

describe("The server._processWsClientClose() function", () => {
  // Events

  it("should emit disconnect", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs = harn.createMockWs();
    let cid;
    harn.server.once("connect", c => {
      cid = c;
    });
    harn.ws.emit("connection", mockWs);

    const listener = harn.createServerListener();
    mockWs.emit("close");
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

  it("should update the state appropriately", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs = harn.createMockWs();
    let cid;
    harn.server.once("connect", c => {
      cid = c;
    });
    harn.ws.emit("connection", mockWs);
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);

    const newState = harn.getServerState();
    mockWs.emit("close");
    delete newState._wsClients[cid];
    delete newState._heartbeatIntervals[cid];
    delete newState._heartbeatTimeouts[cid];
    expect(harn.server).toHaveState(newState);
  });

  // Function calls

  it("should call clearInterval and clearTimeout if heartbeat outstanding", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs = harn.createMockWs();
    harn.ws.emit("connection", mockWs);
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs + EPSILON);

    clearInterval.mockClear();
    clearTimeout.mockClear();
    mockWs.emit("close");
    expect(clearInterval.mock.calls.length).toBe(1);
    expect(clearInterval.mock.calls[0].length).toBe(1);
    expect(check.integer(clearInterval.mock.calls[0][0])).toBe(true);
    expect(clearTimeout.mock.calls.length).toBe(1);
    expect(clearTimeout.mock.calls[0].length).toBe(1);
    expect(check.integer(clearTimeout.mock.calls[0][0])).toBe(true);
  });

  it("should call clearInterval only if no heartbeat outstanding", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs = harn.createMockWs();
    harn.ws.emit("connection", mockWs);

    clearInterval.mockClear();
    clearTimeout.mockClear();
    mockWs.emit("close");
    expect(clearInterval.mock.calls.length).toBe(1);
    expect(clearInterval.mock.calls[0].length).toBe(1);
    expect(check.integer(clearInterval.mock.calls[0][0])).toBe(true);
    expect(clearTimeout.mock.calls.length).toBe(0);
  });

  // Calls on ws

  it("should do nothing on ws", () => {
    const harn = harness({ port: PORT });
    harn.server.start();
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");
    const mockWs = harn.createMockWs();
    harn.ws.emit("connection", mockWs);

    harn.ws.mockClear();
    mockWs.emit("close");
    expect(harn.ws.close.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks) - N/A
});

// State-getting functionality

describe("The server.state() function", () => {
  // Events

  it("should emit nothing", () => {
    const harn = harness({ port: PORT });

    const listener = harn.createServerListener();
    harn.server.state();
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
    jest.advanceTimersByTime(EPSILON);
    harn.ws.emit("listening");

    harn.ws.mockClear();
    harn.server.state();
    expect(harn.ws.close.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks (events, state, ws, callbacks) - N/A

  // Return value

  it("should return the state", () => {
    const harn = harness({ port: PORT });
    expect(harn.server.state()).toBe("stopped");
  });
});
