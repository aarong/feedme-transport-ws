import FeedmeTransportWsClient from "../client.node";

describe("The client factory function", () => {
  // Babel uses core-js to polyfill WebSocket, so the factory does not throw
  it("should return an object - no protocol", () => {
    expect(FeedmeTransportWsClient("url")).toBeInstanceOf(Object);
  });

  it("should return an object - with protocol", () => {
    expect(FeedmeTransportWsClient("url", "protocol")).toBeInstanceOf(Object);
  });
});
