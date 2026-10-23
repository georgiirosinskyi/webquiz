import { useEffect, useState } from "react";
import { Alert, App, Button, Input, Modal, Space, Spin } from "antd";
import { apiSend, apiText } from "../shared/api";
import { t } from "../shared/i18n";

type Feedback = { type: "success" | "error"; text: string; details?: string[] } | null;

// Direct YAML editing of a quiz file with server-side validation.
export function QuizEditorModal({
  filename,
  onClose,
  onSaved,
}: {
  filename: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [content, setContent] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!filename) return;
    setContent(null);
    setFeedback(null);
    apiText(`/api/files/quizzes/view/${encodeURIComponent(filename)}`).then((result) => {
      setContent(result.text);
      if (!result.ok) setFeedback({ type: "error", text: t("common.error", { error: result.error || "" }) });
    });
  }, [filename]);

  const validate = async () => {
    if (!content?.trim()) {
      setFeedback({ type: "error", text: t("yaml.empty") });
      return;
    }
    setBusy(true);
    try {
      const result = await apiSend<{ valid: boolean; question_count: number; errors: string[] }>(
        "POST",
        "/api/admin/validate-quiz",
        { content },
      );
      if (!result.ok) setFeedback({ type: "error", text: t("common.error", { error: result.data.error || result.status }) });
      else if (result.data.valid)
        setFeedback({ type: "success", text: t("yaml.valid", { count: result.data.question_count }) });
      else setFeedback({ type: "error", text: t("yaml.invalid"), details: result.data.errors });
    } catch (error) {
      setFeedback({ type: "error", text: t("common.error", { error: (error as Error).message }) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!filename) return;
    if (!content?.trim()) {
      setFeedback({ type: "error", text: t("yaml.empty") });
      return;
    }
    setBusy(true);
    try {
      const result = await apiSend<{ message: string }>(
        "PUT",
        `/api/files/quizzes/save/${encodeURIComponent(filename)}`,
        { content },
      );
      if (result.ok) {
        message.success(t("yaml.saved", { name: filename }));
        onSaved();
        onClose();
      } else {
        setFeedback({ type: "error", text: result.data.error || t("yaml.save_failed"), details: result.data.errors });
      }
    } catch (error) {
      setFeedback({ type: "error", text: t("common.error", { error: (error as Error).message }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!filename}
      title={t("yaml.title", { name: filename || "" })}
      onCancel={onClose}
      width={1000}
      destroyOnHidden
      footer={
        <Space wrap>
          <Button onClick={validate} loading={busy}>
            {t("yaml.validate")}
          </Button>
          <Button type="primary" onClick={save} loading={busy}>
            {t("yaml.save")}
          </Button>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
        </Space>
      }
    >
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Alert
          type="warning"
          showIcon
          title={t("yaml.backup_hint")}
        />
        {content === null ? (
          <Spin style={{ display: "block", padding: 40 }} />
        ) : (
          <Input.TextArea
            id="quiz-editor-content"
            className="code-editor"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            autoSize={{ minRows: 18, maxRows: 30 }}
            spellCheck={false}
          />
        )}
        {feedback && (
          <Alert
            type={feedback.type}
            title={feedback.text}
            description={
              feedback.details?.length ? (
                <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                  {feedback.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : undefined
            }
          />
        )}
      </Space>
    </Modal>
  );
}
