import { Express } from "express";
import passport from "passport";
import session from "express-session";
import { Strategy, Profile } from "passport-google-oauth20";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";
import { User } from "./models";
import { sign } from "./security";
export async function oauth(app: Express) {
  if (!process.env.GOOGLE_CLIENT_ID) return async () => undefined;
  if (
    !process.env.GOOGLE_CLIENT_SECRET ||
    !process.env.GOOGLE_CALLBACK_URL ||
    !process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 48
  )
    throw new Error("Complete OAuth configuration required");
  const client = createClient({ url: process.env.REDIS_URL });
  client.on("error", () => undefined);
  await client.connect();
  app.use(
    "/auth/google",
    session({
      store: new RedisStore({ client, prefix: "graphql-oauth:" }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 600000,
      },
    }),
  );
  passport.use(
    new Strategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        state: true,
      },
      (_access: string, _refresh: string, profile: Profile, done) =>
        done(null, profile),
    ),
  );
  app.use(passport.initialize());
  app.get(
    "/auth/google",
    passport.authenticate("google", {
      scope: ["openid", "email", "profile"],
      session: false,
    }),
  );
  app.get("/auth/google/callback", (req, res, next) => {
    passport.authenticate(
      "google",
      { session: false },
      (error: Error | null, profile: Profile | false) => {
        if (error || !profile) {
          res.status(401).json({ error: "OAuth failed" });
          return;
        }
        const email = profile.emails
          ?.find((e) => e.verified || profile._json.email_verified)
          ?.value?.toLowerCase();
        if (!email) {
          res.status(401).json({ error: "Verified email required" });
          return;
        }
        const role = process.env.ADMIN_EMAILS?.split(",")
          .map((e) => e.trim().toLowerCase())
          .includes(email)
          ? "admin"
          : "member";
        void User.findOneAndUpdate(
          { googleId: profile.id },
          { $set: { email, name: profile.displayName, role } },
          { upsert: true, new: true, runValidators: true },
        )
          .then((user) =>
            res
              .set("Cache-Control", "no-store")
              .json({
                accessToken: sign({ id: String(user._id), role }),
                expiresIn: 900,
              }),
          )
          .catch(next);
      },
    )(req, res, next);
  });
  return () => client.quit();
}
