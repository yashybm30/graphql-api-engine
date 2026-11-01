import jwt from "jsonwebtoken";
import { z } from "zod";
export type Actor = { id: string; role: "admin" | "member" };
export const config = z.object({
  MONGO_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(48),
});
export function sign(actor: Actor) {
  return jwt.sign({ role: actor.role }, process.env.JWT_SECRET!, {
    subject: actor.id,
    issuer: "graphql-api-engine",
    audience: "graphql-client",
    algorithm: "HS256",
    expiresIn: "15m",
  });
}
export function verify(header?: string): Actor | undefined {
  if (!header) return;
  if (!header.startsWith("Bearer ")) throw new Error("Invalid authorization");
  const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!, {
    issuer: "graphql-api-engine",
    audience: "graphql-client",
    algorithms: ["HS256"],
  });
  const parsed = z
    .object({
      sub: z.string().regex(/^[a-f0-9]{24}$/),
      role: z.enum(["admin", "member"]),
    })
    .parse(payload);
  return { id: parsed.sub, role: parsed.role };
}
