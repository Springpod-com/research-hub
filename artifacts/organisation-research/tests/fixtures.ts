import { base, now } from "../server/domain.js";
import {
  emptyWorkspace,
  type Workspace,
  type Member,
} from "../shared/types.js";
export const reviewer: Member = {
  userId: "user_reviewer",
  name: "Alex Morgan",
  role: "reviewer",
  active: true,
};
export function sampleWorkspace(): Workspace {
  const w = emptyWorkspace();
  w.members = [
    reviewer,
    { userId: "user_admin", name: "Sam Taylor", role: "admin", active: true },
  ];
  const o = {
    ...base(),
    name: "Northstar Logistics",
    website: "",
    country: "United Kingdom",
    division: "Distribution",
    owner: "Alex Morgan",
    summary:
      "Fictional demonstration organisation. Explore how source material becomes an evidence-backed brief for a day in logistics.",
    brandNotes: "Sample only. No organisation branding or permissions implied.",
    factChecker: { name: "not yet known", jobTitle: "" },
  };
  w.organisations.push(o);
  const role = {
    ...base(),
    orgId: o.id,
    title: "Warehouse coordinator",
    location: "Manchester distribution centre (fictional)",
    seniority: "Entry level",
    responsibilities:
      "Coordinate incoming deliveries, check order records and prepare a clear shift handover.",
    boundaries:
      "Escalation rules and decision authority need organisation confirmation.",
    occupations: [],
  };
  w.roles.push(role);
  const text =
    "This fictional warehouse team checks incoming deliveries against purchase orders. Coordinators record quantity differences and prepare a handover for the next shift. They work with a team leader and delivery drivers.";
  const source = {
    ...base(),
    orgId: o.id,
    roleIds: [role.id],
    title: "Sample role brief — fictional",
    kind: "statement" as const,
    url: "",
    text,
    locator: "Role brief, paragraph 1",
    permission: "research-only" as const,
    verification: "user-supplied" as const,
    suppliedBy: "Synthetic demonstration fixture",
    publishedAt: "",
    retrievedAt: now(),
    runIds: [],
  };
  w.sources.push(source);
  w.findings.push({
    ...base(),
    orgId: o.id,
    roleId: role.id,
    kind: "company",
    claim:
      "The coordinator checks incoming deliveries against purchase orders.",
    citations: [
      {
        sourceId: source.id,
        quote:
          "This fictional warehouse team checks incoming deliveries against purchase orders.",
        locator: "Paragraph 1",
      },
    ],
    review: "unreviewed",
    rationale:
      "Fictional demonstration evidence. Confirm scope with the actual organisation.",
    runIds: [],
    history: [],
  });
  w.questions.push({
    ...base(),
    orgId: o.id,
    roleId: role.id,
    text: "Who decides what happens when a delivery quantity differs?",
    why: "Sets the learner’s decision boundary and the colleague feedback.",
    blocking: false,
    status: "client",
    answer: "",
    assignee: "Alex Morgan",
    provenance: "",
    runIds: [],
  });
  w.activities.push({
    ...base(),
    orgId: o.id,
    roleId: role.id,
    title: "Check the morning delivery",
    action:
      "Compare a delivery note with the purchase order and record any quantity differences.",
    output: "An annotated delivery discrepancy record.",
    materials:
      "Synthetic purchase order, delivery note and approved checking guidance.",
    learning: "How careful checks keep accurate stock records.",
    confirmation:
      "Confirm that this role performs the check and the escalation route.",
    findingIds: [w.findings[0].id],
    review: "unreviewed",
    runIds: [],
  });
  for (const [name, division, summary] of [
    [
      "Elmbridge Engineering",
      "Manufacturing",
      "Fictional example for exploring production roles.",
    ],
    [
      "Coastline Hospitality",
      "Guest experience",
      "Fictional example for exploring customer-facing roles.",
    ],
  ])
    w.organisations.push({
      ...base(),
      name,
      division,
      summary,
      website: "",
      country: "United Kingdom",
      owner: "Sam Taylor",
      brandNotes: "",
    });
  return w;
}
