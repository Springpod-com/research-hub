export type UploadBatchFailure = {
  name: string;
  message: string;
};

export async function uploadFiles<T>(
  files: readonly File[],
  meta: Readonly<Record<string, string>>,
  post: (
    file: File,
    meta: Record<string, string>,
  ) => Promise<T | { sources: T[] }>,
): Promise<{ uploaded: T[]; failed: UploadBatchFailure[] }> {
  const uploaded: T[] = [];
  const failed: UploadBatchFailure[] = [];
  const several = files.length > 1;

  for (const file of files) {
    try {
      const result = await post(file, {
        ...meta,
        title: several ? file.name : meta.title,
      });
      if (
        result &&
        typeof result === "object" &&
        "sources" in result &&
        Array.isArray(result.sources)
      )
        uploaded.push(...result.sources);
      else uploaded.push(result as T);
    } catch (error) {
      failed.push({
        name: file.name,
        message: error instanceof Error ? error.message : "The upload failed.",
      });
    }
  }

  return { uploaded, failed };
}
