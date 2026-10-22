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
    else message.error(result.data.error || "Не вдалося завантажити quiz");
  };

  const switchQuiz = async () => {
    if (!single) return;
    const restart = single === current;
    setBusy("switch");
    try {
      const result = await apiSend<{ csv_file: string }>("POST", "/api/admin/switch-quiz", { quiz_filename: single });
      if (result.ok) {
        message.success(`Successfully ${restart ? "restarted" : "switched to"} "${single}". CSV file: ${result.data.csv_file}`);
        setSelected([]);
        await reload();
      } else {
        message.error(result.data.error || `Failed to ${restart ? "restart" : "switch"} quiz`);
      }
    } catch (error) {
      message.error(`Помилка: ${(error as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const duplicate = () => {
    if (!single) return;
    askName("Введіть ім'я для дубльованого quiz:", single.replace(/\.ya?ml$/, "_copy"), async (name) => {
      const original = await apiGet<{ content: string }>(`/api/admin/quiz/${encodeURIComponent(single)}`);
      if (!original.ok) {
        message.error(original.data.error || "Не вдалося завантажити оригінальний quiz");
        return;
      }
      const created = await apiSend<{ filename: string }>("POST", "/api/admin/create-quiz", {
        filename: name,
        mode: "text",
        content: original.data.content,
      });
      if (created.ok) {
        message.success(`Quiz duplicated successfully as "${created.data.filename}"`);
        await reload();
        await openEditor(created.data.filename);
      } else {
        message.error(created.data.error || "Не вдалося дублювати quiz");
      }
    });
  };

  const unite = () => {
    askName(
      `Введіть ім'я для об'єднаного quiz (${selected.length} quizzes):`,
      selected[0].replace(/\.ya?ml$/, "_united"),
      async (name) => {
        const result = await apiSend<{ filename: string; total_questions: number; warning?: string }>(
          "POST",
          "/api/admin/unite-quizzes",
          { quiz_filenames: selected, new_name: name },
        );
        if (result.ok) {
          message.success(
            `Quiz успішно об'єднано в "${result.data.filename}". Загалом питань: ${result.data.total_questions}` +
              (result.data.warning ? `. ${result.data.warning}` : ""),
          );
          setSelected([]);
          await reload();
          await openEditor(result.data.filename);
        } else {
          message.error(result.data.error || "Не вдалося об'єднати quizzes");
        }
      },
    );
  };

  const remove = () => {
    const names = [...selected];
    modal.confirm({
      title: names.length === 1 ? `Видалити "${names[0]}"?` : `Видалити ${names.length} quiz(ів)?`,
      content: "Ця дія не може бути скасована.",
      okType: "danger",
      okText: "Видалити",
      onOk: async () => {
        const errors: string[] = [];
        for (const name of names) {
          const result = await apiSend("DELETE", `/api/admin/quiz/${encodeURIComponent(name)}`);
          if (!result.ok) errors.push(`${name}: ${result.data.error || "Помилка"}`);
        }
        const deleted = names.length - errors.length;
        if (errors.length === 0) message.success(`Успішно видалено ${deleted} quiz(ів)`);
        else if (deleted > 0) message.warning(`Видалено ${deleted} quiz(ів). Помилки: ${errors.join(", ")}`);
        else message.error(`Помилка видалення: ${errors.join(", ")}`);
        setSelected([]);
        await reload();
      },
    });
  };

  const currentInfo = list.quizzes.find((quiz) => quiz.filename === current);

  return (
    <Card
      title="Quiz"
      extra={
        <Button
          icon={<ReloadOutlined />}
          title="Оновити список"
          onClick={async () => {
            await reload();
            message.success("Список quiz оновлено");
          }}
        />
      }
    >
      <Typography.Paragraph data-testid="current-quiz">
        Поточний quiz:{" "}
        {current ? (
          <Tag color="green">
            {current}
            {currentInfo?.title ? ` - ${currentInfo.title}` : ""}
          </Tag>
        ) : (
          <Tag>не вибрано</Tag>
        )}
      </Typography.Paragraph>

      <Space wrap style={{ marginBottom: 12 }}>
        {selected.length > 1 ? (
          <Button type="primary" icon={<MergeCellsOutlined />} onClick={unite} data-testid="unite-btn">
            Об'єднати quizzes
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
              {single && single === current ? "Перезапустити поточний" : "Переключитися"}
            </Button>
            <Button icon={<EditOutlined />} disabled={!single} onClick={() => single && openEditor(single)} data-testid="edit-btn">
              Редагувати
            </Button>
            <Button icon={<CopyOutlined />} disabled={!single} onClick={duplicate} data-testid="duplicate-btn">
              Дублювати
            </Button>
          </>
        )}
        <Tooltip title={current && selected.includes(current) ? "Неможливо видалити поточний активний quiz" : undefined}>
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={selected.length === 0 || (!!current && selected.includes(current))}
            onClick={remove}
            data-testid="delete-btn"
          >
            Видалити
          </Button>
        </Tooltip>
        <Button icon={<PlusOutlined />} onClick={() => onEdit({ mode: "create" })} data-testid="create-btn">
          Новий quiz
        </Button>
      </Space>

      <Table<QuizInfo>
        data-testid="quiz-list"
        rowKey="filename"
        size="small"
        pagination={false}
        scroll={{ y: 360 }}
        dataSource={list.quizzes}
        locale={{ emptyText: "Файли quiz не знайдені" }}
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
            title: "Файл",
            dataIndex: "filename",
            render: (filename: string) => (
              <Space size={4} wrap>
                <Typography.Text strong={filename === current}>{filename}</Typography.Text>
                {filename === current && <Tag color="green">поточний</Tag>}
              </Space>
            ),
          },
          { key: "title", title: "Назва", dataIndex: "title", render: (title: string | null) => title || "", responsive: ["sm"] },
        ]}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Ctrl+клік — вибрати декілька, подвійний клік — редагувати
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
            message.error(`Помилка: ${(error as Error).message}`);
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
