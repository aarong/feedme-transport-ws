import _ from "lodash";
import check from "check-types";
import emitter from "component-emitter";
import client from "../client.main";
import config from "../client.config";

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
  ._wsClient
  ._wsPreviousState
  ._state
  ._address
  ._protocols
  ._options
  ._heartbeatInterval
  ._heartbeatTimeout

1. State-modifying functionality
  Triggered by library
    client()
    client.connect()
    client.disconnect([err])
    client.send(cid, msg)
  Triggered by ws
    client._processWsOpen()
    client._processWsMessage()
    client._processWsPong()
    client._processWsClose()
    client._processWsError()

2. State-getting functionality
    .state()

*/

jest.useFakeTimers();

// Harness

const harnessProto = {};

const harness = function harness(...args) {
  // Arguments: address, protocols, options, wsConstructor
  // Last three are optional

  const h = Object.create(harnessProto);

  // Create mock wsConstructor (if not overridden)
  let constructor;
  if (args.length === 4) {
    constructor = args[3]; // eslint-disable-line prefer-destructuring
  } else {
    constructor = function c() {
      emitter(this);
      this.ping = jest.fn();
      this.send = jest.fn();
      this.close = jest.fn();
      this.terminate = jest.fn();
      this.mockClear = () => {
        this.ping.mockClear();
        this.send.mockClear();
        this.close.mockClear();
        this.terminate.mockClear();
      };
      this.CONNECTING = 0;
      this.OPEN = 1;
      this.CLOSING = 2;
      this.CLOSED = 3;
      this.readyState = this.CONNECTING;
    };
  }

  if (args.length === 1) {
    h.client = client(constructor, args[0]);
  } else if (args.length === 2) {
    h.client = client(constructor, args[0], args[1]);
  } else {
    h.client = client(constructor, args[0], args[1], args[2], args[3]);
  }
  return h;
};

harnessProto.getWs = function getWs() {
  // The ws instance changes over time, so you can't store it as a property of the harness
  return this.client._wsClient;
};

harnessProto.makeWsConnecting = function makeWsConnecting() {
  this.client.connect();
};

harnessProto.makeWsConnected = function makeWsConnected() {
  this.client.connect();
  this.getWs().readyState = this.getWs().OPEN;
  this.getWs().emit("open");
};

harnessProto.makeWsDisconnecting = function makeWsDisconnecting() {
  this.client.connect();
  this.getWs().readyState = this.getWs().OPEN;
  this.getWs().emit("open");
  this.client.disconnect();
  this.getWs().readyState = this.getWs().CLOSING;
};

harnessProto.makeWsDisconnected = function makeWsDisconnected() {
  this.client.connect();
  this.getWs().readyState = this.getWs().OPEN;
  this.getWs().emit("open");
  this.client.disconnect();
  this.getWs().readyState = this.getWs().CLOSED;
  this.getWs().emit("close");
};

harnessProto.createClientListener = function createClientListener() {
  const l = {
    connecting: jest.fn(),
    connect: jest.fn(),
    message: jest.fn(),
    disconnect: jest.fn()
  };
  l.mockClear = () => {
    l.connecting.mockClear();
    l.connect.mockClear();
    l.message.mockClear();
    l.disconnect.mockClear();
  };
  this.client.on("connecting", l.connecting);
  this.client.on("connect", l.connect);
  this.client.on("message", l.message);
  this.client.on("disconnect", l.disconnect);
  return l;
};

harnessProto.getClientState = function getClientState() {
  const state = {};
  state._wsConstructor = this.client._wsConstructor; // Object reference
  state._wsClient = this.client._wsClient; // Object reference
  state._wsPreviousState = this.client._wsPreviousState; // String or null
  state._state = this.client._state; // String
  state._address = this.client._address; // String
  state._protocols = _.clone(this.client._protocols); // Object copy
  state._options = _.clone(this.client._options); // Object copy
  state._heartbeatInterval = !!this.client._heartbeatInterval; // Boolean
  state._heartbeatTimeout = !!this.client._heartbeatTimeout; // Boolean
  return state;
};

const toHaveState = function toHaveState(receivedClient, expectedState) {
  // Check ._wsConstructor
  if (receivedClient._wsConstructor !== expectedState._wsConstructor) {
    return {
      pass: false,
      message() {
        return "expected ._wsConstructor to match, but they didn't";
      }
    };
  }

  // Check ._wsClient (both objects or both null)
  if (
    (check.object(receivedClient._wsClient) &&
      !check.object(expectedState._wsClient)) ||
    (!check.object(receivedClient._wsClient) &&
      check.object(expectedState._wsClient)) ||
    (receivedClient._wsClient === null && expectedState._wsClient !== null) ||
    (receivedClient._wsClient !== null && expectedState._wsClient === null)
  ) {
    return {
      pass: false,
      message() {
        return "expected ._wsClient to match, but they didn't";
      }
    };
  }

  // Check ._wsPreviousState
  if (receivedClient._wsPreviousState !== expectedState._wsPreviousState) {
    return {
      pass: false,
      message() {
        return "expected ._wsPreviousState to match, but they didn't";
      }
    };
  }

  // Check _state
  if (receivedClient._state !== expectedState._state) {
    return {
      pass: false,
      message() {
        return "expected ._state to match, but they didn't";
      }
    };
  }

  // Check _address
  if (receivedClient._address !== expectedState._address) {
    return {
      pass: false,
      message() {
        return "expected ._address to match, but they didn't";
      }
    };
  }

  // Check _protocols
  if (!_.isEqual(receivedClient._protocols, expectedState._protocols)) {
    return {
      pass: false,
      message() {
        return "expected ._protocols to match, but they didn't";
      }
    };
  }

  // Check _options
  if (!_.isEqual(receivedClient._options, expectedState._options)) {
    return {
      pass: false,
      message() {
        return "expected ._options to match, but they didn't";
      }
    };
  }

  // Check _heartbeatInterval
  if (
    (check.integer(receivedClient._heartbeatInterval) &&
      !expectedState._heartbeatInterval) ||
    (!check.integer(receivedClient._heartbeatInterval) &&
      expectedState._heartbeatInterval)
  ) {
    return {
      pass: false,
      message() {
        return "expected ._heartbeatInterval to match, but they didn't";
      }
    };
  }

  // Check _heartbeatTimeout
  if (
    (check.integer(receivedClient._heartbeatTimeout) &&
      !expectedState._heartbeatTimeout) ||
    (!check.integer(receivedClient._heartbeatTimeout) &&
      expectedState._heartbeatTimeout)
  ) {
    return {
      pass: false,
      message() {
        return "expected ._heartbeatTimeout to match, but they didn't";
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

    it("should fail if _wsClient values don't match - case 1", () => {
      const result = toHaveState({ _wsClient: null }, { _wsClient: {} });
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._wsClient to match, but they didn't"
      );
    });

    it("should fail if _wsClient values don't match - case 2", () => {
      const result = toHaveState({ _wsClient: {} }, { _wsClient: null });
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._wsClient to match, but they didn't"
      );
    });

    it("should fail if _wsPreviousState values don't match", () => {
      const result = toHaveState(
        { _wsPreviousState: "123" },
        { _wsPreviousState: null }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._wsPreviousState to match, but they didn't"
      );
    });

    it("should fail if _state values don't match", () => {
      const result = toHaveState({ _state: "123" }, { _state: "456" });
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._state to match, but they didn't"
      );
    });

    it("should fail if _address values don't match", () => {
      const result = toHaveState({ _address: "123" }, { _address: "456" });
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._address to match, but they didn't"
      );
    });

    it("should fail if _protocols values don't match - string", () => {
      const result = toHaveState({ _protocols: "123" }, { _protocols: "456" });
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._protocols to match, but they didn't"
      );
    });

    it("should fail if _protocols values don't match - array", () => {
      const result = toHaveState({ _protocols: ["123"] }, { _protocols: [] });
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._protocols to match, but they didn't"
      );
    });

    it("should fail if _options values don't match", () => {
      const result = toHaveState(
        { _options: {} },
        { _options: { some: "thing" } }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._options to match, but they didn't"
      );
    });

    it("should fail if _heartbeatInterval doesn't match", () => {
      const result = toHaveState(
        { _heartbeatInterval: 123 },
        { _heartbeatInterval: false }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._heartbeatInterval to match, but they didn't"
      );
    });

    it("should fail if _heartbeatTimeout doesn't match", () => {
      const result = toHaveState(
        { _heartbeatTimeout: 123 },
        { _heartbeatTimeout: false }
      );
      expect(result.pass).toBe(false);
      expect(result.message()).toBe(
        "expected ._heartbeatTimeout to match, but they didn't"
      );
    });
  });

  describe("can pass", () => {
    it("should pass if _wsConstructor matches", () => {
      const f = () => {};
      const result = toHaveState({ _wsConstructor: f }, { _wsConstructor: f });
      expect(result.pass).toBe(true);
    });

    it("should pass if _wsClient matches - case 1", () => {
      const result = toHaveState({ _wsClient: {} }, { _wsClient: {} });
      expect(result.pass).toBe(true);
    });

    it("should pass if _wsClient matches - case 2", () => {
      const result = toHaveState({ _wsClient: null }, { _wsClient: null });
      expect(result.pass).toBe(true);
    });

    it("should pass if _wsPreviousState matches", () => {
      const result = toHaveState(
        { _wsPreviousState: "disconnected" },
        { _wsPreviousState: "disconnected" }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _state matches", () => {
      const result = toHaveState(
        { _state: "disconnected" },
        { _state: "disconnected" }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _address matches", () => {
      const result = toHaveState(
        { _state: "disconnected" },
        { _state: "disconnected" }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _protocols matches - string", () => {
      const result = toHaveState({ _protocols: "123" }, { _protocols: "123" });
      expect(result.pass).toBe(true);
    });

    it("should pass if _protocols matches - array", () => {
      const result = toHaveState(
        { _protocols: ["123"] },
        { _protocols: ["123"] }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _options matches - array", () => {
      const result = toHaveState(
        { _options: { some: "thing" } },
        { _options: { some: "thing" } }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _heartbeatInterval matches", () => {
      const result = toHaveState(
        { _heartbeatInterval: 123 },
        { _heartbeatInterval: true }
      );
      expect(result.pass).toBe(true);
    });

    it("should pass if _heartbeatTimeout matches", () => {
      const result = toHaveState(
        { _heartbeatTimeout: 123 },
        { _heartbeatTimeout: true }
      );
      expect(result.pass).toBe(true);
    });
  });
});

// Client tests

describe("The client() factory function", () => {
  describe("can fail", () => {
    it("should throw on invalid wsConstructor", () => {
      expect(() => {
        client("junk");
      }).toThrow(
        new Error("INVALID_ARGUMENT: Invalid wsConstructor argument.")
      );
    });

    it("should throw on invalid address - type", () => {
      expect(() => {
        client(() => {}, 123);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid address argument."));
    });

    it("should throw on invalid address - format", () => {
      expect(() => {
        client(() => {}, "junk");
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid address argument."));
    });

    it("should throw on invalid protocols", () => {
      expect(() => {
        client(() => {}, "ws://localhost", 123);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid protocols argument."));
    });

    it("should throw on invalid protocols element", () => {
      expect(() => {
        client(() => {}, "ws://localhost", [123]);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid protocols argument."));
    });

    it("should throw on invalid options", () => {
      expect(() => {
        client(() => {}, "ws://localhost", "protocol", "junk");
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid options argument."));
    });

    it("should throw on invalid options.heartbeatIntervalMs - type", () => {
      expect(() => {
        client(() => {}, "ws://localhost", "protocol", {
          heartbeatIntervalMs: "junk"
        });
      }).toThrow(
        new Error(
          "INVALID_ARGUMENT: Invalid options.heartbeatIntervalMs argument."
        )
      );
    });

    it("should throw on invalid options.heartbeatIntervalMs - range", () => {
      expect(() => {
        client(() => {}, "ws://localhost", "protocol", {
          heartbeatIntervalMs: -1
        });
      }).toThrow(
        new Error(
          "INVALID_ARGUMENT: Invalid options.heartbeatIntervalMs argument."
        )
      );
    });

    it("should throw on invalid options.heartbeatTimeoutMs - type", () => {
      expect(() => {
        client(() => {}, "ws://localhost", "protocol", {
          heartbeatTimeoutMs: "junk"
        });
      }).toThrow(
        new Error(
          "INVALID_ARGUMENT: Invalid options.heartbeatTimeoutMs argument."
        )
      );
    });

    it("should throw on invalid options.heartbeatTimeoutMs - range low", () => {
      expect(() => {
        client(() => {}, "ws://localhost", "protocol", {
          heartbeatTimeoutMs: 0
        });
      }).toThrow(
        new Error(
          "INVALID_ARGUMENT: Invalid options.heartbeatTimeoutMs argument."
        )
      );
    });

    it("should throw on invalid options.heartbeatTimeoutMs - range high", () => {
      expect(() => {
        client(() => {}, "ws://localhost", "protocol", {
          heartbeatIntervalMs: 5,
          heartbeatTimeoutMs: 5
        });
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

    it("should initialize the state correectly - no protocols/options", () => {
      const f = () => {};
      const c = client(f, "ws://localhost");
      expect(c).toHaveState({
        _wsConstructor: f,
        _wsClient: null,
        _wsPreviousState: null,
        _state: "disconnected",
        _address: "ws://localhost",
        _protocols: "",
        _options: {
          heartbeatIntervalMs: config.defaults.heartbeatIntervalMs,
          heartbeatTimeoutMs: config.defaults.heartbeatTimeoutMs
        },
        _heartbeatInterval: null,
        _heartbeatTimeout: null
      });
    });

    it("should initialize the state correectly - with protocols string but no options", () => {
      const f = () => {};
      const c = client(f, "ws://localhost", "protocol");
      expect(c).toHaveState({
        _wsConstructor: f,
        _wsClient: null,
        _wsPreviousState: null,
        _state: "disconnected",
        _address: "ws://localhost",
        _protocols: "protocol",
        _options: {
          heartbeatIntervalMs: config.defaults.heartbeatIntervalMs,
          heartbeatTimeoutMs: config.defaults.heartbeatTimeoutMs
        },
        _heartbeatInterval: null,
        _heartbeatTimeout: null
      });
    });

    it("should initialize the state correectly - with protocols array but no options", () => {
      const f = () => {};
      const c = client(f, "ws://localhost", ["protocol"]);
      expect(c).toHaveState({
        _wsConstructor: f,
        _wsClient: null,
        _wsPreviousState: null,
        _state: "disconnected",
        _address: "ws://localhost",
        _protocols: ["protocol"],
        _options: {
          heartbeatIntervalMs: config.defaults.heartbeatIntervalMs,
          heartbeatTimeoutMs: config.defaults.heartbeatTimeoutMs
        },
        _heartbeatInterval: null,
        _heartbeatTimeout: null
      });
    });

    it("should initialize the state correectly - with protocols and options (no transport options)", () => {
      const f = () => {};
      const c = client(f, "ws://localhost", ["protocol"], {
        someOption: "someValue"
      });
      expect(c).toHaveState({
        _wsConstructor: f,
        _wsClient: null,
        _wsPreviousState: null,
        _state: "disconnected",
        _address: "ws://localhost",
        _protocols: ["protocol"],
        _options: {
          heartbeatIntervalMs: config.defaults.heartbeatIntervalMs,
          heartbeatTimeoutMs: config.defaults.heartbeatTimeoutMs,
          someOption: "someValue"
        },
        _heartbeatInterval: null,
        _heartbeatTimeout: null
      });
    });

    it("should initialize the state correectly - with protocols and options (all transport options)", () => {
      const f = () => {};
      const c = client(f, "ws://localhost", ["protocol"], {
        someOption: "someValue",
        heartbeatIntervalMs: 2,
        heartbeatTimeoutMs: 1
      });
      expect(c).toHaveState({
        _wsConstructor: f,
        _wsClient: null,
        _wsPreviousState: null,
        _state: "disconnected",
        _address: "ws://localhost",
        _protocols: ["protocol"],
        _options: {
          heartbeatIntervalMs: 2,
          heartbeatTimeoutMs: 1,
          someOption: "someValue"
        },
        _heartbeatInterval: null,
        _heartbeatTimeout: null
      });
    });

    // Function calls - N/A

    // Calls on ws - N/A

    // Outbound callbacks - N/A

    // Inbound callbacks - N/A

    // Return value

    it("should return an object", () => {
      expect(client(() => {}, "ws://localhost")).toBeInstanceOf(Object);
    });
  });
});

// State-modifying functions - triggered by library

describe("The client.connect() function", () => {
  describe("can fail", () => {
    it("should throw if not disconnected", () => {
      const harn = harness("ws://localhost");
      harn.client.connect();
      expect(() => {
        harn.client.connect();
      }).toThrow(new Error("INVALID_STATE: Already connecting or connected."));
    });
  });

  describe("can succeed", () => {
    describe("when there is an existing ws client instance", () => {
      // Events

      it("should emit connecting", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnecting();
        harn.client.disconnect();
        const listener = harn.createClientListener();
        harn.client.connect();
        expect(listener.connecting.mock.calls.length).toBe(1);
        expect(listener.connecting.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
      });

      // State

      it("should update the state appropriately", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnecting();
        harn.client.disconnect();
        const newState = harn.getClientState();
        newState._state = "connecting";
        harn.client.connect();
        expect(harn.client).toHaveState(newState);
      });

      // Function calls - N/A

      // Calls on ws

      it("should do nothing on previous ws and new ws", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnecting();
        const prevWs = harn.getWs();
        harn.client.disconnect();
        harn.getWs().mockClear();
        harn.client.connect();

        expect(prevWs.ping.mock.calls.length).toBe(0);
        expect(prevWs.send.mock.calls.length).toBe(0);
        expect(prevWs.close.mock.calls.length).toBe(0);
        expect(prevWs.terminate.mock.calls.length).toBe(0);

        expect(harn.getWs().ping.mock.calls.length).toBe(0);
        expect(harn.getWs().send.mock.calls.length).toBe(0);
        expect(harn.getWs().close.mock.calls.length).toBe(0);
        expect(harn.getWs().terminate.mock.calls.length).toBe(0);
      });

      // Outbound callbacks - N/A

      // Inbound callbacks - N/A

      // Return value

      it("should return nothing", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnecting();
        harn.getWs().emit("open");
        harn.client.disconnect();
        expect(harn.client.connect()).toBe(undefined);
      });
    });
    describe("when there is no existing ws client instance", () => {
      // Events

      it("should emit connecting and disconnect", () => {
        const harn = harness("ws://localhost");
        const listener = harn.createClientListener();
        harn.client.connect();
        expect(listener.connecting.mock.calls.length).toBe(1);
        expect(listener.connecting.mock.calls[0].length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
      });

      // State

      it("should update the state appropriately", () => {
        const harn = harness("ws://localhost");
        const newState = harn.getClientState();
        newState._wsClient = {};
        newState._wsPreviousState = "connecting";
        newState._state = "connecting";
        harn.client.connect();
        expect(harn.client).toHaveState(newState);
      });

      // Function calls

      it("should call the ws constructor", () => {
        let constructorArgs;
        const constructor = function constructor(...args) {
          constructorArgs = args;
          emitter(this);
        };
        const harn = harness(
          "ws://localhost",
          "prot",
          {
            heartbeatIntervalMs: 123,
            heartbeatTimeoutMs: 12,
            otherOption: "value"
          },
          constructor
        );
        harn.client.connect();
        expect(check.array(constructorArgs)).toBe(true);
        expect(constructorArgs.length).toBe(3);
        expect(constructorArgs[0]).toBe("ws://localhost");
        expect(constructorArgs[1]).toBe("prot");
        expect(constructorArgs[2]).toEqual({
          heartbeatIntervalMs: 123,
          heartbeatTimeoutMs: 12,
          otherOption: "value"
        });
      });

      // Calls on ws

      it("should do nothing on new ws (was no previous)", () => {
        const harn = harness("ws://localhost");
        harn.client.connect();
        expect(harn.getWs().ping.mock.calls.length).toBe(0);
        expect(harn.getWs().send.mock.calls.length).toBe(0);
        expect(harn.getWs().close.mock.calls.length).toBe(0);
        expect(harn.getWs().terminate.mock.calls.length).toBe(0);
      });

      // Outbound callbacks - N/A

      // Inbound callbacks - N/A

      // Return value

      it("should return nothing", () => {
        const harn = harness("ws://localhost");
        expect(harn.client.connect()).toBe(undefined);
      });
    });
  });
});

describe("The client.disconnect() function", () => {
  describe("can fail", () => {
    it("should throw on invalid error argument", () => {
      const harn = harness("ws://localhost");
      expect(() => {
        harn.client.disconnect(123);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid error argument."));
    });

    it("should throw if already disconnected", () => {
      const harn = harness("ws://localhost");
      expect(() => {
        harn.client.disconnect();
      }).toThrow(new Error("INVALID_STATE: Already disconnected."));
    });
  });

  describe("can succeed", () => {
    // Events

    it("should emit disconnect with no error if none passed", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      const listener = harn.createClientListener();
      harn.client.disconnect();
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
    });

    it("should emit disconnect with error if one passed", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      const listener = harn.createClientListener();
      const err = new Error("SOME_ERROR");
      harn.client.disconnect(err);
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBe(err);
      expect(listener.message.mock.calls.length).toBe(0);
    });

    // State

    it("if closing a ws client, should update the state appropriately", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      harn.getWs().readyState = harn.getWs().OPEN;
      const newState = harn.getClientState();
      newState._wsPreviousState = "disconnecting";
      newState._state = "disconnected";
      newState._heartbeatInterval = null;
      newState._heartbeatTimer = null;
      harn.client.disconnect();
      expect(harn.client).toHaveState(newState);
    });

    it("if not closing a ws client, should update the state appropriately", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnecting();
      const newState = harn.getClientState();
      newState._state = "disconnected";
      newState._heartbeatInterval = null;
      newState._heartbeatTimer = null;
      harn.client.disconnect();
      expect(harn.client).toHaveState(newState);
    });

    // Function calls

    it("should clear the heartbeatInterval and heartbeatTimeout, if present", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs); // Send a ping - creates timer
      clearInterval.mockClear();
      clearTimeout.mockClear();
      harn.client.disconnect();
      expect(clearInterval.mock.calls.length).toBe(1);
      expect(clearInterval.mock.calls[0].length).toBe(1);
      expect(check.number(clearInterval.mock.calls[0][0])).toBe(true);
      expect(clearTimeout.mock.calls.length).toBe(1);
      expect(clearTimeout.mock.calls[0].length).toBe(1);
      expect(check.number(clearTimeout.mock.calls[0][0])).toBe(true);
    });

    it("should not clear the heartbeatInterval and heartbeatTimeout, if not present", () => {
      const harn = harness("ws://localhost", "", { heartbeatIntervalMs: 0 });
      harn.makeWsConnected();
      clearInterval.mockClear();
      clearTimeout.mockClear();
      harn.client.disconnect();
      expect(clearInterval.mock.calls.length).toBe(0);
      expect(clearTimeout.mock.calls.length).toBe(0);
    });

    // Calls on ws

    it("if the ws client is connected, should call ws.close()", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      harn.getWs().mockClear();
      harn.client.disconnect();
      expect(harn.getWs().ping.mock.calls.length).toBe(0);
      expect(harn.getWs().send.mock.calls.length).toBe(0);
      expect(harn.getWs().close.mock.calls.length).toBe(1);
      expect(harn.getWs().close.mock.calls[0].length).toBe(2);
      expect(harn.getWs().close.mock.calls[0][0]).toBe(1000);
      expect(harn.getWs().close.mock.calls[0][1]).toBe(
        "Connection closed by the client."
      );
      expect(harn.getWs().terminate.mock.calls.length).toBe(0);
    });

    it("if the ws client is not connected, should do nothing on ws", () => {
      const harn = harness("ws://localhost");
      harn.makeWsDisconnecting();
      harn.client.connect();
      // Now transport state is connecting and ws is disconnecting
      harn.getWs().mockClear();
      harn.client.disconnect();
      expect(harn.getWs().ping.mock.calls.length).toBe(0);
      expect(harn.getWs().send.mock.calls.length).toBe(0);
      expect(harn.getWs().close.mock.calls.length).toBe(0);
      expect(harn.getWs().terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks - N/A

    // Return value

    it("should return nothing", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      expect(harn.client.disconnect()).toBe(undefined);
    });
  });
});

describe("The client.send() function", () => {
  describe("can fail", () => {
    it("should throw on invalid message", () => {
      const harn = harness("ws://localhost");
      expect(() => {
        harn.client.send(123);
      }).toThrow(new Error("INVALID_ARGUMENT: Invalid message."));
    });

    it("should throw if not connected", () => {
      const harn = harness("ws://localhost");
      expect(() => {
        harn.client.send("msg");
      }).toThrow(new Error("INVALID_STATE: Not connected."));
    });
  });

  describe("can succeed", () => {
    // Events

    it("should emit nothing", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      const listener = harn.createClientListener();
      harn.client.send("msg");
      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
    });

    // State

    it("should not change the state", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      const newState = harn.getClientState();
      harn.client.send("msg");
      expect(harn.client).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws

    it("should call ws.send()", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      harn.getWs().mockClear();
      harn.client.send("msg");
      expect(harn.getWs().ping.mock.calls.length).toBe(0);
      expect(harn.getWs().send.mock.calls.length).toBe(1);
      expect(harn.getWs().send.mock.calls[0].length).toBe(1);
      expect(harn.getWs().send.mock.calls[0][0]).toBe("msg");
      expect(harn.getWs().close.mock.calls.length).toBe(0);
      expect(harn.getWs().terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks - N/A

    // Return value

    it("should return nothing", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      expect(harn.client.send("msg")).toBe(undefined);
    });
  });
});

// State-modifying functions -- triggered by ws

describe("The client._processWsOpen() function", () => {
  // Events

  it("should emit connect if transport is connecting", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnecting();
    const listener = harn.createClientListener();

    harn.getWs().readyState = harn.getWs().OPEN;
    harn.getWs().emit("open");

    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(1);
    expect(listener.connect.mock.calls[0].length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
  });

  it("should not emit connect if transport is disconnected", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnecting();
    harn.client.disconnect();
    const listener = harn.createClientListener();

    harn.getWs().readyState = harn.getWs().OPEN;
    harn.getWs().emit("open");

    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
  });

  // State

  it("if deciding to close the ws connection, should update state appropriately", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnecting();
    harn.client.disconnect();

    const newState = harn.getClientState();
    newState._wsPreviousState = "disconnecting";

    harn.getWs().readyState = harn.getWs().OPEN;
    harn.getWs().emit("open");
    expect(harn.client).toHaveState(newState);
  });

  it("if not closing the ws connection and heartbeat is enabled, should update state appropriately", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnecting();
    const newState = harn.getClientState();
    newState._wsPreviousState = "connected";
    newState._state = "connected";
    newState._heartbeatInterval = 123;

    harn.getWs().readyState = harn.getWs().OPEN;
    harn.getWs().emit("open");
    expect(harn.client).toHaveState(newState);
  });

  it("if not closing the ws connection and heartbeat is not enabled, should update state appropriately", () => {
    const harn = harness("ws://localhost", "", { heartbeatIntervalMs: 0 });
    harn.makeWsConnecting();
    const newState = harn.getClientState();
    newState._wsPreviousState = "connected";
    newState._state = "connected";

    harn.getWs().readyState = harn.getWs().OPEN;
    harn.getWs().emit("open");
    expect(harn.client).toHaveState(newState);
  });

  // Function calls

  it("if heartbeat is enabled, should call setInterval", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnecting();
    setInterval.mockClear();

    harn.getWs().readyState = harn.getWs().OPEN;
    harn.getWs().emit("open");

    expect(setInterval.mock.calls.length).toBe(1);
    expect(setInterval.mock.calls[0].length).toBe(2);
    expect(check.function(setInterval.mock.calls[0][0])).toBe(true);
    expect(check.number(setInterval.mock.calls[0][1])).toBe(true);
  });

  it("if heartbeat is disabled, should not call setInterval", () => {
    const harn = harness("ws://localhost", "", { heartbeatIntervalMs: 0 });
    harn.makeWsConnecting();
    setInterval.mockClear();

    harn.getWs().readyState = harn.getWs().OPEN;
    harn.getWs().emit("open");

    expect(setInterval.mock.calls.length).toBe(0);
  });

  // Calls on ws

  it("if deciding to close the connection, should call ws.close()", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnecting();
    harn.client.disconnect();
    harn.getWs().mockClear();

    harn.getWs().readyState = harn.getWs().OPEN;
    harn.getWs().emit("open");

    expect(harn.getWs().ping.mock.calls.length).toBe(0);
    expect(harn.getWs().send.mock.calls.length).toBe(0);
    expect(harn.getWs().close.mock.calls.length).toBe(1);
    expect(harn.getWs().close.mock.calls[0].length).toBe(2);
    expect(harn.getWs().close.mock.calls[0][0]).toBe(1000);
    expect(harn.getWs().close.mock.calls[0][1]).toBe(
      "Connection closed by the client."
    );
    expect(harn.getWs().terminate.mock.calls.length).toBe(0);
  });

  it("if not closing the ws connection, it should do nothing on ws", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnecting();
    harn.getWs().mockClear();

    harn.getWs().readyState = harn.getWs().OPEN;
    harn.getWs().emit("open");

    expect(harn.getWs().ping.mock.calls.length).toBe(0);
    expect(harn.getWs().send.mock.calls.length).toBe(0);
    expect(harn.getWs().close.mock.calls.length).toBe(0);
    expect(harn.getWs().terminate.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks

  describe("when the heartbeat interval fires", () => {
    // Events

    it("should emit nothing", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();

      const listener = harn.createClientListener();
      jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
    });

    // State

    it("should update the state appropriately", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();

      const newState = harn.getClientState();
      newState._heartbeatTimeout = 123;
      jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
      expect(harn.client).toHaveState(newState);
    });

    // Function calls

    it.skip("should call setTimeout", () => {
      // See jest-problem then fix this test
      const harn = harness("ws://localhost");
      harn.makeWsConnected();

      console.log(setTimeout.mock.calls.length);
      setTimeout.mockClear();
      console.log(setTimeout.mock.calls.length);
      jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs); // Affected by setTimeout calls in OTHER tests!!
      console.log(setTimeout.mock.calls.length);
      expect(setTimeout.mock.calls.length).toBe(1);
      expect(setTimeout.mock.calls[0].length).toBe(2);
      expect(check.function(setTimeout.mock.calls[0][0])).toBe(true);
      expect(check.number(setTimeout.mock.calls[0][1])).toBe(true);
    });

    // Calls on ws

    it("should call ws.ping()", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();

      harn.getWs().mockClear();
      jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);

      expect(harn.getWs().ping.mock.calls.length).toBe(1);
      expect(harn.getWs().ping.mock.calls[0].length).toBe(1);
      expect(check.function(harn.getWs().ping.mock.calls[0][0])).toBe(true);
      expect(harn.getWs().send.mock.calls.length).toBe(0);
      expect(harn.getWs().close.mock.calls.length).toBe(0);
      expect(harn.getWs().terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks

    describe("when the ping callback fires with success", () => {
      // Events

      it("should emit nothing", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        const listener = harn.createClientListener();
        cb();

        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
      });

      // State

      it("should not change the state", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        const newState = harn.getClientState();
        cb();
        expect(harn.client).toHaveState(newState);
      });

      // Function calls - N/A

      // Calls on ws

      it("should do nothing on ws", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        harn.getWs().mockClear();
        cb();

        expect(harn.getWs().ping.mock.calls.length).toBe(0);
        expect(harn.getWs().send.mock.calls.length).toBe(0);
        expect(harn.getWs().close.mock.calls.length).toBe(0);
        expect(harn.getWs().terminate.mock.calls.length).toBe(0);
      });

      // Outbound callbacks- N/A

      // Inbound callbacks - N/A
    });

    describe("when the ping callback fires with error - ws client still open", () => {
      // Events

      it("should emit disconnect", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        const listener = harn.createClientListener();
        cb(new Error("SOME_ERROR"));

        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(1);
        expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.disconnect.mock.calls[0][0].message).toBe(
          "FAILURE: The WebSocket heartbeat failed."
        );
        expect(listener.message.mock.calls.length).toBe(0);
      });

      // State

      it("should update the state appropriately", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        const newState = harn.getClientState();
        newState._wsPreviousState = "disconnecting";
        newState._state = "disconnected";
        newState._heartbeatInterval = null;
        newState._heartbeatTimeout = null;
        cb(new Error("SOME_ERROR"));
        expect(harn.client).toHaveState(newState);
      });

      // Function calls

      it("should call clearInterval and clearTimeout", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        clearInterval.mockClear();
        clearTimeout.mockClear();
        cb(new Error("SOME_ERROR"));
        expect(clearInterval.mock.calls.length).toBe(1);
        expect(clearInterval.mock.calls[0].length).toBe(1);
        expect(check.number(clearInterval.mock.calls[0][0])).toBe(true);
        expect(clearTimeout.mock.calls.length).toBe(1);
        expect(clearTimeout.mock.calls[0].length).toBe(1);
        expect(check.number(clearTimeout.mock.calls[0][0])).toBe(true);
      });

      // Calls on ws

      it("should call ws.terminate()", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        harn.getWs().mockClear();
        cb(new Error("SOME_ERROR"));

        expect(harn.getWs().ping.mock.calls.length).toBe(0);
        expect(harn.getWs().send.mock.calls.length).toBe(0);
        expect(harn.getWs().close.mock.calls.length).toBe(0);
        expect(harn.getWs().terminate.mock.calls.length).toBe(1);
        expect(harn.getWs().terminate.mock.calls[0].length).toBe(0);
      });

      // Outbound callbacks- N/A

      // Inbound callbacks - N/A
    });

    describe("when the ping callback fires with error - ws client closing", () => {
      // Events

      it("should emit nothing", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        harn.client.disconnect();
        harn.getWs().readyState = harn.getWs().readyState.CLOSING;

        const listener = harn.createClientListener();
        cb(new Error("SOME_ERROR"));
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
      });

      // State

      it("should update the state appropriately", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        harn.client.disconnect();
        harn.getWs().readyState = harn.getWs().readyState.CLOSING;

        const newState = harn.getClientState();
        cb(new Error("SOME_ERROR"));
        expect(harn.client).toHaveState(newState);
      });

      // Function calls

      it("should not call clearInterval and clearTimeout", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        harn.client.disconnect();
        harn.getWs().readyState = harn.getWs().readyState.CLOSING;

        clearInterval.mockClear();
        clearTimeout.mockClear();
        cb(new Error("SOME_ERROR"));
        expect(clearInterval.mock.calls.length).toBe(0);
        expect(clearTimeout.mock.calls.length).toBe(0);
      });

      // Calls on ws

      it("should do nothing on ws", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        harn.client.disconnect();
        harn.getWs().readyState = harn.getWs().readyState.CLOSING;

        harn.getWs().mockClear();
        cb(new Error("SOME_ERROR"));
        expect(harn.getWs().ping.mock.calls.length).toBe(0);
        expect(harn.getWs().send.mock.calls.length).toBe(0);
        expect(harn.getWs().close.mock.calls.length).toBe(0);
        expect(harn.getWs().terminate.mock.calls.length).toBe(0);
      });

      // Outbound callbacks- N/A

      // Inbound callbacks - N/A
    });

    describe("when the ping callback fires with error - ws client closed", () => {
      // Events

      it("should emit nothing", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        harn.getWs().emit("close", 1000, "Close reason.");

        const listener = harn.createClientListener();
        cb(new Error("SOME_ERROR"));
        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(0);
        expect(listener.message.mock.calls.length).toBe(0);
      });

      // State

      it("should update the state appropriately", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        harn.getWs().emit("close", 1000, "Close reason.");

        const newState = harn.getClientState();
        cb(new Error("SOME_ERROR"));
        expect(harn.client).toHaveState(newState);
      });

      // Function calls

      it("should not call clearInterval and clearTimeout", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        const cb = harn.getWs().ping.mock.calls[0][0];

        harn.getWs().emit("close", 1000, "Close reason.");

        clearInterval.mockClear();
        clearTimeout.mockClear();
        cb(new Error("SOME_ERROR"));
        expect(clearInterval.mock.calls.length).toBe(0);
        expect(clearTimeout.mock.calls.length).toBe(0);
      });

      // Calls on ws - N/A (no ws to check)

      // Outbound callbacks- N/A

      // Inbound callbacks - N/A
    });

    describe("when the heartbeat timer fires", () => {
      // Events

      it("should emit disconnect", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);

        const listener = harn.createClientListener();
        jest.advanceTimersByTime(config.defaults.heartbeatTimeoutMs);

        expect(listener.connecting.mock.calls.length).toBe(0);
        expect(listener.connect.mock.calls.length).toBe(0);
        expect(listener.disconnect.mock.calls.length).toBe(1);
        expect(listener.disconnect.mock.calls[0].length).toBe(1);
        expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(listener.disconnect.mock.calls[0][0].message).toBe(
          "FAILURE: The WebSocket heartbeat failed."
        );
        expect(listener.message.mock.calls.length).toBe(0);
      });

      // State

      it("should update the state appropriately", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();

        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);

        const newState = harn.getClientState();
        newState._wsPreviousState = "disconnecting";
        newState._state = "disconnected";
        newState._heartbeatInterval = null;
        newState._heartbeatTimeout = null;
        jest.advanceTimersByTime(config.defaults.heartbeatTimeoutMs);
        expect(harn.client).toHaveState(newState);
      });

      // Function calls - N/A

      // Calls on ws

      it("should call ws.terminate()", () => {
        const harn = harness("ws://localhost");
        harn.makeWsConnected();
        jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
        harn.getWs().mockClear();
        jest.advanceTimersByTime(config.defaults.heartbeatTimeoutMs);
        expect(harn.getWs().ping.mock.calls.length).toBe(0);
        expect(harn.getWs().send.mock.calls.length).toBe(0);
        expect(harn.getWs().close.mock.calls.length).toBe(0);
        expect(harn.getWs().terminate.mock.calls.length).toBe(1);
        expect(harn.getWs().terminate.mock.calls[0].length).toBe(0);
      });

      // Outbound callbacks - N/A

      // Inbound callbacks - N/A
    });
  });
});

describe("The client._processWsMessage() function", () => {
  // Events

  it("should emit message if valid data type", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();

    const listener = harn.createClientListener();
    harn.getWs().emit("message", "some_msg");

    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(1);
    expect(listener.message.mock.calls[0].length).toBe(1);
    expect(listener.message.mock.calls[0][0]).toBe("some_msg");
  });

  it("should emit disconnect if invalid data type", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();

    const listener = harn.createClientListener();
    harn.getWs().emit("message", 123);

    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(1);
    expect(listener.disconnect.mock.calls[0].length).toBe(1);
    expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(listener.disconnect.mock.calls[0][0].message).toBe(
      "DISCONNECTED: Received invalid message type on WebSocket connection."
    );
    expect(listener.message.mock.calls.length).toBe(0);
  });

  // State

  it("should not change the state if valid data type", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();

    const newState = harn.getClientState();
    harn.getWs().emit("message", "some_msg");
    expect(harn.client).toHaveState(newState);
  });

  it("should update the state appropriately if invalid data type", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();

    const newState = harn.getClientState();
    newState._state = "disconnected";
    newState._wsPreviousState = "disconnecting";
    newState._heartbeatInterval = null;
    harn.getWs().emit("message", 123);
    expect(harn.client).toHaveState(newState);
  });

  // Function calls - N/A

  // Calls on ws

  it("should do nothing on ws if valid data type", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();

    harn.getWs().mockClear();
    harn.getWs().emit("message", "msg");
    expect(harn.getWs().ping.mock.calls.length).toBe(0);
    expect(harn.getWs().send.mock.calls.length).toBe(0);
    expect(harn.getWs().close.mock.calls.length).toBe(0);
    expect(harn.getWs().terminate.mock.calls.length).toBe(0);
  });

  it("should call ws.close() if invalid data type", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();

    harn.getWs().mockClear();
    harn.getWs().emit("message", 123);
    expect(harn.getWs().ping.mock.calls.length).toBe(0);
    expect(harn.getWs().send.mock.calls.length).toBe(0);
    expect(harn.getWs().close.mock.calls.length).toBe(1);
    expect(harn.getWs().close.mock.calls[0].length).toBe(2);
    expect(harn.getWs().close.mock.calls[0][0]).toBe(1000);
    expect(harn.getWs().close.mock.calls[0][1]).toBe(
      "Connection closed by the client."
    );
    expect(harn.getWs().terminate.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks - N/A
});

describe("The client._processWsPong() function", () => {
  // Events

  it("should emit nothing", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
    const listener = harn.createClientListener();
    harn.getWs().emit("pong");

    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
  });

  // State

  it("should update the state appropriately", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
    const newState = harn.getClientState();
    newState._heartbeatTimeout = null;
    harn.getWs().emit("pong");
    expect(harn.client).toHaveState(newState);
  });

  // Function calls

  it("should clear the heartbeat timeout", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
    clearTimeout.mockClear();
    harn.getWs().emit("pong");
    expect(clearTimeout.mock.calls.length).toBe(1);
    expect(clearTimeout.mock.calls[0].length).toBe(1);
    expect(check.number(clearTimeout.mock.calls[0][0])).toBe(true);
  });

  // Calls on ws

  it("should do nothing on ws", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();
    jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);
    harn.getWs().mockClear();
    harn.getWs().emit("pong");
    expect(harn.getWs().ping.mock.calls.length).toBe(0);
    expect(harn.getWs().send.mock.calls.length).toBe(0);
    expect(harn.getWs().close.mock.calls.length).toBe(0);
    expect(harn.getWs().terminate.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks - N/A
});

describe("The client._processWsClose() function", () => {
  describe("if outward-facing transport state is disconnected - call to disconnect()", () => {
    // Events

    it("should emit nothing", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      harn.client.disconnect();

      const listener = harn.createClientListener();
      harn.getWs().readyState = harn.getWs().OPENING;
      harn.getWs().emit("close");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
    });

    // State

    it("should update state appropriately", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      harn.client.disconnect();

      const newState = harn.getClientState();
      newState._wsClient = null;
      newState._wsPreviousState = null;
      harn.getWs().readyState = harn.getWs().OPENING;
      harn.getWs().emit("close");
      expect(harn.client).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws

    it("should do nothing on ws", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      harn.client.disconnect();

      const prevWs = harn.getWs();
      prevWs.mockClear();
      prevWs.readyState = prevWs.OPENING;
      prevWs.emit("close");
      expect(prevWs.ping.mock.calls.length).toBe(0);
      expect(prevWs.send.mock.calls.length).toBe(0);
      expect(prevWs.close.mock.calls.length).toBe(0);
      expect(prevWs.terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks - N/A
  });

  describe("if outward-facing transport state is disconnected - heartbeat failure", () => {
    // Events

    it("should emit nothing", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      jest.advanceTimersByTime(
        config.defaults.heartbeatIntervalMs + config.defaults.heartbeatTimeoutMs
      );

      const listener = harn.createClientListener();
      harn.getWs().readyState = harn.getWs().OPENING;
      harn.getWs().emit("close");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
    });

    // State

    it("should update state appropriately", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      jest.advanceTimersByTime(
        config.defaults.heartbeatIntervalMs + config.defaults.heartbeatTimeoutMs
      );

      const newState = harn.getClientState();
      newState._wsClient = null;
      newState._wsPreviousState = null;
      harn.getWs().readyState = harn.getWs().OPENING;
      harn.getWs().emit("close");
      expect(harn.client).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws

    it("should do nothing on ws", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      jest.advanceTimersByTime(
        config.defaults.heartbeatIntervalMs + config.defaults.heartbeatTimeoutMs
      );

      const prevWs = harn.getWs();
      prevWs.mockClear();
      prevWs.readyState = prevWs.OPENING;
      prevWs.emit("close");
      expect(prevWs.ping.mock.calls.length).toBe(0);
      expect(prevWs.send.mock.calls.length).toBe(0);
      expect(prevWs.close.mock.calls.length).toBe(0);
      expect(prevWs.terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks - N/A
  });

  describe("if outward-facing transport state is connecting and ws had been disconnecting and ws constructor throws", () => {
    // Events

    it("should emit should emit disconnect", () => {
      // Constructor needs to succeed the first time and throw the second time
      const err = new Error("SOME_ERROR");
      let constructorArgs;
      const constructor = function constructor(...args) {
        if (constructorArgs) {
          throw err;
        } else {
          constructorArgs = args;
          emitter(this);
          this.ping = jest.fn();
          this.send = jest.fn();
          this.close = jest.fn();
          this.terminate = jest.fn();
          this.mockClear = () => {
            this.ping.mockClear();
            this.send.mockClear();
            this.close.mockClear();
            this.terminate.mockClear();
          };
          this.CONNECTING = 0;
          this.OPEN = 1;
          this.CLOSING = 2;
          this.CLOSED = 3;
          this.readyState = this.CONNECTING;
        }
      };
      const harn = harness(
        "ws://localhost",
        "prot",
        {
          heartbeatIntervalMs: 123,
          heartbeatTimeoutMs: 12,
          otherOption: "value"
        },
        constructor
      );
      harn.makeWsConnected();
      harn.client.disconnect();
      harn.client.connect();

      const listener = harn.createClientListener();
      harn.getWs().readyState = harn.getWs().CLOSING;
      harn.getWs().emit("close");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "DISCONNECTED: Could not initialize the WebSocket client."
      );
      expect(listener.disconnect.mock.calls[0][0].wsError).toBe(err);
      expect(listener.message.mock.calls.length).toBe(0);
    });

    // State

    it("should update the state appropriately", () => {
      // Constructor needs to succeed the first time and throw the second time
      let constructorArgs;
      const constructor = function constructor(...args) {
        if (constructorArgs) {
          throw new Error("SOME_ERROR");
        } else {
          constructorArgs = args;
          emitter(this);
          this.ping = jest.fn();
          this.send = jest.fn();
          this.close = jest.fn();
          this.terminate = jest.fn();
          this.mockClear = () => {
            this.ping.mockClear();
            this.send.mockClear();
            this.close.mockClear();
            this.terminate.mockClear();
          };
          this.CONNECTING = 0;
          this.OPEN = 1;
          this.CLOSING = 2;
          this.CLOSED = 3;
          this.readyState = this.CONNECTING;
        }
      };
      const harn = harness(
        "ws://localhost",
        "prot",
        {
          heartbeatIntervalMs: 123,
          heartbeatTimeoutMs: 12,
          otherOption: "value"
        },
        constructor
      );
      harn.makeWsConnected();
      harn.client.disconnect();
      harn.client.connect();

      const newState = harn.getClientState();
      newState._state = "disconnected";
      newState._wsClient = null;
      newState._wsPreviousState = null;
      harn.getWs().readyState = harn.getWs().CLOSING;
      harn.getWs().emit("close");
      expect(harn.client).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws

    it("should do nothing on the previous ws", () => {
      // Constructor needs to succeed the first time and throw the second time
      let constructorArgs;
      const constructor = function constructor(...args) {
        if (constructorArgs) {
          throw new Error("SOME_ERROR");
        } else {
          constructorArgs = args;
          emitter(this);
          this.ping = jest.fn();
          this.send = jest.fn();
          this.close = jest.fn();
          this.terminate = jest.fn();
          this.mockClear = () => {
            this.ping.mockClear();
            this.send.mockClear();
            this.close.mockClear();
            this.terminate.mockClear();
          };
          this.CONNECTING = 0;
          this.OPEN = 1;
          this.CLOSING = 2;
          this.CLOSED = 3;
          this.readyState = this.CONNECTING;
        }
      };
      const harn = harness(
        "ws://localhost",
        "prot",
        {
          heartbeatIntervalMs: 123,
          heartbeatTimeoutMs: 12,
          otherOption: "value"
        },
        constructor
      );
      harn.makeWsConnected();
      harn.client.disconnect();
      harn.client.connect();

      const prevWs = harn.getWs();
      prevWs.mockClear();
      harn.getWs().readyState = harn.getWs().CLOSING;
      harn.getWs().emit("close");
      expect(prevWs.ping.mock.calls.length).toBe(0);
      expect(prevWs.send.mock.calls.length).toBe(0);
      expect(prevWs.close.mock.calls.length).toBe(0);
      expect(prevWs.terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks - N/A
  });

  describe("if outward-facing transport state is connecting and ws had been disconnecting and ws constructor succeeds", () => {
    // Events

    it("should emit nothing", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      harn.client.disconnect();
      harn.client.connect();

      const listener = harn.createClientListener();
      harn.getWs().readyState = harn.getWs().CLOSING;
      harn.getWs().emit("close");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(0);
      expect(listener.message.mock.calls.length).toBe(0);
    });

    // State

    it("should update the state appropriately", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      harn.client.disconnect();
      harn.client.connect();

      const newState = harn.getClientState();
      newState._wsPreviousState = "connecting";
      harn.getWs().readyState = harn.getWs().CLOSING;
      harn.getWs().emit("close");
      expect(harn.client).toHaveState(newState);
    });

    // Function calls

    it("should call the ws constructor", () => {
      let constructorArgs;
      const constructor = function constructor(...args) {
        constructorArgs = args;
        emitter(this);
        this.ping = jest.fn();
        this.send = jest.fn();
        this.close = jest.fn();
        this.terminate = jest.fn();
        this.mockClear = () => {
          this.ping.mockClear();
          this.send.mockClear();
          this.close.mockClear();
          this.terminate.mockClear();
        };
        this.CONNECTING = 0;
        this.OPEN = 1;
        this.CLOSING = 2;
        this.CLOSED = 3;
        this.readyState = this.CONNECTING;
      };
      const harn = harness(
        "ws://localhost",
        "prot",
        {
          heartbeatIntervalMs: 123,
          heartbeatTimeoutMs: 12,
          otherOption: "value"
        },
        constructor
      );
      harn.makeWsConnected();
      harn.client.disconnect();
      harn.client.connect();

      harn.getWs().readyState = harn.getWs().CLOSING;
      harn.getWs().emit("close");

      expect(check.array(constructorArgs)).toBe(true);
      expect(constructorArgs.length).toBe(3);
      expect(constructorArgs[0]).toBe("ws://localhost");
      expect(constructorArgs[1]).toBe("prot");
      expect(constructorArgs[2]).toEqual({
        heartbeatIntervalMs: 123,
        heartbeatTimeoutMs: 12,
        otherOption: "value"
      });
    });

    // Calls on ws

    it("should do nothing on the previous ws", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      harn.client.disconnect();
      harn.client.connect();

      const prevWs = harn.getWs();
      prevWs.mockClear();
      prevWs.readyState = harn.getWs().CLOSING;
      prevWs.emit("close");
      expect(prevWs.ping.mock.calls.length).toBe(0);
      expect(prevWs.send.mock.calls.length).toBe(0);
      expect(prevWs.close.mock.calls.length).toBe(0);
      expect(prevWs.terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks - N/A
  });

  describe("if outward-facing transport state is connecting and ws had been connecting", () => {
    // Events

    it("should emit disconnect", () => {
      const harn = harness("ws://localhost");
      harn.client.connect();

      const listener = harn.createClientListener();
      harn.getWs().readyState = harn.getWs().CLOSED;
      harn.getWs().emit("close", 1234, "close_reason");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "DISCONNECTED: The WebSocket closed."
      );
      expect(listener.disconnect.mock.calls[0][0].wsCode).toBe(1234);
      expect(listener.disconnect.mock.calls[0][0].wsReason).toBe(
        "close_reason"
      );
      expect(listener.message.mock.calls.length).toBe(0);
    });

    // State

    it("should update the state appropriately", () => {
      const harn = harness("ws://localhost");
      harn.client.connect();

      const newState = harn.getClientState();
      newState._state = "disconnected";
      newState._wsClient = null;
      newState._wsPreviousState = null;
      harn.getWs().readyState = harn.getWs().CLOSED;
      harn.getWs().emit("close", "close_code", "close_reason");
      expect(harn.client).toHaveState(newState);
    });

    // Function calls - N/A

    // Calls on ws

    it("should do nothing on previous ws", () => {
      const harn = harness("ws://localhost");
      harn.client.connect();

      const prevWs = harn.getWs();
      prevWs.mockClear();
      harn.getWs().readyState = harn.getWs().CLOSED;
      harn.getWs().emit("close", "close_code", "close_reason");
      expect(prevWs.ping.mock.calls.length).toBe(0);
      expect(prevWs.send.mock.calls.length).toBe(0);
      expect(prevWs.close.mock.calls.length).toBe(0);
      expect(prevWs.terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks - N/A
  });

  describe("if outward-facing transport state is connected", () => {
    // Events

    it("should emit disconnect", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();

      const listener = harn.createClientListener();
      harn.getWs().readyState = harn.getWs().CLOSED;
      harn.getWs().emit("close", 1234, "close_reason");

      expect(listener.connecting.mock.calls.length).toBe(0);
      expect(listener.connect.mock.calls.length).toBe(0);
      expect(listener.disconnect.mock.calls.length).toBe(1);
      expect(listener.disconnect.mock.calls[0].length).toBe(1);
      expect(listener.disconnect.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(listener.disconnect.mock.calls[0][0].message).toBe(
        "DISCONNECTED: The WebSocket closed."
      );
      expect(listener.disconnect.mock.calls[0][0].wsCode).toBe(1234);
      expect(listener.disconnect.mock.calls[0][0].wsReason).toBe(
        "close_reason"
      );
      expect(listener.message.mock.calls.length).toBe(0);
    });

    // State

    it("should update the state appropriately", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);

      const newState = harn.getClientState();
      newState._state = "disconnected";
      newState._wsClient = null;
      newState._wsPreviousState = null;
      newState._heartbeatInterval = null;
      newState._heartbeatTimeout = null;
      harn.getWs().readyState = harn.getWs().CLOSED;
      harn.getWs().emit("close", "close_code", "close_reason");
      expect(harn.client).toHaveState(newState);
    });

    // Function calls

    it("should call clearInterval and clearTimeout", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();
      jest.advanceTimersByTime(config.defaults.heartbeatIntervalMs);

      clearInterval.mockClear();
      clearTimeout.mockClear();
      harn.getWs().readyState = harn.getWs().OPENING;
      harn.getWs().emit("close");
      expect(clearInterval.mock.calls.length).toBe(1);
      expect(clearInterval.mock.calls[0].length).toBe(1);
      expect(check.number(clearInterval.mock.calls[0].length)).toBe(true);
      expect(clearTimeout.mock.calls.length).toBe(1);
      expect(clearTimeout.mock.calls[0].length).toBe(1);
      expect(check.number(clearTimeout.mock.calls[0].length)).toBe(true);
    });

    // Calls on ws

    it("should do nothing on previous ws", () => {
      const harn = harness("ws://localhost");
      harn.makeWsConnected();

      const prevWs = harn.getWs();
      prevWs.mockClear();
      harn.getWs().readyState = harn.getWs().CLOSED;
      harn.getWs().emit("close", "close_code", "close_reason");
      expect(prevWs.ping.mock.calls.length).toBe(0);
      expect(prevWs.send.mock.calls.length).toBe(0);
      expect(prevWs.close.mock.calls.length).toBe(0);
      expect(prevWs.terminate.mock.calls.length).toBe(0);
    });

    // Outbound callbacks - N/A

    // Inbound callbacks - N/A
  });
});

describe("The client._processWsError() function", () => {
  // Events

  it("should emit nothing", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();

    const listener = harn.createClientListener();
    harn.getWs().readyState = harn.getWs().CLOSED;
    harn.getWs().emit("error", new Error());
    expect(listener.connecting.mock.calls.length).toBe(0);
    expect(listener.connect.mock.calls.length).toBe(0);
    expect(listener.disconnect.mock.calls.length).toBe(0);
    expect(listener.message.mock.calls.length).toBe(0);
  });

  // State

  it("should not change the state", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();

    const newState = harn.getClientState();
    harn.getWs().readyState = harn.getWs().CLOSED;
    harn.getWs().emit("error", new Error());
    expect(harn.client).toHaveState(newState);
  });

  // Function calls - N/A

  // Calls on ws

  it("should do nothing on ws", () => {
    const harn = harness("ws://localhost");
    harn.makeWsConnected();

    harn.getWs().mockClear();
    harn.getWs().readyState = harn.getWs().CLOSED;
    harn.getWs().emit("error", new Error());
    expect(harn.getWs().ping.mock.calls.length).toBe(0);
    expect(harn.getWs().send.mock.calls.length).toBe(0);
    expect(harn.getWs().close.mock.calls.length).toBe(0);
    expect(harn.getWs().terminate.mock.calls.length).toBe(0);
  });

  // Outbound callbacks - N/A

  // Inbound callbacks - N/A
});

// State-getting functionality

describe("The client.state() function", () => {
  it("should return the state", () => {
    const harn = harness("ws://localhost");
    expect(harn.client.state()).toBe("disconnected");
  });
});

// Internal functions - tested as part of outward-facing functions (just one)
