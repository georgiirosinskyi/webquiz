import type { QuizInfo } from "./types";

// A row of the quiz list: a folder (key "folder:<path>/") with children, or a quiz (key = its filename).
export interface QuizTreeNode {
  key: string;
  name: string;
  quiz?: QuizInfo;
  children?: QuizTreeNode[];
  // Quizzes inside a folder, subfolders included
  count?: number;
}

export const isFolderKey = (key: string) => key.startsWith("folder:");

const byName = (a: QuizTreeNode, b: QuizTreeNode) => a.name.localeCompare(b.name);

// "grade5/math.yaml" goes under the folder "grade5"; folders come before quizzes, each sorted by name.
export function buildQuizTree(quizzes: QuizInfo[]): QuizTreeNode[] {
  const root: QuizTreeNode = { key: "folder:", name: "", children: [] };
  for (const quiz of quizzes) {
    const parts = quiz.filename.split("/");
    let node = root;
    let path = "";
    for (const part of parts.slice(0, -1)) {
      path += `${part}/`;
      let folder = node.children!.find((child) => child.key === `folder:${path}`);
      if (!folder) {
        folder = { key: `folder:${path}`, name: part, children: [] };
        node.children!.push(folder);
      }
      node = folder;
    }
    node.children!.push({ key: quiz.filename, name: parts[parts.length - 1], quiz });
  }
  const finish = (node: QuizTreeNode): number => {
    const children = node.children!;
    const folders = children.filter((child) => child.children).sort(byName);
    const files = children.filter((child) => !child.children).sort(byName);
    node.children = [...folders, ...files];
    node.count = files.length + folders.reduce((sum, folder) => sum + finish(folder), 0);
    return node.count;
  };
  finish(root);
  return root.children!;
}

export function folderKeys(nodes: QuizTreeNode[]): string[] {
  return nodes.flatMap((node) => (node.children ? [node.key, ...folderKeys(node.children)] : []));
}
