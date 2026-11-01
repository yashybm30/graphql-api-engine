import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
const { createApp } = require("../dist/server");
const { User } = require("../dist/models");
const { sign } = require("../dist/security");
it("persists notes, batches authors, isolates ownership and denies member admin queries", async () => {
  process.env.JWT_SECRET = "integration-secret-".repeat(5);
  const server = await createApp();
  try {
    const a = await User.create({
        googleId: randomUUID(),
        email: "a@example.test",
        name: "Alice",
        role: "member",
      }),
      b = await User.create({
        googleId: randomUUID(),
        email: "b@example.test",
        name: "Bob",
        role: "admin",
      });
    const ta = sign({ id: String(a._id), role: "member" }),
      tb = sign({ id: String(b._id), role: "admin" });
    const query = (q: string, t?: string) => {
      const req = request(server.app).post("/graphql").send({ query: q });
      return t ? req.set("Authorization", `Bearer ${t}`) : req;
    };
    const unauth = await query("{notes{total}}");
    expect(unauth.body.errors[0].extensions.code).toBe("UNAUTHENTICATED");
    const created = await query(
      'mutation{createNote(title:"Private",body:"Details"){id title author{name}}}',
      ta,
    );
    expect(created.body.errors).toBeUndefined();
    const id = created.body.data.createNote.id;
    expect((await query("{me{id email role}}", ta)).body.data.me.email).toBe(
      "a@example.test",
    );
    expect(
      (await query("{adminUsers{id email}}", tb)).body.data.adminUsers.length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (await query(`{note(id:"${id}"){title}}`, ta)).body.data.note.title,
    ).toBe("Private");
    expect(
      (await query('{note(id:"invalid"){id}}', ta)).body.errors[0].extensions
        .code,
    ).toBe("BAD_USER_INPUT");
    expect(
      (await query('mutation{createNote(title:"",body:"x"){id}}', ta)).body
        .errors[0].extensions.code,
    ).toBe("BAD_USER_INPUT");
    const ready = await request(server.app).get("/health/ready").expect(200);
    expect(ready.body.status).toBe("ready");
    await request(server.app).get("/health/live").expect(200);

    expect(created.body.data.createNote.author.name).toBe("Alice");
    expect(
      (await query(`{note(id:"${id}"){title}}`, tb)).body.data.note,
    ).toBeNull();
    expect(
      (await query(`mutation{deleteNote(id:"${id}")}`, tb)).body.data
        .deleteNote,
    ).toBe(false);
    expect(
      (await query("{adminUsers{id}}", ta)).body.errors[0].extensions.code,
    ).toBe("FORBIDDEN");
    expect(
      (await query("{adminPanel{users notes}}", tb)).body.data.adminPanel.users,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (await query("{notes(pageSize:101){total}}", ta)).body.errors[0]
        .extensions.code,
    ).toBe("BAD_USER_INPUT");
    expect(
      (await query("{notes{items{id author{name}} total}}", ta)).body.data.notes
        .total,
    ).toBe(1);
    expect(
      (await query(`mutation{deleteNote(id:"${id}")}`, ta)).body.data
        .deleteNote,
    ).toBe(true);
  } finally {
    await server.close();
  }
});
