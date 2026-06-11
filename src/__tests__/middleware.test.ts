import { describe, it, expect } from "vitest";
import { buildSignInRedirectUrl } from "@/middleware";

describe("buildSignInRedirectUrl", () => {
  it("encodes the pathname as returnTo", () => {
    expect(buildSignInRedirectUrl("/dashboard", "")).toBe("/auth/signin?returnTo=%2Fdashboard");
  });

  it("encodes pathname and search together as returnTo", () => {
    expect(buildSignInRedirectUrl("/dashboard", "?tab=settings")).toBe(
      "/auth/signin?returnTo=%2Fdashboard%3Ftab%3Dsettings",
    );
  });
});
