import client from "../browser";

describe("The function", () => {
  it("should work", () => {
    expect(client("ws://localhost")).toBeInstanceOf(Object);
  });
});
