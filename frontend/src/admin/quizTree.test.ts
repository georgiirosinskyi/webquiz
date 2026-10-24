import { describe, expect, it } from "vitest";
import { ROOT_FOLDER_KEY, buildQuizTree, findNode, folderKey, folderKeys, folderOf, isFolderKey, quizRoot } from "./quizTree";

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

describe("folders", () => {
  it("shows empty folders from the server's folder list", () => {
    const tree = buildQuizTree([quiz("grade5/math.yaml")], ["empty/", "grade5/", "grade5/new/"]);
    expect(folderKeys(tree)).toEqual(["folder:empty/", "folder:grade5/", "folder:grade5/new/"]);
    expect(tree[0]).toMatchObject({ name: "empty", count: 0, children: [] });
    expect(tree[1].children!.map((node) => node.key)).toEqual(["folder:grade5/new/", "grade5/math.yaml"]);
  });

  it("puts everything under the root folder, which can be selected too", () => {
    const [root] = quizRoot([quiz("a.yaml"), quiz("grade5/math.yaml")], []);
    expect(root).toMatchObject({ key: ROOT_FOLDER_KEY, count: 2 });
    expect(isFolderKey(root.key)).toBe(true);
    expect(root.children!.map((node) => node.key)).toEqual(["folder:grade5/", "a.yaml"]);
  });

  it("gives the folder of a folder row or of a quiz", () => {
    expect(folderOf(ROOT_FOLDER_KEY)).toBe("");
    expect(folderOf("folder:grade5/algebra/")).toBe("grade5/algebra/");
    expect(folderOf("grade5/math.yaml")).toBe("grade5/");
    expect(folderOf("a.yaml")).toBe("");
    expect(folderKey("grade5/")).toBe("folder:grade5/");
    expect(folderKey("")).toBe(ROOT_FOLDER_KEY);
  });

  it("finds a node anywhere in the tree", () => {
    const tree = quizRoot([quiz("grade5/algebra/x.yaml")], []);
    expect(findNode(tree, "folder:grade5/algebra/")).toMatchObject({ name: "algebra", count: 1 });
    expect(findNode(tree, "grade5/algebra/x.yaml")?.quiz?.filename).toBe("grade5/algebra/x.yaml");
    expect(findNode(tree, "folder:none/")).toBeNull();
  });
});
