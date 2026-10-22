import { useEffect, useState } from "react";
import { Alert, App, Badge, Button, Card, Flex, Input, List, Select, Space, Tag, Typography } from "antd";
import { CheckOutlined, CloudDownloadOutlined, CopyOutlined, LinkOutlined, UnlockOutlined } from "@ant-design/icons";
import { apiGet, apiSend } from "../shared/api";
import { formatFileSize } from "../shared/format";
import {
  fieldNameToLabel,
  isNewerVersion,
  type DownloadableQuiz,
  type IncomingFile,
  type PendingUser,
  type TransferAction,
  type TransferRequest,
  type TunnelStatus,
} from "./types";

export function PendingApprovals({
  users,
  onApproved,
}: {
  users: Record<string, PendingUser>;
  onApproved: (userId: string) => void;
}) {
  const { message } = App.useApp();
  const ids = Object.keys(users);

  const approve = async (userId: string) => {
    try {
      const result = await apiSend("PUT", "/api/admin/approve-user", { user_id: userId });
      if (result.ok) {
        message.success("Користувача підтверджено!");
        onApproved(userId);
      } else {
        message.error(result.data.error || "Помилка підтвердження");
      }
    } catch (error) {
      message.error(`Помилка з'єднання: ${(error as Error).message}`);
    }
  };

  return (
    <Card
      data-testid="pending-approvals"
      title={
        <Space>
          ⏳ Очікують підтвердження
          <Badge count={ids.length} showZero color={ids.length > 0 ? "#faad14" : "#bfbfbf"} />
        </Space>
      }
      extra={
        <Button type="primary" size="small" disabled={ids.length === 0} onClick={() => ids.forEach(approve)}>
          ✓ Підтвердити всіх
        </Button>
      }
    >
      <List
        dataSource={ids}
        locale={{ emptyText: "Немає користувачів, що очікують підтвердження" }}
        renderItem={(userId) => (
          <List.Item
            actions={[
              <Button key="approve" type="primary" size="small" icon={<CheckOutlined />} onClick={() => approve(userId)}>
                Підтвердити
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={`👤 ${users[userId].username}`}
              description={Object.entries(users[userId].registration_fields || {}).map(([key, value]) => (
                <div key={key}>
                  {fieldNameToLabel(key)}: {value}
                </div>
              ))}
            />
          </List.Item>
        )}
      />
    </Card>
  );
}

const TRANSFER_TYPE_LABELS: Record<string, string> = {
  quizzes: "тест",
  logs: "лог",
  csv: "CSV",
  images: "зображення",
  attachments: "вкладення",
};
const TRANSFER_CASE: Record<IncomingFile["case"], { color: string; text: (target: string) => string }> = {
  new: { color: "green", text: (target) => `🆕 Новий файл: ${target}` },
  same: { color: "default", text: (target) => `✓ Такий самий файл вже є: ${target}` },
  different: { color: "orange", text: (target) => `⚠️ Вже є інший файл ${target}` },
  in_use: { color: "red", text: (target) => `🔒 ${target} зараз використовується сервером` },
};
const TRANSFER_ACTION_TEXT: Record<TransferAction, string> = {
  save: "Зберегти",
  replace: "Замінити",
  rename: "Перейменувати",
  skip: "Пропустити",
};

type Choice = { action: TransferAction; new_name: string };

function TransferRequestItem({ request, onDone }: { request: TransferRequest; onDone: (keep: boolean) => void }) {
  const { message } = App.useApp();
  const fileKey = (file: IncomingFile) => `${file.type}/${file.name}`;
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      request.files.map((file) => [fileKey(file), { action: file.default_action, new_name: file.suggested_name }]),
    ),
  );
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (action: "accept" | "reject") => {
    setBusy(action);
    setError(null);
    let keep = false;
    try {
      const files = request.files.map((file) => {
        const choice = choices[fileKey(file)];
        return {
          type: file.type,
          name: file.name,
          action: choice.action,
          ...(choice.action === "rename" ? { new_name: choice.new_name.trim() } : {}),
        };
      });
      const result = await apiSend<{
        saved: { saved_as: string }[];
        skipped: unknown[];
        failed: { name: string; error: string }[];
      }>("POST", `/api/admin/transfer/${encodeURIComponent(request.id)}/${action}`, action === "accept" ? { files } : {});
      if (!result.ok) {
        const text = result.data.error || "Помилка обробки запиту";
        message.error(text);
        // Invalid choices: nothing was downloaded, the request is still open
        keep = result.status === 400;
        setError(text);
      } else if (action === "reject") {
        message.success("Запит відхилено");
      } else {
        const { saved, skipped, failed } = result.data;
        if (saved.length > 0)
          message.success(`Отримано файлів: ${saved.length} (${saved.map((file) => file.saved_as).join(", ")})`);
        if (skipped.length > 0) message.success(`Пропущено файлів: ${skipped.length}`);
        failed.forEach((file) => message.error(`Не вдалося отримати ${file.name}: ${file.error}`));
      }
    } catch (caught) {
      const text = `Помилка з'єднання: ${(caught as Error).message}`;
      message.error(text);
      setError(text);
      keep = true;
    } finally {
      setBusy(null);
    }
    onDone(keep);
  };

  return (
    <Card size="small" type="inner" title={`🖥️ Від: ${request.from}`} data-testid="transfer-request">
      <Flex vertical gap={10}>
        {request.files.map((file) => {
          const choice = choices[fileKey(file)];
          const caseInfo = TRANSFER_CASE[file.case] || { color: "default", text: (target: string) => target };
          return (
            <Flex key={fileKey(file)} wrap gap={8} align="center" justify="space-between">
              <div style={{ minWidth: 160 }}>
                <Typography.Text strong style={{ wordBreak: "break-all" }}>
                  {file.name}
                </Typography.Text>
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {TRANSFER_TYPE_LABELS[file.type] || file.type}, {formatFileSize(file.size)}
                </Typography.Text>
              </div>
              <Tag color={caseInfo.color} style={{ whiteSpace: "normal" }}>
                {caseInfo.text(file.target)}
              </Tag>
              <Space.Compact>
                <Select<TransferAction>
                  aria-label="Дія для файлу"
                  value={choice.action}
                  disabled={!!busy}
                  style={{ width: 150 }}
                  options={file.actions.map((action) => ({ value: action, label: TRANSFER_ACTION_TEXT[action] || action }))}
                  onChange={(action) => setChoices({ ...choices, [fileKey(file)]: { ...choice, action } })}
                />
                {choice.action === "rename" && (
                  <Input
                    aria-label="Нова назва файлу"
                    value={choice.new_name}
                    disabled={!!busy}
                    style={{ width: 180 }}
                    onChange={(event) =>
                      setChoices({ ...choices, [fileKey(file)]: { ...choice, new_name: event.target.value } })
                    }
                  />
                )}
              </Space.Compact>
            </Flex>
          );
        })}
        {error && <Alert type="error" title={error} showIcon />}
        <Space>
          <Button type="primary" loading={busy === "accept"} disabled={!!busy} onClick={() => answer("accept")}>
            ✓ Прийняти
          </Button>
          <Button danger loading={busy === "reject"} disabled={!!busy} onClick={() => answer("reject")}>
            ✗ Відхилити
          </Button>
        </Space>
      </Flex>
    </Card>
  );
}

export function TransferRequests({
  requests,
  onDone,
}: {
  requests: TransferRequest[];
  onDone: (requestId: string, keep: boolean) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <Card title="📥 Запити на отримання файлів" data-testid="transfer-requests">
      <Typography.Paragraph type="secondary">
        Інший сервер хоче надіслати файли. Оберіть, що зробити з кожним файлом, і натисніть «Прийняти». Файли
        з'являться в менеджері файлів.
      </Typography.Paragraph>
      <Flex vertical gap={12}>
        {requests.map((request) => (
          <TransferRequestItem key={request.id} request={request} onDone={(keep) => onDone(request.id, keep)} />
        ))}
      </Flex>
    </Card>
  );
}

export function ShowAnswersCard({ forced, onForced }: { forced: boolean; onForced: () => void }) {
  const { message, modal } = App.useApp();
  const force = () =>
    modal.confirm({
      title: "Відкрити відповіді для всіх учнів?",
      content: "Цю дію неможливо скасувати (до перезапуску quiz).",
      okText: "Відкрити",
      onOk: async () => {
        const result = await apiSend<{ completed_count: number; total_count: number }>(
          "POST",
          "/api/admin/force-show-answers",
        );
        if (result.ok) {
          message.success(
            `Відповіді відкрито! (${result.data.completed_count}/${result.data.total_count} учнів завершили тест)`,
          );
          onForced();
        } else {
          message.error(result.data.error || "Помилка відкриття відповідей");
        }
      },
    });

  return (
    <Card title="Відповіді" data-testid="show-answers">
      <Typography.Paragraph type="secondary">
        Дозволяє відкрити правильні відповіді для всіх учнів, не чекаючи поки всі завершать тест.
      </Typography.Paragraph>
      {forced ? (
        <Alert type="success" showIcon title="Відповіді відкрито для всіх учнів" />
      ) : (
        <Button type="primary" icon={<UnlockOutlined />} style={{ background: "#fa8c16" }} onClick={force}>
          Відкрити відповіді для всіх
        </Button>
      )}
    </Card>
  );
}

async function copyText(text: string): Promise<boolean> {
  // navigator.clipboard needs a secure context (HTTPS/localhost); HTTP over an IP uses execCommand
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}

export function AccessCard({
  urls,
  tunnel,
  publicKey,
}: {
  urls: string[];
  tunnel: TunnelStatus | null;
  publicKey: string;
}) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const showTunnel = !!tunnel && tunnel.configured !== false;

  const toggleTunnel = async () => {
    setBusy(true);
    try {
      const connected = !!tunnel?.connected;
      const result = await apiSend<{ url?: string }>(
        "POST",
        connected ? "/api/admin/tunnel/disconnect" : "/api/admin/tunnel/connect",
      );
      if (!result.ok) throw new Error(result.data.error || "Operation failed");
      message.success(connected ? "Tunnel disconnected" : `Tunnel connected! Public URL: ${result.data.url}`);
    } catch (error) {
      message.error(`Tunnel operation failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    try {
      if (await copyText(publicKey)) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } else {
        message.error("Failed to copy to clipboard. Please copy manually.");
      }
    } catch (error) {
      message.error(`Failed to copy: ${(error as Error).message}`);
    }
  };

  return (
    <Card title="🌐 Доступ" data-testid="access-card">
      <Typography.Text strong>URL для доступу з інших пристроїв:</Typography.Text>
      <Flex vertical gap={6} style={{ margin: "8px 0 0" }} data-testid="url-list">
        {tunnel?.connected && tunnel.url && (
          <Alert
            type="success"
            title={
              <>
                <strong>🌐 Зовнішній URL:</strong>{" "}
                <a href={tunnel.url} target="_blank" rel="noreferrer">
                  {tunnel.url}
                </a>
              </>
            }
          />
        )}
        {urls.length > 0 ? (
          urls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              <LinkOutlined /> {url}
            </a>
          ))
        ) : (
          <Alert
            type="warning"
            title="Зовнішні мережеві інтерфейси не знайдені"
            description="Сервер доступний тільки локально. Перевірте мережеві налаштування або параметри файрвола."
          />
        )}
      </Flex>

      {showTunnel && (
        <div style={{ marginTop: 16 }} data-testid="tunnel-section">
          <Typography.Title level={5}>SSH Tunnel</Typography.Title>
          <div>
            <strong>Server:</strong> {tunnel.server}
          </div>
          {tunnel.socket_name && (
            <div>
              <strong>Socket Name:</strong> {tunnel.socket_name}
            </div>
          )}
          {tunnel.keys_status === "ok" && publicKey && (
            <div style={{ marginTop: 8 }}>
              <strong>Public Key:</strong>
              <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                <Input.TextArea readOnly value={publicKey} autoSize={{ minRows: 1, maxRows: 4 }} className="code-editor" />
                <Button icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={copyKey}>
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </Space.Compact>
            </div>
          )}
          <Button
            style={{ marginTop: 10 }}
            type={tunnel.connected ? "default" : "primary"}
            loading={busy}
            disabled={!tunnel.connected && tunnel.keys_status !== "ok"}
            onClick={toggleTunnel}
            data-testid="tunnel-connect-btn"
          >
            {tunnel.connected ? "Disconnect" : "Connect"}
          </Button>
          {!tunnel.connected && tunnel.error && (
            <Alert type="error" style={{ marginTop: 10 }} title={`Error: ${tunnel.error}`} />
          )}
        </div>
      )}
    </Card>
  );
}

export function DownloadableQuizzes({ quizzes, onDownloaded }: { quizzes: DownloadableQuiz[]; onDownloaded: () => void }) {
  const { message, modal } = App.useApp();
  const [busy, setBusy] = useState<number | null>(null);
  if (quizzes.length === 0) return null;

  const download = (quiz: DownloadableQuiz, index: number) =>
    modal.confirm({
      title: `Завантажити quiz "${quiz.name}"?`,
      content: `Це завантажить та розпакує файли з ${quiz.download_path}. Файли будуть перезаписані в директорії quizzes.`,
      onOk: async () => {
        setBusy(index);
        try {
          const result = await apiSend<{ success: boolean; message: string }>("POST", "/api/admin/download-quiz", quiz);
          if (result.ok && result.data.success) {
            message.success(`✅ ${result.data.message}`);
            onDownloaded();
          } else {
            message.error(`❌ Помилка завантаження: ${result.data.error}`);
          }
        } catch (error) {
          message.error(`❌ Помилка мережі: ${(error as Error).message}`);
        } finally {
          setBusy(null);
        }
      },
    });

  return (
    <Card title="Quiz для завантаження" data-testid="downloadable-quizzes">
      <List
        dataSource={quizzes}
        renderItem={(quiz, index) => (
          <List.Item
            actions={[
              <Button
                key="download"
                icon={<CloudDownloadOutlined />}
                loading={busy === index}
                onClick={() => download(quiz, index)}
              >
                Завантажити
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={quiz.name}
              description={
                <>
                  <Typography.Text type="secondary" style={{ wordBreak: "break-all" }}>
                    {quiz.download_path}
                  </Typography.Text>
                  <br />
                  <Typography.Text type="secondary">Папка: {quiz.folder}</Typography.Text>
                </>
              }
            />
          </List.Item>
        )}
      />
    </Card>
  );
}

const VERSION_CHECK_MS = 5 * 60 * 1000;

// Version, docs link, newer release on PyPI and "restart required" after an update.
export function AdminFooter({ version }: { version: string }) {
  const [latest, setLatest] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);

  useEffect(() => {
    fetch("https://pypi.org/pypi/webquiz/json", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data && isNewerVersion(data.info.version, version)) setLatest(data.info.version);
      })
      .catch(() => {
        // No internet: no update notice
      });

    const check = () =>
      apiGet<{ restart_required: boolean; file_version: string }>("/api/admin/version-check")
        .then((result) => {
          if (result.ok && result.data.restart_required) setInstalled(result.data.file_version);
        })
        .catch(() => {});
    const first = window.setTimeout(check, 2000);
    const timer = window.setInterval(check, VERSION_CHECK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [version]);

  return (
    <Flex vertical align="center" gap={6} style={{ marginTop: 16 }} data-testid="admin-footer">
      <Typography.Text type="secondary">
        WebQuiz v{version}
        {" | "}
        <a
          href={`https://github.com/oduvan/webquiz/releases/download/v${version}/webquiz-documentation-uk.pdf`}
          target="_blank"
          rel="noreferrer"
        >
          📄 Документація
        </a>
      </Typography.Text>
      {installed ? (
        <Tag color="red">New version installed (v{installed}), restart required</Tag>
      ) : (
        latest && (
          <Tag color="blue">
            ⬆️ Update available:{" "}
            <a href={`https://github.com/oduvan/webquiz/releases/tag/v${latest}`} target="_blank" rel="noreferrer">
              v{latest}
            </a>
          </Tag>
        )
      )}
    </Flex>
  );
}
