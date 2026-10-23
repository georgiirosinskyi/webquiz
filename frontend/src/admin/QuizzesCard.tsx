import { useState } from "react";
import { App, Button, Card, Input, Modal, Space, Table, Tag, Tooltip, Typography } from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  MergeCellsOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { apiGet, apiSend } from "../shared/api";
import { t } from "../shared/i18n";
import type { QuizInfo, QuizList } from "./types";
import type { EditorTarget } from "./QuizEditor";

type NamePrompt = { title: string; value: string; onOk: (name: string) => Promise<void> } | null;

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

      <Table<QuizInfo>
        data-testid="quiz-list"
        rowKey="filename"
        size="small"
        pagination={false}
        scroll={{ y: 360 }}
        dataSource={list.quizzes}
        locale={{ emptyText: t("quizzes.empty") }}
        rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
        onRow={(quiz) => ({
          // A click selects only this quiz; Ctrl/Cmd+click adds it to the selection
          onClick: (event) => {
            if ((event.target as HTMLElement).closest(".ant-table-selection-column")) return;
            setSelected((currentSelection) =>
              event.ctrlKey || event.metaKey
                ? currentSelection.includes(quiz.filename)
                  ? currentSelection.filter((name) => name !== quiz.filename)
                  : [...currentSelection, quiz.filename]
                : [quiz.filename],
            );
          },
          onDoubleClick: () => openEditor(quiz.filename),
          style: { cursor: "pointer" },
        })}
        columns={[
          {
            key: "filename",
            title: t("quizzes.col_file"),
            dataIndex: "filename",
            render: (filename: string) => (
              <Space size={4} wrap>
                <Typography.Text strong={filename === current}>{filename}</Typography.Text>
                {filename === current && <Tag color="green">{t("quizzes.current_tag")}</Tag>}
              </Space>
            ),
          },
          { key: "title", title: t("quizzes.col_title"), dataIndex: "title", render: (title: string | null) => title || "", responsive: ["sm"] },
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
