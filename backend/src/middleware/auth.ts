import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export interface AuthedRequest extends Request {
  userId?: string;
}

export const AUTH_COOKIE_NAME = "aipk_token";

export function signAuthToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "7d" });
}

export function requireAuth(secret: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }

    try {
      const payload = jwt.verify(token, secret) as { sub: string };
      req.userId = payload.sub;
      next();
    } catch {
      res.status(401).json({ error: "unauthenticated" });
    }
  };
}
