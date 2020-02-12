import server from "../server";

describe("a test", () => {
  it("should do something", () => {
    // eslint-disable-next-line
    const s = server();
    expect(1).toBe(1);
  });
});
