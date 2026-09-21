import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { User } from "../models/User.js";
import { AUTH_COOKIE_NAME, requireAuth, signAuthToken, type AuthedRequest } from "../middleware/auth.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// frontend and backend are different domains in production (Vercel + Render), so the
// cookie has to be sameSite: "none" to be sent on a cross-site fetch at all, and
// "none" is rejected by browsers unless secure is also true. Locally both run on
// localhost, so lax + non-secure works and is friendlier for plain http dev.
// Checked per call, not cached at module load, so it reacts to the actual
// environment a request runs in rather than whatever it was at import time.
function authCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: isProduction ? ("none" as const) : ("lax" as const),
    secure: isProduction,
  };
}

export function createAuthRouter(jwtSecret: string): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
      return;
    }
    const { email, password } = parsed.data;

    const existing = await User.findOne({ email }).lean();
    if (existing) {
      res.status(409).json({ error: "email_taken" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash });

    const token = signAuthToken(user.id, jwtSecret);
    res.cookie(AUTH_COOKIE_NAME, token, { ...authCookieOptions(), maxAge: SEVEN_DAYS_MS });
    res.status(201).json({ id: user.id, email: user.email });
  });

  router.post("/login", async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input", details: parsed.error.issues });
      return;
    }
    const { email, password } = parsed.data;

    const user = await User.findOne({ email });
    if (!user) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    const token = signAuthToken(user.id, jwtSecret);
    res.cookie(AUTH_COOKIE_NAME, token, { ...authCookieOptions(), maxAge: SEVEN_DAYS_MS });
    res.status(200).json({ id: user.id, email: user.email });
  });

  router.post("/logout", (_req, res) => {
    // clearCookie has to be called with matching attributes, or the browser
    // treats it as a different cookie and won't actually clear the real one
    res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
    res.status(204).send();
  });

  router.get("/me", requireAuth(jwtSecret), async (req: AuthedRequest, res) => {
    const user = await User.findById(req.userId).lean();
    if (!user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    res.status(200).json({ id: user._id.toString(), email: user.email });
  });

  return router;
}
