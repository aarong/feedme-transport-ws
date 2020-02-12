import FeedmeTransportWsClient from "../client.node";

describe("The client factory function", () => {
  it("should return an object - no protocol or options", () => {
    expect(FeedmeTransportWsClient("url")).toBeInstanceOf(Object);
  });

  it("should return an object - with protocol but no options", () => {
    expect(FeedmeTransportWsClient("url", "protocol")).toBeInstanceOf(Object);
  });

  it("should return an object - with protocol and options", () => {
    expect(FeedmeTransportWsClient("url", "protocol", {})).toBeInstanceOf(
      Object
    );
  });
});
