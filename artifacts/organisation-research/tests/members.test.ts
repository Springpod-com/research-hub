import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import { redeemInvitation } from "../server/members.js";
import { sampleWorkspace, reviewer } from "./fixtures.js";
import type { Member, Workspace } from "../shared/types.js";

// The sign-in path is exercised with Clerk stubbed: the middleware lets every
// request through as `signedIn`, and the account lookup returns `account`.
const signedIn = { userId: "" };
const account = { primaryEmail: "", verified: true, lookups: 0 };
vi.mock("@clerk/express", () => ({
  clerkMiddleware:
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: () => ({ userId: signedIn.userId || null }),
  clerkClient: {
    users: {
      getUser: async (id: string) => ({
        id: (account.lookups++, id),
        primaryEmailAddressId: "em_1",
        emailAddresses: [
          {
            id: "em_1",
            emailAddress: account.primaryEmail,
            verification: { status: account.verified ? "verified" : "unverified" },
          },
        ],
      }),
      getUserList: async () => ({ data: [], totalCount: 0 }),
    },
  },
}));

let store: Store;
const admin: Member = { ...reviewer, userId: "user_admin", role: "admin" };
const asAdmin = (lookUp?: (email: string) => Promise<string | undefined>) =>
  createApp(store, { testMember: admin, lookUpUserByEmail: lookUp });
const asReviewer = () => createApp(store, { testMember: reviewer });
const members = async () => (await store.read()).members;
const invitations = async () => (await store.read()).invitations ?? [];

beforeAll(async () => {
  store = await Store.open();
  await store.init();
});
beforeEach(async () => {
  const fixture: Workspace = sampleWorkspace();
  await store.transact((w) => Object.assign(w, fixture, { invitations: [] }));
});
afterAll(async () => {
  await store.close();
});

describe("team access by email", () => {
  it("adds a member at once when the address has already signed in", async () => {
    const lookUp = vi.fn(async (email: string) =>
      email === "zoe.bracegirdle@springpod.com" ? "user_zoe" : undefined,
    );
    const r = await request(asAdmin(lookUp)).post("/api/members").send({
      email: " Zoe.Bracegirdle@Springpod.com ",
      name: "Zoe Bracegirdle",
      role: "researcher",
      active: true,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      userId: "user_zoe",
      email: "zoe.bracegirdle@springpod.com",
      role: "researcher",
      active: true,
    });
    expect(lookUp).toHaveBeenCalledWith("zoe.bracegirdle@springpod.com");
    expect(await members()).toContainEqual(r.body);
    expect(await invitations()).toEqual([]);
  });

  it("stores an invitation when nobody with that address has signed in yet", async () => {
    const r = await request(asAdmin()).post("/api/members").send({
      email: "zoe.bracegirdle@springpod.com",
      name: "Zoe Bracegirdle",
      role: "reviewer",
      active: true,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      email: "zoe.bracegirdle@springpod.com",
      role: "reviewer",
      invitedBy: "user_admin",
    });
    expect(r.body.invitedAt).toBeTruthy();
    expect((await members()).some((m) => m.name === "Zoe Bracegirdle")).toBe(false);
    // One invitation per address: saving again replaces it.
    const again = await request(asAdmin()).post("/api/members").send({
      email: "zoe.bracegirdle@springpod.com",
      name: "Zoe B",
      role: "admin",
      active: true,
    });
    expect(again.status).toBe(200);
    const list = await invitations();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: r.body.id, name: "Zoe B", role: "admin" });
    // Administrators see invitations in the workspace; other roles do not.
    const adminView = await request(asAdmin()).get("/api/workspace");
    expect(adminView.body.invitations).toHaveLength(1);
    const reviewerView = await request(asReviewer()).get("/api/workspace");
    expect(reviewerView.body.invitations).toEqual([]);
    expect(Object.keys(reviewerView.body.members[0]).sort()).toEqual(["name", "userId"]);
  });

  it("rejects requests with neither an email nor a user ID, and revoking an invitation", async () => {
    const r = await request(asAdmin()).post("/api/members").send({
      name: "Nobody",
      role: "researcher",
      active: true,
    });
    expect(r.status).toBe(422);
    const revoke = await request(asAdmin()).post("/api/members").send({
      email: "nobody@springpod.com",
      name: "Nobody",
      role: "researcher",
      active: false,
    });
    expect(revoke.status).toBe(422);
    expect(await invitations()).toEqual([]);
  });

  it("still edits existing members by user ID", async () => {
    const r = await request(asAdmin()).post("/api/members").send({
      userId: reviewer.userId,
      name: "Alex Morgan",
      role: "researcher",
      active: false,
    });
    expect(r.status).toBe(200);
    expect((await members()).find((m) => m.userId === reviewer.userId)).toMatchObject({
      role: "researcher",
      active: false,
    });
  });

  it("lets an administrator withdraw an invitation; others may not", async () => {
    const created = await request(asAdmin()).post("/api/members").send({
      email: "zoe.bracegirdle@springpod.com",
      name: "Zoe Bracegirdle",
      role: "researcher",
      active: true,
    });
    const id = created.body.id as string;
    expect((await request(asReviewer()).delete(`/api/invitations/${id}`)).status).toBe(403);
    expect((await request(asAdmin()).delete(`/api/invitations/${id}`)).status).toBe(200);
    expect(await invitations()).toEqual([]);
    expect((await request(asAdmin()).delete(`/api/invitations/${id}`)).status).toBe(404);
    const audit = (await store.read()).audit.map((a) => a.action);
    expect(audit).toContain("Team access invitation saved");
    expect(audit).toContain("Team access invitation withdrawn");
  });

  it("redeems an invitation on the first request from the matching account", async () => {
    await request(asAdmin()).post("/api/members").send({
      email: "zoe.bracegirdle@springpod.com",
      name: "Zoe Bracegirdle",
      role: "researcher",
      active: true,
    });
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_stub");
    vi.stubEnv("CLERK_PUBLISHABLE_KEY", "pk_test_stub");
    const app = createApp(store);
    // A signed-in account with another address is still refused.
    signedIn.userId = "user_stranger";
    account.primaryEmail = "someone.else@springpod.com";
    expect((await request(app).get("/api/workspace")).status).toBe(403);
    // An unverified primary email does not count.
    signedIn.userId = "user_zoe";
    account.primaryEmail = "zoe.bracegirdle@springpod.com";
    account.verified = false;
    expect((await request(app).get("/api/workspace")).status).toBe(403);
    // The invited person, once verified, is a member from this request on.
    account.verified = true;
    const first = await request(app).get("/api/workspace");
    expect(first.status).toBe(200);
    expect(await invitations()).toEqual([]);
    expect((await members()).find((m) => m.userId === "user_zoe")).toEqual({
      userId: "user_zoe",
      name: "Zoe Bracegirdle",
      role: "researcher",
      active: true,
      email: "zoe.bracegirdle@springpod.com",
    });
    expect((await request(app).get("/api/workspace")).status).toBe(200);
    expect((await store.read()).audit.map((a) => a.action)).toContain(
      "Team access invitation redeemed",
    );
    vi.unstubAllEnvs();
  });

  it("provisions the configured administrator ahead of any invitation", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_stub");
    vi.stubEnv("CLERK_PUBLISHABLE_KEY", "pk_test_stub");
    await request(asAdmin()).post("/api/members").send({
      email: "owner@springpod.com",
      name: "Owner as researcher",
      role: "researcher",
      active: true,
    });
    // By Clerk user ID: no Clerk call at all, even though an invitation exists.
    vi.stubEnv("BOOTSTRAP_ADMIN_IDS", "user_owner_id");
    signedIn.userId = "user_owner_id";
    account.primaryEmail = "unrelated@springpod.com";
    account.lookups = 0;
    expect((await request(createApp(store)).get("/api/workspace")).status).toBe(200);
    expect(account.lookups).toBe(0);
    expect((await members()).find((m) => m.userId === "user_owner_id")).toMatchObject({
      role: "admin",
      active: true,
    });
    // By verified email: administrator, and the lesser invitation is withdrawn.
    vi.stubEnv("BOOTSTRAP_ADMIN_IDS", "");
    vi.stubEnv("BOOTSTRAP_ADMIN_EMAILS", "Owner@Springpod.com");
    signedIn.userId = "user_owner_email";
    account.primaryEmail = "owner@springpod.com";
    expect((await request(createApp(store)).get("/api/workspace")).status).toBe(200);
    expect((await members()).find((m) => m.userId === "user_owner_email")).toMatchObject({
      role: "admin",
      active: true,
      email: "owner@springpod.com",
    });
    expect(await invitations()).toEqual([]);
    vi.unstubAllEnvs();
  });

  it("redeemInvitation is a no-op without a matching verified email", () => {
    const w = sampleWorkspace();
    w.invitations = [
      {
        id: "inv_1",
        email: "zoe.bracegirdle@springpod.com",
        name: "Zoe",
        role: "researcher",
        invitedBy: "user_admin",
        invitedAt: new Date().toISOString(),
      },
    ];
    const before = JSON.stringify(w);
    expect(redeemInvitation(w, "user_zoe", undefined)).toBeUndefined();
    expect(redeemInvitation(w, "user_zoe", "other@springpod.com")).toBeUndefined();
    expect(JSON.stringify(w)).toBe(before);
    expect(redeemInvitation(w, "user_zoe", "ZOE.Bracegirdle@springpod.com")).toMatchObject({
      userId: "user_zoe",
      active: true,
    });
    expect(w.invitations).toEqual([]);
  });
});
