import server from "../server";

describe("The function", () => {
  it("should work", () => {
    expect(server({ port: 8080 })).toBeInstanceOf(Object);
  });
});
