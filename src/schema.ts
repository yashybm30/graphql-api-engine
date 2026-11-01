import { GraphQLError, ValidationRule } from "graphql";
import DataLoader from "dataloader";
import mongoose from "mongoose";
import { Note, User } from "./models";
import { Actor } from "./security";
export const typeDefs = `#graphql
 type User {id:ID!,name:String!}
 type Note {id:ID!,title:String!,body:String!,author:User!}
 type NotePage {items:[Note!]!,page:Int!,pageSize:Int!,total:Int!}
 type AdminUser {id:ID!,email:String!,name:String!,role:String!}
 type AdminPanel {users:Int!,notes:Int!}
 type Query {me:AdminUser!,notes(page:Int=1,pageSize:Int=20):NotePage!,note(id:ID!):Note,adminUsers:[AdminUser!]!,adminPanel:AdminPanel!}
 type Mutation {createNote(title:String!,body:String!):Note!,deleteNote(id:ID!):Boolean!}
`;
function denied(message: string, code = "FORBIDDEN"): never {
  throw new GraphQLError(message, { extensions: { code } });
}
export function requireActor(context: Context) {
  if (!context.actor)
    return denied("Authentication required", "UNAUTHENTICATED");
  return context.actor;
}
export function requireAdmin(context: Context) {
  const actor = requireActor(context);
  if (actor.role !== "admin") denied("Admin required");
  return actor;
}
function objectId(id: string) {
  if (!mongoose.isObjectIdOrHexString(id))
    denied("Invalid ID", "BAD_USER_INPUT");
  return id;
}
export function loaders() {
  return {
    users: new DataLoader(async (ids: readonly string[]) => {
      const users = await User.find({ _id: { $in: ids } }).lean();
      const map = new Map(
        users.map((u) => [String(u._id), { id: String(u._id), name: u.name }]),
      );
      return ids.map((id) => map.get(id) ?? new Error("Author missing"));
    }),
  };
}
export type Context = { actor?: Actor; loaders: ReturnType<typeof loaders> };
const noteView = (n: {
  _id: unknown;
  title: string;
  body: string;
  ownerId: unknown;
}) => ({
  id: String(n._id),
  title: n.title,
  body: n.body,
  ownerId: String(n.ownerId),
});
export const resolvers = {
  Query: {
    me: async (_: unknown, _args: unknown, c: Context) => {
      const actor = requireActor(c);
      const u = await User.findById(actor.id).lean();
      if (!u) denied("Account not found", "UNAUTHENTICATED");
      return { ...u, id: String(u._id) };
    },
    notes: async (
      _: unknown,
      { page, pageSize }: { page: number; pageSize: number },
      c: Context,
    ) => {
      const actor = requireActor(c);
      if (page < 1 || page > 10000 || pageSize < 1 || pageSize > 100)
        denied("Pagination outside allowed range", "BAD_USER_INPUT");
      const filter = { ownerId: actor.id };
      const [items, total] = await Promise.all([
        Note.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        Note.countDocuments(filter),
      ]);
      return { items: items.map(noteView), page, pageSize, total };
    },
    note: async (_: unknown, { id }: { id: string }, c: Context) => {
      const actor = requireActor(c);
      const note = await Note.findOne({
        _id: objectId(id),
        ownerId: actor.id,
      }).lean();
      return note ? noteView(note) : null;
    },
    adminUsers: async (_: unknown, _args: unknown, c: Context) => {
      requireAdmin(c);
      return (await User.find().sort({ _id: 1 }).limit(100).lean()).map(
        (u) => ({ ...u, id: String(u._id) }),
      );
    },
    adminPanel: async (_: unknown, _args: unknown, c: Context) => {
      requireAdmin(c);
      return {
        users: await User.countDocuments(),
        notes: await Note.countDocuments(),
      };
    },
  },
  Mutation: {
    createNote: async (
      _: unknown,
      { title, body }: { title: string; body: string },
      c: Context,
    ) => {
      const actor = requireActor(c);
      if (title.trim().length < 1 || title.length > 200 || body.length > 10000)
        denied("Invalid note content", "BAD_USER_INPUT");
      return noteView(
        await Note.create({ title: title.trim(), body, ownerId: actor.id }),
      );
    },
    deleteNote: async (_: unknown, { id }: { id: string }, c: Context) => {
      const actor = requireActor(c);
      return (
        (await Note.deleteOne({ _id: objectId(id), ownerId: actor.id }))
          .deletedCount === 1
      );
    },
  },
  Note: {
    author: (note: { ownerId: string }, _args: unknown, c: Context) =>
      c.loaders.users.load(note.ownerId),
  },
};
// The schema has no recursive types. Bound field count as well as raw request bytes.
export const boundedFields: ValidationRule = (context) => {
  let fields = 0;
  return {
    Field() {
      if (++fields > 100)
        context.reportError(
          new GraphQLError("Query exceeds 100 fields", {
            extensions: { code: "QUERY_TOO_COMPLEX" },
          }),
        );
    },
  };
};
