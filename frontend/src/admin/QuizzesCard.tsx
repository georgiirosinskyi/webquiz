import { useMemo, useState } from "react";
import { App, Button, Card, Input, Modal, Space, Table, Tag, Tooltip, Typography } from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  MergeCellsOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { apiGet, apiSend } from "../shared/api";
import { t } from "../shared/i18n";
import { formatPoints } from "../shared/points";
import { formatDuration } from "./overview";
import { buildQuizTree, isFolderKey, type QuizTreeNode } from "./quizTree";
import type { QuizInfo, QuizList } from "./types";
import type { EditorTarget } from "./QuizEditor";

type NamePrompt = { title: string; value: string; onOk: (name: string) => Promise<void> } | null;

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
  const tree = useMemo(() => buildQuizTree(list.quizzes), [list.quizzes]);
  // Folders are closed until the admin opens them
  const [expanded, setExpanded] = useState<string[]>([]);
  const toggleFolder = (key: string) =>
    setExpanded((keys) => (keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]));

  const askName = (title: string, value: string, onOk: (name: string) => Promise<void>) => {
    setPromptValue(value);
    setPrompt({ title, value, onOk });
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
      const result = await apiSend<{ csv_file: string }>("POST", "/api/admin/switch-quiz", { quiz_filename: single });
      if (result.ok) {
        message.success(t(restart ? "quizzes.restarted" : "quizzes.switched", { name: single, csv: result.data.csv_file }));
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
    askName(t("quizzes.duplicate_prompt"), single.replace(/\.ya?ml$/, "_copy"), async (name) => {
      const original = await apiGet<{ content: string }>(`/api/admin/quiz/${encodeURIComponent(single)}`);
      if (!original.ok) {
        message.error(original.data.error || t("quizzes.load_original_failed"));
        return;
      }
      const created = await apiSend<{ filename: string }>("POST", "/api/admin/create-quiz", {
        filename: name,
        mode: "text",
        content: original.data.content,
      });
      if (created.ok) {
        message.success(t("quizzes.duplicated", { name: created.data.filename }));
        await reload();
        await openEditor(created.data.filename);
      } else {
        message.error(created.data.error || t("quizzes.duplicate_failed"));
      }
    });
  };

  const unite = () => {
    askName(
      t("quizzes.unite_prompt", { count: selected.length }),
      selected[0].replace(/\.ya?ml$/, "_united"),
      async (name) => {
        const result = await apiSend<{ filename: string; total_questions: number; warning?: string }>(
          "POST",
          "/api/admin/unite-quizzes",
          { quiz_filenames: selected, new_name: name },
        );
        if (result.ok) {
          message.success(
            t("quizzes.united", { name: result.data.filename, count: result.data.total_questions }) +
              (result.data.warning ? `. ${result.data.warning}` : ""),
          );
          setSelected([]);
          await reload();
          await openEditor(result.data.filename);
        } else {
          message.error(result.data.error || t("quizzes.unite_failed"));
        }
      },
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

  const currentInfo = list.quizzes.find((quiz) => quiz.filename === current);

  return (
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
            <Button icon={<EditOutlined />} disabled={!single} onClick={() => single && openEditor(single)} data-testid="edit-btn">
              {t("common.edit")}
            </Button>
            <Button icon={<CopyOutlined />} disabled={!single} onClick={duplicate} data-testid="duplicate-btn">
              {t("quizzes.duplicate")}
            </Button>
          </>
        )}
        <Tooltip title={current && selected.includes(current) ? t("quizzes.cannot_delete_current") : undefined}>
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={selected.length === 0 || (!!current && selected.includes(current))}
            onClick={remove}
            data-testid="delete-btn"
          >
            {t("common.delete")}
          </Button>
        </Tooltip>
        <Button icon={<PlusOutlined />} onClick={() => onEdit({ mode: "create" })} data-testid="create-btn">
          {t("quizzes.new")}
        </Button>
      </Space>

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
          // A click selects only this quiz; Ctrl/Cmd+click adds it to the selection; a click on a folder opens or closes it
          onClick: (event) => {
            if ((event.target as HTMLElement).closest(".ant-table-selection-column, .ant-table-row-expand-icon")) return;
            if (!node.quiz) {
              toggleFolder(node.key);
              return;
            }
            const filename = node.quiz.filename;
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
        })}
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
        okButtonProps={{ disabled: !promptValue.trim() }}
        confirmLoading={busy === "prompt"}
        onCancel={() => setPrompt(null)}
        onOk={async () => {
          if (!prompt) return;
          setBusy("prompt");
          try {
            await prompt.onOk(promptValue.trim());
            setPrompt(null);
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
          onChange={(event) => setPromptValue(event.target.value)}
        />
      </Modal>
    </Card>
  );
}
