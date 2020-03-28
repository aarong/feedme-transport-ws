import feedmeTransportWs from "../../build";

describe("The common entry point for all three modules", () => {
  it("should work", () => {
    expect(feedmeTransportWs.server).toBeInstanceOf(Function);
    expect(feedmeTransportWs.client).toBeInstanceOf(Function);
    expect(feedmeTransportWs.browser).toBeInstanceOf(Function);
  });
});
