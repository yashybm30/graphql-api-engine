import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { it, expect } from "vitest";
import { parse, validate, buildSchema } from "graphql";
const {
  boundedFields,
  typeDefs,
  requireActor,
  requireAdmin,
  loaders,
} = require("../dist/schema");
const { sign, verify } = require("../dist/security");
it("enforces auth and admin authorization", () => {
  const context = { loaders: loaders() };
  expect(() => requireActor(context)).toThrow("Authentication");
  expect(() =>
    requireAdmin({ ...context, actor: { id: "x", role: "member" } }),
  ).toThrow("Admin");
});
it("rejects excessive query aliases", () => {
  const query =
    "{" + Array.from({ length: 101 }, (_, i) => `a${i}:me{id}`).join(" ") + "}";
  expect(
    validate(buildSchema(typeDefs), parse(query), [boundedFields]).length,
  ).toBeGreaterThan(0);
});
it("validates token issuer and signature", () => {
  process.env.JWT_SECRET = "test-secret-".repeat(8);
  const actor = { id: "a".repeat(24), role: "member" as const },
    token = sign(actor);
  expect(verify(`Bearer ${token}`)).toEqual(actor);
  expect(() => verify("Bearer bad")).toThrow();
});
