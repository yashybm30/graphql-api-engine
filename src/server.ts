import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { expressMiddleware } from "@as-integrations/express5";
import { GraphQLError } from "graphql";
import Redis from "ioredis";
import mongoose from "mongoose";
import { boundedFields, Context, loaders, resolvers, typeDefs } from "./schema";
import { config, verify } from "./security";
import { User } from "./models";
import { oauth } from "./oauth";
export async function createApp() {
  config.parse(process.env);
  await mongoose.connect(process.env.MONGO_URL!, {
    serverSelectionTimeoutMS: 3000,
  });
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.init()),
  );
  const redis = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
  redis.on("error", () => undefined);
  await redis.ping();
  const app = express(),
    http = createServer(app);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use((req, res, next) => {
    const id = randomUUID(),
      start = performance.now();
    res.set("x-request-id", id);
    res.on("finish", () =>
      console.log(
        JSON.stringify({
          requestId: id,
          path: req.path,
          status: res.statusCode,
          durationMs: performance.now() - start,
        }),
      ),
    );
    next();
  });
  app.use(async (req, res, next) => {
    try {
      const key = `graphql-rate:${req.ip}:${Math.floor(Date.now() / 60000)}`;
      const count = Number(
        await redis.eval(
          "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end;return n",
          1,
          key,
        ),
      );
      if (count > 100) {
        res
          .set("Retry-After", "60")
          .status(429)
          .json({ error: "Rate limit exceeded" });
        return;
      }
      next();
    } catch {
      res.status(503).json({ error: "Rate limit service unavailable" });
    }
  });
  app.get("/health/live", (_req, res) => res.json({ status: "alive" }));
  app.get("/health/ready", async (_req, res) => {
    try {
      await mongoose.connection.db!.admin().ping();
      await redis.ping();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  const closeOauth = await oauth(app);
  const apollo = new ApolloServer<Context>({
    typeDefs,
    resolvers,
    introspection: process.env.NODE_ENV !== "production",
    validationRules: [boundedFields],
    allowBatchedHttpRequests: false,
    includeStacktraceInErrorResponses: false,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer: http })],
    formatError: (error) =>
      error.extensions?.code === "INTERNAL_SERVER_ERROR"
        ? {
            message: "Internal server error",
            extensions: { code: "INTERNAL_SERVER_ERROR" },
          }
        : error,
  });
  await apollo.start();
  app.use(
    "/graphql",
    express.json({ limit: "32kb" }),
    expressMiddleware(apollo, {
      context: async ({ req }) => {
        let actor;
        try {
          actor = verify(req.header("authorization"));
        } catch {
          throw new GraphQLError("Invalid token", {
            extensions: { code: "UNAUTHENTICATED" },
          });
        }
        if (actor) {
          const user = await User.findById(actor.id).lean();
          if (!user || user.role !== actor.role)
            throw new GraphQLError("Account authorization changed", {
              extensions: { code: "UNAUTHENTICATED" },
            });
        }
        return { actor, loaders: loaders() };
      },
    }),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      void _next;
      console.error(error instanceof Error ? error.message : "Unhandled error");
      res.status(500).json({ error: "Internal server error" });
    },
  );
  return {
    app,
    http,
    apollo,
    redis,
    close: async () => {
      await apollo.stop();
      redis.disconnect();
      await closeOauth();
      await mongoose.disconnect();
    },
  };
}
