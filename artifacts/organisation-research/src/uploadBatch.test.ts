import { describe, expect, it } from "vitest";
import { uploadFiles } from "./uploadBatch";

const file = (name: string) => new File(["bytes"], name);

describe("uploadFiles", () => {
  it("uploads in order and preserves the result shape", async () => {
    const order: string[] = [];
    let releaseFirst = () => {};
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const pending = uploadFiles(
      [file("one.png"), file("two.pdf")],
      { title: "Ignored", caption: "Shared" },
      async (current) => {
        order.push(current.name);
        if (current.name === "one.png") await firstDone;
        return { id: current.name };
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The second file must not start until the first has finished.
    expect(order).toEqual(["one.png"]);
    releaseFirst();
    const result = await pending;

    expect(order).toEqual(["one.png", "two.pdf"]);
    expect(result).toEqual({
      uploaded: [{ id: "one.png" }, { id: "two.pdf" }],
      failed: [],
    });
  });

  it("continues after a failure", async () => {
    const order: string[] = [];
    const result = await uploadFiles(
      [file("one.png"), file("bad.pdf"), file("three.jpg")],
      { title: "" },
      async (current) => {
        order.push(current.name);
        if (current.name === "bad.pdf") throw new Error("Scanner unavailable.");
        return { id: current.name };
      },
    );

    expect(order).toEqual(["one.png", "bad.pdf", "three.jpg"]);
    expect(result).toEqual({
      uploaded: [{ id: "one.png" }, { id: "three.jpg" }],
      failed: [{ name: "bad.pdf", message: "Scanner unavailable." }],
    });
  });

  it("uses file names as titles for several files", async () => {
    const titles: string[] = [];
    await uploadFiles(
      [file("one.png"), file("two.pdf")],
      { title: "Typed title" },
      async (_current, meta) => {
        titles.push(meta.title);
        return meta;
      },
    );
    expect(titles).toEqual(["one.png", "two.pdf"]);
  });

  it("keeps the typed title for one file", async () => {
    let title = "";
    await uploadFiles(
      [file("one.png")],
      { title: "Typed title" },
      async (_current, meta) => {
        title = meta.title;
        return meta;
      },
    );
    expect(title).toBe("Typed title");
  });

  it("folds ZIP source views into uploaded results", async () => {
    const result = await uploadFiles(
      [file("images.zip")],
      { title: "" },
      async () => ({ sources: [{ id: "a" }, { id: "b" }] }),
    );
    expect(result).toEqual({
      uploaded: [{ id: "a" }, { id: "b" }],
      failed: [],
    });
  });
});
