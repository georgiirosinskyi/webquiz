import { useMemo, useState } from "react";
import { App, Button, Card, Flex, Input, Modal, Space, Table, Tag, Tooltip, Typography } from "antd";
import {
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  MergeCellsOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { apiGet, apiSend, downloadFile } from "../shared/api";
import { TransferPanel } from "../files/TransferPanel";
import { transferKey } from "../files/types";
import { useTransfer } from "../files/useTransfer";
import { t } from "../shared/i18n";
import { formatPoints } from "../shared/points";
import { formatDuration } from "./overview";
import { fileNameError, folderNameError } from "./quizForm";
import { ROOT_FOLDER_KEY, ROOT_FOLDER_NAME, findNode, folderKey, folderOf, isFolderKey, quizRoot, type QuizTreeNode } from "./quizTree";
import type { QuizInfo, QuizList } from "./types";
import type { EditorTarget } from "./QuizEditor";
import { QuizYamlEditor } from "./QuizYamlEditor";

// onOk returns false to keep the prompt open (the request failed); validate gives the error for a value
type NamePrompt = {
  title: string;
  value: string;
  onOk: (name: string) => Promise<boolean>;
  validate?: (name: string) => string | null;
} | null;

const folderLabel = (folder: string) => `${ROOT_FOLDER_NAME}/${folder}`;

// Settings that differ from the defaults, as tags
function SettingTags({ quiz }: { quiz: QuizInfo }) {
  return (
    <Space size={[4, 4]} wrap>
      {quiz.randomize_questions && <Tag color="purple">{t("overview.shuffle")}</Tag>}
      {quiz.allow_skip_questions && <Tag color="cyan">{t("overview.can_skip")}</Tag>}
      {quiz.show_right_answer === false && <Tag>{t("quizzes.no_right_answer")}</Tag>}
      {quiz.show_answers_on_completion && <Tag color="blue">{t("quizzes.answers_after_all")}</Tag>}
      {quiz.show_final_list === false && <Tag>{t("quizzes.no_final_list")}</Tag>}
    </Space>
  );
}

export function QuizzesCard({
  list,
  reload,
  onEdit,
}: {
  list: QuizList;
  reload: () => Promise<void>;
  onEdit: (target: EditorTarget) => void;
}) {
  const { message, modal } = App.useApp();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<NamePrompt>(null);
  const [promptValue, setPromptValue] = useState("");
  const current = list.current_quiz;
  const single = selected.length === 1 ? selected[0] : null;
  const [transfer, reloadTransfer] = useTransfer();
  const [yamlFile, setYamlFile] = useState<string | null>(null);
  const tree = useMemo(() => quizRoot(list.quizzes, list.folders ?? []), [list.quizzes, list.folders]);
  // Folders are closed until the admin opens them; quizzes/ itself is open
  const [expanded, setExpanded] = useState<string[]>([ROOT_FOLDER_KEY]);
  const toggleFolder = (key: string) =>
    setExpanded((keys) => (keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]));
  const expandFolders = (...keys: string[]) => setExpanded((current) => [...new Set([...current, ...keys])]);
  // Where new quizzes and folders go: the clicked folder, or the folder of the clicked quiz
  const [folder, setFolder] = useState("");

  const askName = (
    title: string,
    value: string,
    onOk: (name: string) => Promise<boolean>,
    validate?: (name: string) => string | null,
  ) => {
    setPromptValue(value);
    setPrompt({ title, value, onOk, validate });
  };
  const promptError = prompt?.validate && promptValue.trim() ? prompt.validate(promptValue) : null;

  const selectFolder = (key: string) => {
    setFolder(folderOf(key));
    setSelected([]);
    expandFolders(key);
  };

  // The selected folder below quizzes/ (rename and delete; quizzes/ itself stays)
  const folderNode = folder ? findNode(tree, folderKey(folder)) : null;
  const folderHasCurrent = !!folder && !!current && current.startsWith(folder);
  // A clicked folder: no quiz is selected then
  const folderSelected = !!folder && selected.length === 0;
  const folderName = folder.slice(folder.slice(0, -1).lastIndexOf("/") + 1, -1);
  const parentFolder = folder.slice(0, folder.length - folderName.length - 1);

  const renameFolder = () => {
    askName(
      t("quizzes.rename_folder_prompt", { folder: folderLabel(folder) }),
      folderName,
      async (name) => {
        const result = await apiSend<{ folder: string; message: string }>("POST", "/api/admin/rename-folder", {
          folder,
          new_name: name,
        });
        if (!result.ok) {
          message.error(result.data.error || t("quizzes.folder_failed"));
          return false;
        }
        message.success(result.data.message);
        // Opened folders inside keep open under the new name
        const renamed = result.data.folder;
        const oldKey = folderKey(folder);
        setExpanded((keys) =>
          keys.map((key) => (key.startsWith(oldKey) ? folderKey(renamed + key.slice(oldKey.length)) : key)),
        );
        setFolder(renamed);
        await reload();
        return true;
      },
      folderNameError,
    );
  };

  const deleteFolder = () => {
    const target = folder;
    modal.confirm({
      title: t("quizzes.delete_folder_title", { folder: folderLabel(target) }),
      content: t("quizzes.delete_folder_content", { count: folderNode?.count ?? 0 }),
      okType: "danger",
      okText: t("common.delete"),
      onOk: async () => {
        const result = await apiSend<{ message: string }>("POST", "/api/admin/delete-folder", { folder: target });
        if (!result.ok) {
          message.error(result.data.error || t("quizzes.folder_failed"));
          return;
        }
        message.success(result.data.message);
        setFolder(parentFolder);
        await reload();
      },
    });
  };

  const createFolder = () => {
    askName(
      t("quizzes.new_folder_prompt", { folder: folderLabel(folder) }),
      "",
      async (name) => {
        const result = await apiSend<{ folder: string; message: string }>("POST", "/api/admin/create-folder", {
          folder: folder + name,
        });
        if (!result.ok) {
          message.error(result.data.error || t("quizzes.create_folder_failed"));
          return false;
        }
        message.success(result.data.message);
        await reload();
        expandFolders(folderKey(folder), folderKey(result.data.folder));
        setFolder(result.data.folder);
        setSelected([]);
        return true;
      },
      folderNameError,
    );
  };

  const openEditor = async (filename: string) => {
    const result = await apiGet<{ parsed: Record<string, unknown>; content: string }>(
      `/api/admin/quiz/${encodeURIComponent(filename)}`,
    );
    if (result.ok) onEdit({ mode: "edit", filename, parsed: result.data.parsed || null });
    else message.error(result.data.error || t("quizzes.load_failed"));
  };

  const switchQuiz = async () => {
    if (!single) return;
    const restart = single === current;
    setBusy("switch");
    try {
      const result = await apiSend<{ run: string }>("POST", "/api/admin/switch-quiz", { quiz_filename: single });
      if (result.ok) {
        message.success(t(restart ? "quizzes.restarted" : "quizzes.switched", { name: single, csv: result.data.run }));
        setSelected([]);
        await reload();
      } else {
        message.error(result.data.error || t(restart ? "quizzes.restart_failed" : "quizzes.switch_failed"));
      }
    } catch (error) {
      message.error(t("common.error", { error: (error as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const duplicate = () => {
    if (!single) return;
    // The copy goes next to the original
    const target = folderOf(single);
    const baseName = single.slice(target.length).replace(/\.ya?ml$/, "");
    askName(
      t("quizzes.duplicate_prompt", { folder: folderLabel(target) }),
      `${baseName}_copy`,
      async (name) => {
        const original = await apiGet<{ content: string }>(`/api/admin/quiz/${encodeURIComponent(single)}`);
        if (!original.ok) {
          message.error(original.data.error || t("quizzes.load_original_failed"));
          return false;
        }
        const created = await apiSend<{ filename: string }>("POST", "/api/admin/create-quiz", {
          filename: target + name,
          mode: "text",
          content: original.data.content,
        });
        if (!created.ok) {
          message.error(created.data.error || t("quizzes.duplicate_failed"));
          return false;
        }
        message.success(t("quizzes.duplicated", { name: created.data.filename }));
        await reload();
        await openEditor(created.data.filename);
        return true;
      },
      fileNameError,
    );
  };

  const unite = () => {
    // The united quiz goes into the folder of the first one
    const target = folderOf(selected[0]);
    askName(
      t("quizzes.unite_prompt", { count: selected.length, folder: folderLabel(target) }),
      `${selected[0].slice(target.length).replace(/\.ya?ml$/, "")}_united`,
      async (name) => {
        const result = await apiSend<{ filename: string; total_questions: number; warning?: string }>(
          "POST",
          "/api/admin/unite-quizzes",
          { quiz_filenames: selected, new_name: target + name },
        );
        if (!result.ok) {
          message.error(result.data.error || t("quizzes.unite_failed"));
          return false;
        }
        message.success(
          t("quizzes.united", { name: result.data.filename, count: result.data.total_questions }) +
            (result.data.warning ? `. ${result.data.warning}` : ""),
        );
        setSelected([]);
        await reload();
        await openEditor(result.data.filename);
        return true;
      },
      fileNameError,
    );
  };

  const remove = () => {
    const names = [...selected];
    modal.confirm({
      title: names.length === 1 ? t("quizzes.delete_one", { name: names[0] }) : t("quizzes.delete_many", { count: names.length }),
      content: t("quizzes.delete_content"),
      okType: "danger",
      okText: t("common.delete"),
      onOk: async () => {
        const errors: string[] = [];
        for (const name of names) {
          const result = await apiSend("DELETE", `/api/admin/quiz/${encodeURIComponent(name)}`);
          if (!result.ok) errors.push(`${name}: ${result.data.error || result.status}`);
        }
        const deleted = names.length - errors.length;
        if (errors.length === 0) message.success(t("quizzes.deleted", { count: deleted }));
        else if (deleted > 0) message.warning(t("quizzes.deleted_partly", { count: deleted, errors: errors.join(", ") }));
        else message.error(t("quizzes.delete_failed", { errors: errors.join(", ") }));
        setSelected([]);
        await reload();
      },
    });
  };

  const download = async () => {
    for (const name of selected) {
      const error = await downloadFile(`/api/admin/quiz-file/${encodeURIComponent(name)}`, name.split("/").pop() || name);
      if (error) message.error(t("files.download_failed", { error: `${name}: ${error}` }));
    }
  };

  const currentInfo = list.quizzes.find((quiz) => quiz.filename === current);

  return (
    <Flex vertical gap={16}>
      {transfer.available && (
        <TransferPanel
          state={transfer}
          selected={new Set(selected.map((name) => transferKey("quizzes", name)))}
          onSent={() => {
            setSelected([]);
            reloadTransfer();
          }}
        />
      )}
      <Card
        title={t("quizzes.card_title")}
        extra={
          <Button
            icon={<ReloadOutlined />}
            title={t("quizzes.refresh")}
            onClick={async () => {
              await reload();
              message.success(t("quizzes.refreshed"));
            }}
          />
        }
      >
        <Typography.Paragraph data-testid="current-quiz">
          {t("quizzes.current")}{" "}
          {current ? (
            <Tag color="green">
              {current}
              {currentInfo?.title ? ` - ${currentInfo.title}` : ""}
            </Tag>
          ) : (
            <Tag>{t("quizzes.none")}</Tag>
          )}
        </Typography.Paragraph>

        <Space wrap style={{ marginBottom: 12 }}>
          {selected.length > 1 ? (
            <Button type="primary" icon={<MergeCellsOutlined />} onClick={unite} data-testid="unite-btn">
              {t("quizzes.unite")}
            </Button>
          ) : (
            <>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                disabled={!single}
                loading={busy === "switch"}
                onClick={switchQuiz}
                data-testid="switch-btn"
              >
                {single && single === current ? t("quizzes.restart_current") : t("quizzes.switch")}
              </Button>
              {/* With a folder selected (not quizzes/ itself) Edit renames it */}
              <Tooltip title={folderSelected && folderHasCurrent ? t("quizzes.folder_has_current") : undefined}>
                <Button
                  icon={<EditOutlined />}
                  disabled={folderSelected ? folderHasCurrent : !single}
                  onClick={() => (folderSelected ? renameFolder() : single && openEditor(single))}
                  data-testid="edit-btn"
                >
                  {t("common.edit")}
                </Button>
              </Tooltip>
              <Button icon={<CodeOutlined />} disabled={!single} onClick={() => setYamlFile(single)} data-testid="yaml-btn">
                {t("quizzes.edit_yaml")}
              </Button>
              <Button icon={<CopyOutlined />} disabled={!single} onClick={duplicate} data-testid="duplicate-btn">
                {t("quizzes.duplicate")}
              </Button>
            </>
          )}
          {/* With a folder selected Delete removes the folder with everything in it */}
          <Tooltip
            title={
              folderSelected
                ? folderHasCurrent
                  ? t("quizzes.folder_has_current")
                  : undefined
                : current && selected.includes(current)
                  ? t("quizzes.cannot_delete_current")
                  : undefined
            }
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={
                folderSelected ? folderHasCurrent : selected.length === 0 || (!!current && selected.includes(current))
              }
              onClick={folderSelected ? deleteFolder : remove}
              data-testid="delete-btn"
            >
              {t("common.delete")}
            </Button>
          </Tooltip>
          <Button icon={<DownloadOutlined />} disabled={selected.length === 0} onClick={download} data-testid="download-btn">
            {t("quizzes.download_files")}
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => onEdit({ mode: "create", folder })} data-testid="create-btn">
            {t("quizzes.new")}
          </Button>
          <Button icon={<FolderAddOutlined />} onClick={createFolder} data-testid="create-folder-btn">
            {t("quizzes.new_folder")}
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          {t("quizzes.target_folder")}{" "}
          <Tag icon={<FolderOpenOutlined />} data-testid="target-folder">
            {folderLabel(folder)}
          </Tag>
        </Typography.Paragraph>

        <Table<QuizTreeNode>
          data-testid="quiz-list"
          rowKey="key"
          size="small"
          pagination={false}
          scroll={{ x: "max-content", y: 480 }}
          dataSource={tree}
          locale={{ emptyText: t("quizzes.empty") }}
          expandable={{
            expandedRowKeys: expanded,
            onExpand: (_, node) => toggleFolder(node.key),
            indentSize: 20,
          }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected((keys as string[]).filter((key) => !isFolderKey(key))),
            renderCell: (_, node, __, checkbox) => (node.quiz ? checkbox : null),
            hideSelectAll: true,
          }}
          onRow={(node) => ({
            // A click selects only this quiz; Ctrl/Cmd+click adds it to the selection; a click on a folder
            // selects it for new quizzes and opens it (the arrow opens and closes it)
            onClick: (event) => {
              if ((event.target as HTMLElement).closest(".ant-table-selection-column, .ant-table-row-expand-icon")) return;
              if (!node.quiz) {
                selectFolder(node.key);
                return;
              }
              const filename = node.quiz.filename;
              setFolder(folderOf(filename));
              setSelected((currentSelection) =>
                event.ctrlKey || event.metaKey
                  ? currentSelection.includes(filename)
                    ? currentSelection.filter((name) => name !== filename)
                    : [...currentSelection, filename]
                  : [filename],
              );
            },
            onDoubleClick: () => node.quiz && openEditor(node.quiz.filename),
            style: { cursor: "pointer" },
            ...(!node.quiz && { "data-folder": folderOf(node.key) }),
          })}
          rowClassName={(node) => (!node.quiz && node.key === folderKey(folder) ? "quiz-folder-selected" : "")}
          columns={[
            {
              key: "filename",
              title: t("quizzes.col_file"),
              render: (_, node) =>
                node.quiz ? (
                  <span className="quiz-name-cell">
                    <Space size={4}>
                      <Typography.Text strong={node.key === current}>{node.name}</Typography.Text>
                      {node.key === current && <Tag color="green">{t("quizzes.current_tag")}</Tag>}
                    </Space>
                    {node.quiz.title && (
                      <Typography.Text type="secondary" className="quiz-title-inline">
                        {node.quiz.title}
                      </Typography.Text>
                    )}
                  </span>
                ) : (
                  <Space size={6} className="quiz-folder">
                    {expanded.includes(node.key) ? <FolderOpenOutlined /> : <FolderOutlined />}
                    <Typography.Text strong>{node.name}</Typography.Text>
                    <Typography.Text type="secondary">({node.count})</Typography.Text>
                  </Space>
                ),
            },
            {
              key: "title",
              title: t("quizzes.col_title"),
              className: "quiz-title-cell",
              responsive: ["md"],
              render: (_, node) => node.quiz?.title || "",
            },
            {
              key: "questions",
              title: t("quizzes.col_questions"),
              align: "center",
              render: (_, node) => (node.quiz ? (node.quiz.total_questions ?? "—") : ""),
            },
            {
              key: "points",
              title: t("quizzes.col_points"),
              align: "center",
              responsive: ["sm"],
              render: (_, node) =>
                node.quiz ? (node.quiz.total_points === undefined || node.quiz.total_points === null ? "—" : formatPoints(node.quiz.total_points)) : "",
            },
            {
              key: "time",
              title: t("quizzes.col_time"),
              align: "center",
              render: (_, node) => (node.quiz ? (node.quiz.time_limit ? `⏱ ${formatDuration(node.quiz.time_limit)}` : "—") : ""),
            },
            {
              key: "settings",
              title: t("quizzes.col_settings"),
              render: (_, node) => node.quiz && <SettingTags quiz={node.quiz} />,
            },
          ]}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("quizzes.hint")}
        </Typography.Text>

        <Modal
          open={!!prompt}
          title={prompt?.title}
          okText="OK"
          okButtonProps={{ disabled: !promptValue.trim() || !!promptError }}
          confirmLoading={busy === "prompt"}
          onCancel={() => setPrompt(null)}
          onOk={async () => {
            if (!prompt) return;
            setBusy("prompt");
            try {
              if (await prompt.onOk(promptValue.trim())) setPrompt(null);
            } catch (error) {
              message.error(t("common.error", { error: (error as Error).message }));
            } finally {
              setBusy(null);
            }
          }}
          destroyOnHidden
        >
          <Input
            id="name-prompt"
            value={promptValue}
            autoFocus
            status={promptError ? "error" : undefined}
            onChange={(event) => setPromptValue(event.target.value)}
          />
          {promptError && (
            <Typography.Text type="danger" data-testid="name-prompt-error">
              {promptError}
            </Typography.Text>
          )}
        </Modal>
        <QuizYamlEditor filename={yamlFile} onClose={() => setYamlFile(null)} onSaved={reload} />
      </Card>
    </Flex>
  );
}
