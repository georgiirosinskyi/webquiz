import { useEffect, useState } from "react";
import { Alert, App, Button, Input, Modal, Space, Spin } from "antd";
import { apiSend, apiText } from "../shared/api";

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
      if (!result.ok) setFeedback({ type: "error", text: `Error: ${result.error}` });
    });
  }, [filename]);

  const validate = async () => {
    if (!content?.trim()) {
      setFeedback({ type: "error", text: "Content is empty" });
      return;
    }
    setBusy(true);
    try {
      const result = await apiSend<{ valid: boolean; question_count: number; errors: string[] }>(
        "POST",
        "/api/admin/validate-quiz",
        { content },
      );
      if (!result.ok) setFeedback({ type: "error", text: `Error: ${result.data.error}` });
      else if (result.data.valid)
        setFeedback({ type: "success", text: `✅ Valid YAML! Found ${result.data.question_count} questions.` });
      else setFeedback({ type: "error", text: "❌ Validation errors:", details: result.data.errors });
    } catch (error) {
      setFeedback({ type: "error", text: `Error: ${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!filename) return;
    if (!content?.trim()) {
      setFeedback({ type: "error", text: "Content cannot be empty" });
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
        message.success(`Saved ${filename}`);
        onSaved();
        onClose();
      } else {
        setFeedback({ type: "error", text: result.data.error || "Failed to save quiz", details: result.data.errors });
      }
    } catch (error) {
      setFeedback({ type: "error", text: `Error: ${(error as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!filename}
      title={`Edit Quiz: ${filename}`}
      onCancel={onClose}
      width={1000}
      destroyOnHidden
      footer={
        <Space wrap>
          <Button onClick={validate} loading={busy}>
            ✅ Validate YAML
          </Button>
          <Button type="primary" onClick={save} loading={busy}>
            💾 Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </Space>
      }
    >
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Alert
          type="warning"
          showIcon
          title="Changes will create a backup. If this is the active quiz, it will be reloaded."
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
