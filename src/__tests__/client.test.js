import client from "../client";

describe("The function", () => {
  it("should work", () => {
    expect(client("ws://localhost")).toBeInstanceOf(Object);
  });
});
