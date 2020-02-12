/*

Client tests run on Node and in the browser.
Expects feedmeTransportWsClient in scope.

*/

describe("something", () => {
  it("should do something", () => {
    expect(feedmeTransportWsClient).toEqual(jasmine.any(Function));
  });
});
