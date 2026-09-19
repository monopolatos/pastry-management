import { describe, expect, it } from "vitest";
import { CORE_PACKAGE_VERSION } from "./index.js";

describe("core package scaffold", () => {
  it("exposes a version so the test/build pipeline is wired correctly", () => {
    expect(CORE_PACKAGE_VERSION).toBe("0.1.0");
  });
});
