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

// The quizzes/ folder itself, shown as the top row so it can be selected for new quizzes
export const ROOT_FOLDER_KEY = "folder:";
export const ROOT_FOLDER_NAME = "quizzes";

export const folderKey = (folder: string) => `folder:${folder}`;

// "grade5/" for the folder row "folder:grade5/" or for the quiz "grade5/math.yaml"; "" is quizzes/ itself
export function folderOf(key: string): string {
  if (isFolderKey(key)) return key.slice("folder:".length);
  return key.includes("/") ? key.slice(0, key.lastIndexOf("/") + 1) : "";
}

const byName = (a: QuizTreeNode, b: QuizTreeNode) => a.name.localeCompare(b.name);

// "grade5/math.yaml" goes under the folder "grade5"; folders come before quizzes, each sorted by name.
// Folders from the server's list ("empty/") show even without quizzes.
export function buildQuizTree(quizzes: QuizInfo[], folders: string[] = []): QuizTreeNode[] {
  const root: QuizTreeNode = { key: ROOT_FOLDER_KEY, name: "", children: [] };
  // The node of a folder path like "grade5/algebra/", created with its parents when missing
  const folderNode = (parts: string[]) => {
    let node = root;
    let path = "";
    for (const part of parts) {
      path += `${part}/`;
      let folder = node.children!.find((child) => child.key === folderKey(path));
      if (!folder) {
        folder = { key: folderKey(path), name: part, children: [] };
        node.children!.push(folder);
      }
      node = folder;
    }
    return node;
  };
  for (const folder of folders) folderNode(folder.split("/").filter(Boolean));
  for (const quiz of quizzes) {
    const parts = quiz.filename.split("/");
    folderNode(parts.slice(0, -1)).children!.push({ key: quiz.filename, name: parts[parts.length - 1], quiz });
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

// The whole list under one row for quizzes/ itself
export function quizRoot(quizzes: QuizInfo[], folders: string[] = []): QuizTreeNode[] {
  return [{ key: ROOT_FOLDER_KEY, name: ROOT_FOLDER_NAME, children: buildQuizTree(quizzes, folders), count: quizzes.length }];
}

export function findNode(nodes: QuizTreeNode[], key: string): QuizTreeNode | null {
  for (const node of nodes) {
    if (node.key === key) return node;
    const found = node.children ? findNode(node.children, key) : null;
    if (found) return found;
  }
  return null;
}

export function folderKeys(nodes: QuizTreeNode[]): string[] {
  return nodes.flatMap((node) => (node.children ? [node.key, ...folderKeys(node.children)] : []));
}
