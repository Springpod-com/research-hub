/**
 * Team access by work email address.
 *
 * Clerk's development and production instances give the same person
 * different user IDs, and nobody sees another person's ID, so administrators
 * grant access by email instead. When the address already belongs to a Clerk
 * account that has signed in, the member is created at once; otherwise an
 * invitation is stored and redeemed on that person's first request, matched
 * against the verified primary email of their Clerk account (the same rule
 * the initial administrator is matched by).
 */
import { clerkClient } from "@clerk/express";
import type { Invitation, Member, Workspace } from "../shared/types.js";
import { randomUUID } from "node:crypto";
import { audit, now } from "./domain.js";

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

type ClerkAccount = Awaited<ReturnType<typeof clerkClient.users.getUser>>;
/** The verified primary email of a Clerk account, lower-cased, or undefined. */
export function verifiedPrimaryEmail(user: ClerkAccount): string | undefined {
  const primary = user.emailAddresses.find(
    (e) => e.id === user.primaryEmailAddressId,
  );
  return primary && primary.verification?.status === "verified"
    ? normaliseEmail(primary.emailAddress)
    : undefined;
}

/**
 * The Clerk user ID whose verified primary email is `email`, when that
 * account exists in this instance (i.e. the person has signed in at least
 * once). Undefined when Clerk is not configured or nobody matches.
 */
export async function lookUpClerkUserByEmail(
  email: string,
): Promise<string | undefined> {
  if (!process.env.CLERK_SECRET_KEY) return undefined;
  const wanted = normaliseEmail(email);
  const { data } = await clerkClient.users.getUserList({
    emailAddress: [wanted],
    limit: 10,
  });
  return data.find((user) => verifiedPrimaryEmail(user) === wanted)?.id;
}

export const invitationsOf = (w: Workspace): Invitation[] =>
  (w.invitations ??= []);

/** Create or replace the invitation for an address (one per email). */
export function inviteByEmail(
  w: Workspace,
  by: Member,
  data: Pick<Invitation, "email" | "name" | "role">,
): Invitation {
  const email = normaliseEmail(data.email);
  const list = invitationsOf(w);
  const existing = list.find((i) => i.email === email);
  const invitation: Invitation = {
    id: existing?.id ?? randomUUID(),
    email,
    name: data.name,
    role: data.role,
    invitedBy: by.userId,
    invitedAt: now(),
  };
  if (existing) Object.assign(existing, invitation);
  else list.push(invitation);
  audit(w, by.userId, "Team access invitation saved", invitation.id);
  return invitation;
}

export function withdrawInvitation(w: Workspace, by: Member, id: string) {
  const list = invitationsOf(w);
  const index = list.findIndex((i) => i.id === id);
  if (index < 0) return false;
  list.splice(index, 1);
  audit(w, by.userId, "Team access invitation withdrawn", id);
  return true;
}

/**
 * First request from a signed-in account that is not yet a member: if its
 * verified primary email was invited, it becomes an active member with the
 * invited role and the invitation is consumed.
 */
export function redeemInvitation(
  w: Workspace,
  userId: string,
  email: string | undefined,
): Member | undefined {
  if (!email) return undefined;
  const wanted = normaliseEmail(email);
  const list = invitationsOf(w);
  const index = list.findIndex((i) => i.email === wanted);
  if (index < 0) return undefined;
  const [invitation] = list.splice(index, 1);
  const member: Member = {
    userId,
    name: invitation.name,
    role: invitation.role,
    active: true,
    email: wanted,
  };
  const existing = w.members.find((m) => m.userId === userId);
  if (existing) Object.assign(existing, member);
  else w.members.push(member);
  audit(w, userId, "Team access invitation redeemed", invitation.id);
  return existing ?? member;
}
