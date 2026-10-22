import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Flex, Form, Input, InputNumber, Modal, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { apiGet, apiSend } from "../shared/api";
import { ImagePicker, FilePicker } from "./Pickers";
import { QuestionCard, type CheckerTemplate } from "./QuestionCard";
import { formToQuiz, newQuestion, questionErrors, quizErrors, quizToForm, type QuestionForm, type QuizForm } from "./quizForm";

// What the editor is opened for: a new quiz, or an existing file with its parsed YAML
export type EditorTarget = { mode: "create" } | { mode: "edit"; filename: string; parsed: Record<string, unknown> | null };

interface Item {
  key: number;
  question: QuestionForm;
}

type ImageTarget = { key: number; field: "question" | number };

let nextKey = 1;
const toItems = (questions: QuestionForm[]): Item[] => questions.map((question) => ({ key: nextKey++, question }));

export function QuizEditor({
  target,
  onClose,
  onSaved,
}: {
  target: EditorTarget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message, modal } = App.useApp();
  const [settings, setSettings] = useState<Omit<QuizForm, "questions">>(() => quizToForm("", null));
  const [items, setItems] = useState<Item[]>([]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [editingName, setEditingName] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState<"close" | "continue" | null>(null);
  const [continueResult, setContinueResult] = useState<"ok" | "error" | null>(null);
  const [templates, setTemplates] = useState<CheckerTemplate[]>([]);
  const [imageTarget, setImageTarget] = useState<ImageTarget | null>(null);
  const [fileTarget, setFileTarget] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const listEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    const form = target.mode === "edit" ? quizToForm(target.filename, target.parsed) : quizToForm("", null);
    const { questions, ...rest } = form;
    const loaded = toItems(questions);
    setSettings(rest);
    setItems(loaded);
    // Existing quizzes open with every question collapsed, a new one with its first question open
    setCollapsed(new Set(target.mode === "edit" ? loaded.map((item) => item.key) : []));
    setEditingName(target.mode === "edit" ? target.filename : null);
    setShowErrors(false);
    setContinueResult(null);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    apiGet<{ templates: CheckerTemplate[] }>("/api/admin/list-checker-templates")
      .then((result) => setTemplates(result.ok ? result.data.templates || [] : []))
      .catch(() => setTemplates([]));
  }, [target]);

  const form: QuizForm = { ...settings, questions: items.map((item) => item.question) };
  const errors = quizErrors(form);

  const updateQuestion = (key: number, question: QuestionForm) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, question } : item)));

  const move = (from: number, to: number) =>
    setItems((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  const addQuestion = () => {
    const [item] = toItems([newQuestion()]);
    setItems((current) => [...current, item]);
    window.setTimeout(() => listEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  const removeQuestion = (key: number) =>
    modal.confirm({
      title: "Ви впевнені, що хочете видалити це питання?",
      okType: "danger",
      onOk: () => setItems((current) => current.filter((item) => item.key !== key)),
    });

  const save = async (keepOpen: boolean) => {
    if (errors.length > 0) {
      setShowErrors(true);
      // Open the questions with problems so the admin sees them
      setCollapsed(
        (current) =>
          new Set(
            [...current].filter((key) => {
              const index = items.findIndex((item) => item.key === key);
              return index < 0 || questionErrors(items[index].question, index + 1).length === 0;
            }),
          ),
      );
      message.error(errors[0]);
      return;
    }
    setSaving(keepOpen ? "continue" : "close");
    setContinueResult(null);
    const filename = settings.filename.trim();
    try {
      const result = editingName
        ? await apiSend<{ message: string; filename?: string; renamed?: boolean }>(
            "PUT",
            `/api/admin/quiz/${encodeURIComponent(editingName)}`,
            { filename, mode: "wizard", quiz_data: formToQuiz(form) },
          )
        : await apiSend<{ message: string; filename?: string }>("POST", "/api/admin/create-quiz", {
            filename,
            mode: "wizard",
            quiz_data: formToQuiz(form),
          });
      if (!result.ok) {
        message.error(result.data.error || "Не вдалося зберегти quiz");
        setContinueResult("error");
        return;
      }
      message.success(result.data.message);
      onSaved();
      if (keepOpen) {
        // A new quiz is edited from now on; a renamed one under its new name
        const saved = result.data.filename || `${filename}.yaml`;
        setEditingName(saved);
        setSettings((current) => ({ ...current, filename: saved.replace(/\.ya?ml$/, "") }));
        setContinueResult("ok");
      } else {
        onClose();
      }
    } catch (error) {
      message.error(`Помилка збереження quiz: ${(error as Error).message}`);
      setContinueResult("error");
    } finally {
      setSaving(null);
      window.setTimeout(() => setContinueResult(null), 1500);
    }
  };

  const pickImage = (path: string) => {
    if (!imageTarget) return;
    const item = items.find((entry) => entry.key === imageTarget.key);
    if (item) {
      const question = item.question;
      updateQuestion(
        item.key,
        imageTarget.field === "question"
          ? { ...question, image: path }
          : { ...question, options: question.options.map((o, i) => (i === imageTarget.field ? path : o)) },
      );
      message.success(`Зображення вибрано: ${path}`);
    }
    setImageTarget(null);
  };

  const pickFile = (filename: string) => {
    const item = items.find((entry) => entry.key === fileTarget);
    if (item) {
      updateQuestion(item.key, { ...item.question, file: filename });
      message.success(`Файл вибрано: ${filename}`);
    }
    setFileTarget(null);
  };

  const title = editingName ? `Редагувати Quiz: ${editingName}` : "Створити Новий Quiz";

  return (
    <Modal
      open={!!target}
      title={title}
      onCancel={onClose}
      width={1000}
      maskClosable={false}
      destroyOnHidden
      styles={{ body: { maxHeight: "calc(100vh - 220px)", overflowY: "auto", paddingRight: 8 } }}
      footer={
        <Space wrap>
          <Button type="primary" loading={saving === "close"} onClick={() => save(false)} data-testid="save-quiz">
            💾 Зберегти Quiz
          </Button>
          <Button
            loading={saving === "continue"}
            onClick={() => save(true)}
            data-testid="save-continue"
            type={continueResult === "ok" ? "primary" : "default"}
            danger={continueResult === "error"}
            style={continueResult === "ok" ? { background: "#52c41a" } : undefined}
          >
            {continueResult === "ok" ? "✅ Збережено" : continueResult === "error" ? "❌ Помилка" : "💾 Зберегти і Продовжити"}
          </Button>
          <Button onClick={onClose}>Скасувати</Button>
        </Space>
      }
    >
      <Form layout="vertical" component="div">
        <Form.Item label="Ім'я файлу quiz" required>
          <Input
            id="quiz-filename"
            value={settings.filename}
            placeholder="без розширення .yaml, можна з папкою: grade5/math"
            onChange={(event) => setSettings({ ...settings, filename: event.target.value })}
            status={showErrors && !settings.filename.trim() ? "error" : undefined}
          />
        </Form.Item>
        <Form.Item label="Назва quiz (необов'язково)">
          <Input
            id="quiz-title"
            value={settings.title}
            placeholder="наприклад, Математичний Quiz"
            onChange={(event) => setSettings({ ...settings, title: event.target.value })}
          />
        </Form.Item>

        <Flex wrap gap="small 24px" style={{ marginBottom: 16 }}>
          <Checkbox
            id="show-right-answer"
            checked={settings.show_right_answer}
            onChange={(event) =>
              setSettings({
                ...settings,
                show_right_answer: event.target.checked,
                show_answers_on_completion: event.target.checked ? false : settings.show_answers_on_completion,
              })
            }
          >
            Показувати правильні відповіді
          </Checkbox>
          {!settings.show_right_answer && (
            <Checkbox
              id="show-answers-on-completion"
              checked={settings.show_answers_on_completion}
              onChange={(event) => setSettings({ ...settings, show_answers_on_completion: event.target.checked })}
            >
              Показувати відповіді після завершення всіма
            </Checkbox>
          )}
          <Checkbox
            id="randomize-questions"
            checked={settings.randomize_questions}
            onChange={(event) => setSettings({ ...settings, randomize_questions: event.target.checked })}
          >
            Рандомізувати порядок питань
          </Checkbox>
          <Checkbox
            id="show-final-list"
            checked={settings.show_final_list}
            onChange={(event) => setSettings({ ...settings, show_final_list: event.target.checked })}
          >
            Показувати список питань у кінці
          </Checkbox>
          <Checkbox
            id="allow-skip-questions"
            checked={settings.allow_skip_questions}
            onChange={(event) => setSettings({ ...settings, allow_skip_questions: event.target.checked })}
          >
            Дозволити пропускати питання
          </Checkbox>
        </Flex>

        <Form.Item label="Обмеження часу, секунд (порожньо або 0 — без обмеження)">
          <InputNumber
            id="time-limit"
            min={0}
            precision={0}
            value={settings.time_limit}
            onChange={(value) => setSettings({ ...settings, time_limit: value })}
            style={{ width: 160 }}
          />
        </Form.Item>
      </Form>

      <Flex vertical gap={8} data-testid="questions-container">
        {items.map((item, index) => (
          <QuestionCard
            key={item.key}
            question={item.question}
            index={index}
            total={items.length}
            collapsed={collapsed.has(item.key)}
            errors={showErrors ? questionErrors(item.question, index + 1) : []}
            dragOver={dragOver === item.key && dragging !== item.key}
            checkerTemplates={templates}
            onToggle={() =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(item.key)) next.delete(item.key);
                else next.add(item.key);
                return next;
              })
            }
            onChange={(question) => updateQuestion(item.key, question)}
            onMove={(direction) => move(index, index + direction)}
            onRemove={() => removeQuestion(item.key)}
            onPickImage={(field) => setImageTarget({ key: item.key, field })}
            onPickFile={() => setFileTarget(item.key)}
            dragHandlers={{
              onDragStart: (event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(item.key));
                setDragging(item.key);
              },
              onDragEnd: () => {
                setDragging(null);
                setDragOver(null);
              },
              onDragOver: (event) => {
                if (dragging === null) return;
                event.preventDefault();
                setDragOver(item.key);
              },
              onDrop: (event) => {
                event.preventDefault();
                const from = items.findIndex((entry) => entry.key === dragging);
                if (from >= 0) move(from, index);
                setDragging(null);
                setDragOver(null);
              },
            }}
          />
        ))}
        <div ref={listEnd} />
        <div>
          <Button icon={<PlusOutlined />} onClick={addQuestion}>
            Додати питання
          </Button>
        </div>
      </Flex>

      {showErrors && errors.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          title="Виправте помилки перед збереженням"
          description={
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          }
        />
      )}

      <ImagePicker open={!!imageTarget} onSelect={pickImage} onClose={() => setImageTarget(null)} />
      <FilePicker open={fileTarget !== null} onSelect={pickFile} onClose={() => setFileTarget(null)} />
    </Modal>
  );
}
