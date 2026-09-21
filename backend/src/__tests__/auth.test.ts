import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { clearTestDb, startTestDb, stopTestDb } from "./mongo-test-utils.js";

const JWT_SECRET = "test-secret";
const app = createApp({
  jwtSecret: JWT_SECRET,
  geminiConfig: { apiKey: undefined },
  urlValidatorOptions: { blockPrivateNetworks: false },
});

beforeAll(startTestDb);
afterEach(clearTestDb);
afterAll(stopTestDb);

describe("auth flow", () => {
  it("registers, logs in, accesses a protected route, then logs out and is rejected", async () => {
    const agent = request.agent(app);

    const registerRes = await agent
      .post("/api/auth/register")
      .send({ email: "person@example.com", password: "correct-horse" });
    expect(registerRes.status).toBe(201);

    const protectedAfterRegister = await agent.get("/api/kits");
    expect(protectedAfterRegister.status).toBe(200);
    expect(protectedAfterRegister.body).toEqual([]);

    await agent.post("/api/auth/logout");

    const rejectedAfterLogout = await agent.get("/api/kits");
    expect(rejectedAfterLogout.status).toBe(401);

    const loginRes = await agent
      .post("/api/auth/login")
      .send({ email: "person@example.com", password: "correct-horse" });
    expect(loginRes.status).toBe(200);

    const protectedAfterLogin = await agent.get("/api/kits");
    expect(protectedAfterLogin.status).toBe(200);
  });

  it("rejects an unauthenticated request with 401, not a crash", async () => {
    const res = await request(app).get("/api/kits");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
  });

  it("GET /api/auth/me returns the current user when logged in, 401 when not", async () => {
    const agent = request.agent(app);
    const meBefore = await agent.get("/api/auth/me");
    expect(meBefore.status).toBe(401);

    await agent.post("/api/auth/register").send({ email: "me-check@example.com", password: "correct-horse" });
    const meAfter = await agent.get("/api/auth/me");
    expect(meAfter.status).toBe(200);
    expect(meAfter.body.email).toBe("me-check@example.com");
  });

  it("sets the auth cookie as SameSite=Lax, not Secure in development", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "cookie-dev@example.com", password: "correct-horse" });
    const setCookie = res.headers["set-cookie"]![0]!;
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Secure/i);
  });

  it("sets the auth cookie as SameSite=None; Secure in production, so it survives a cross-site request from a deployed frontend on a different domain", async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app).post("/api/auth/register").send({ email: "cookie-prod@example.com", password: "correct-horse" });
      const setCookie = res.headers["set-cookie"]![0]!;
      expect(setCookie).toMatch(/SameSite=None/i);
      expect(setCookie).toMatch(/Secure/i);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  it("rejects login with wrong password", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ email: "another@example.com", password: "correct-horse" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "another@example.com", password: "wrong-password" });
    expect(res.status).toBe(401);
  });
});
