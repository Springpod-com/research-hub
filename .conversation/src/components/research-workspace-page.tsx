import type { ReactNode } from "react";

/**
 * Adapted from Employer Intelligence's OrgWorkspacePage.
 * Keeps its layout without importing API-connected organisation navigation.
 * The surrounding app shell supplies the outer page gutters.
 */
export function ResearchWorkspacePage({
  navigation,
  children,
  className = "",
}: {
  navigation?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`w-full max-w-[1280px] mx-auto flex flex-1 flex-col min-w-0 pb-10 ${className}`}
      data-testid="research-workspace-page"
    >
      {navigation}
      {children}
    </div>
  );
}
