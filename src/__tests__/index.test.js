import index from "../index";

describe("The function", () => {
  it("should work", () => {
    expect(index.server).toBeInstanceOf(Function);
    expect(index.client).toBeInstanceOf(Function);
    expect(index.browser).toBeInstanceOf(Function);
  });
});
