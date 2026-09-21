import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { clearTestDb, startTestDb, stopTestDb } from "./mongo-test-utils.js";

const app = createApp({
  jwtSecret: "test-secret",
  geminiConfig: { apiKey: undefined },
  // blocks the loopback URL used below, so a fire-and-forget background job
  // fails fast on the SSRF check instead of attempting real network calls
  urlValidatorOptions: { blockPrivateNetworks: true },
});

beforeAll(startTestDb);
afterEach(clearTestDb);
afterAll(stopTestDb);

async function registeredAgent() {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ email: "kits-user@example.com", password: "correct-horse" });
  return agent;
}

describe("kits routes — structured error responses", () => {
  it("returns a structured INVALID_INPUT error for a malformed create request", async () => {
    const agent = await registeredAgent();
    const res = await agent.post("/api/kits").send({ jd: "", companyUrl: "not-a-url", days: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns a structured NOT_FOUND error for a kit that doesn't exist", async () => {
    const agent = await registeredAgent();
    const res = await agent.get(`/api/kits/${new mongoose.Types.ObjectId().toString()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns a structured INVALID_INPUT error for an unknown regeneration section", async () => {
    const agent = await registeredAgent();
    const res = await agent.post(`/api/kits/${new mongoose.Types.ObjectId().toString()}/regenerate/not-a-section`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("scopes kit access to the requesting user (a stranger's kit id looks like NOT_FOUND, not FORBIDDEN)", async () => {
    const ownerAgent = await registeredAgent();
    const createRes = await ownerAgent
      .post("/api/kits")
      .send({ jd: "Some JD", companyUrl: "http://127.0.0.1/test", days: 3 });
    expect(createRes.status).toBe(202);

    const strangerAgent = request.agent(app);
    await strangerAgent.post("/api/auth/register").send({ email: "stranger@example.com", password: "correct-horse" });

    const res = await strangerAgent.get(`/api/kits/${createRes.body._id}`);
    expect(res.status).toBe(404);
  });

  it("accepts a well-formed create request and returns the pending kit immediately", async () => {
    const agent = await registeredAgent();
    const res = await agent.post("/api/kits").send({ jd: "Some JD", companyUrl: "http://127.0.0.1/test", days: 3 });
    expect(res.status).toBe(202);
    expect(res.body.job.status).toBe("pending");
  });

  it("rejects an unauthenticated request to any kits route with 401", async () => {
    const res = await request(app).get("/api/kits");
    expect(res.status).toBe(401);
  });
});
