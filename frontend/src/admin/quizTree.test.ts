import { describe, expect, it } from "vitest";
import { buildQuizTree, folderKeys, isFolderKey } from "./quizTree";

const quiz = (filename: string) => ({ filename, title: null });

describe("buildQuizTree", () => {
  const tree = buildQuizTree([quiz("b.yaml"), quiz("grade5/math.yaml"), quiz("a.yaml"), quiz("grade5/algebra/x.yml"), quiz("art/draw.yaml")]);

  it("puts folders first, then quizzes, sorted by name", () => {
    expect(tree.map((node) => node.key)).toEqual(["folder:art/", "folder:grade5/", "a.yaml", "b.yaml"]);
    expect(tree[1].children!.map((node) => node.key)).toEqual(["folder:grade5/algebra/", "grade5/math.yaml"]);
  });

  it("names nodes by the last path part and counts quizzes in subfolders", () => {
    expect(tree[1].name).toBe("grade5");
    expect(tree[1].count).toBe(2);
    expect(tree[1].children![0].children![0]).toMatchObject({ name: "x.yml", quiz: { filename: "grade5/algebra/x.yml" } });
  });

  it("lists every folder key", () => {
    expect(folderKeys(tree)).toEqual(["folder:art/", "folder:grade5/", "folder:grade5/algebra/"]);
    expect(isFolderKey("folder:art/")).toBe(true);
    expect(isFolderKey("art.yaml")).toBe(false);
  });
});
