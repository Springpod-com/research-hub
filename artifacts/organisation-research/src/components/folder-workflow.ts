import {
  sections,
  type Folder,
  type ResearchJob,
  type SectionSummary,
  type Source,
} from "../../shared/types";

export const sectionSelectionReason = (
  section: SectionSummary,
  roleId?: string,
) =>
  section.roleScoped && !roleId
    ? "Choose a role to use this folder"
    : !(section.readableSourceIds || section.sourceIds).length
      ? "Add at least one source first"
      : undefined;

export const noteRoleIds = (folder: Folder, roleId?: string): string[] => {
  const section = sections.find((item) => item.folder === folder);
  if (!section?.roleScoped) return [];
  if (!roleId) throw new Error("Choose a role for this folder.");
  return [roleId];
};

export const canEditSectionNote = (
  section: Pick<SectionSummary, "roleScoped">,
  canEdit: boolean,
  roleId?: string,
) => canEdit && (!section.roleScoped || !!roleId);

export const runWorkspaceAction = async (
  action: () => Promise<unknown>,
  reloadWorkspace: () => Promise<unknown>,
  afterReload?: () => Promise<unknown>,
) => {
  await action();
  await reloadWorkspace();
  await afterReload?.();
};

export const extractionSourceIds = (
  sources: Pick<Source, "id" | "folder">[],
  folder: Folder,
) => {
  const organisationFolder = sections.find(
    (item) => item.section === "organisation",
  )!.folder;
  const own = sources.filter((source) => source.folder === folder);
  const context =
    folder === organisationFolder
      ? []
      : sources.filter((source) => source.folder === organisationFolder);
  return [...own, ...context].slice(0, 16).map((source) => source.id);
};

export const retryResearchBody = (job: ResearchJob) => ({
  tier: job.tier,
  roleId: job.roleId,
  sections: job.sections,
  sourceIds: job.sourceIds,
  crawl: job.crawl,
});

export const validFolderSection = (
  section: string,
  summaries: SectionSummary[],
) => summaries.some((summary) => summary.section === section);