import { useEffect, useState } from "react";
import { Alert, App, Button, Card, Flex, Input, List, Select, Space, Tag, Typography } from "antd";
import { CheckOutlined, CloudDownloadOutlined, CopyOutlined, FundProjectionScreenOutlined, LinkOutlined } from "@ant-design/icons";
import { apiGet, apiSend } from "../shared/api";
import { getLanguage, t, type MessageKey } from "../shared/i18n";
import { formatFileSize } from "../shared/format";
import {
  isNewerVersion,
  type DownloadableQuiz,
  type IncomingFile,
  type TransferAction,
  type TransferRequest,
  type TunnelStatus,
} from "./types";
import { SECTION_PATHS } from "./router";

const TRANSFER_TYPE_LABELS: Record<string, MessageKey> = {
  quizzes: "transfer.type_quizzes",
  archive: "transfer.type_archive",
  images: "transfer.type_images",
  attachments: "transfer.type_attachments",
};
const TRANSFER_CASE: Record<IncomingFile["case"], { color: string; key: MessageKey }> = {
  new: { color: "green", key: "transfer.case_new" },
  same: { color: "default", key: "transfer.case_same" },
  different: { color: "orange", key: "transfer.case_different" },
  in_use: { color: "red", key: "transfer.case_in_use" },
};
const TRANSFER_ACTION_TEXT: Record<TransferAction, MessageKey> = {
  save: "transfer.action_save",
  replace: "transfer.action_replace",
  rename: "transfer.action_rename",
  skip: "transfer.action_skip",
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
        const text = result.data.error || t("transfer.request_failed");
        message.error(text);
        // Invalid choices: nothing was downloaded, the request is still open
        keep = result.status === 400;
        setError(text);
      } else if (action === "reject") {
        message.success(t("transfer.rejected"));
      } else {
        const { saved, skipped, failed } = result.data;
        if (saved.length > 0)
          message.success(t("transfer.received", { count: saved.length, names: saved.map((file) => file.saved_as).join(", ") }));
        if (skipped.length > 0) message.success(t("transfer.skipped", { count: skipped.length }));
        failed.forEach((file) => message.error(t("transfer.file_failed", { name: file.name, error: file.error })));
      }
    } catch (caught) {
      const text = t("common.connection_error", { error: (caught as Error).message });
      message.error(text);
      setError(text);
      keep = true;
    } finally {
      setBusy(null);
    }
    onDone(keep);
  };

  return (
    <Card size="small" type="inner" title={t("transfer.from", { name: request.from })} data-testid="transfer-request">
      <Flex vertical gap={10}>
        {request.files.map((file) => {
          const choice = choices[fileKey(file)];
          const caseInfo = TRANSFER_CASE[file.case];
          return (
            <Flex key={fileKey(file)} wrap gap={8} align="center" justify="space-between">
              <div style={{ minWidth: 160 }}>
                <Typography.Text strong style={{ wordBreak: "break-all" }}>
                  {file.name}
                </Typography.Text>
                <br />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {TRANSFER_TYPE_LABELS[file.type] ? t(TRANSFER_TYPE_LABELS[file.type]) : file.type}, {formatFileSize(file.size)}
                </Typography.Text>
              </div>
              <Tag color={caseInfo?.color || "default"} style={{ whiteSpace: "normal" }}>
                {caseInfo ? t(caseInfo.key, { target: file.target }) : file.target}
              </Tag>
              <Space.Compact>
                <Select<TransferAction>
                  aria-label={t("transfer.file_action")}
                  value={choice.action}
                  disabled={!!busy}
                  style={{ width: 150 }}
                  options={file.actions.map((action) => ({ value: action, label: TRANSFER_ACTION_TEXT[action] ? t(TRANSFER_ACTION_TEXT[action]) : action }))}
                  onChange={(action) => setChoices({ ...choices, [fileKey(file)]: { ...choice, action } })}
                />
                {choice.action === "rename" && (
                  <Input
                    aria-label={t("transfer.new_name")}
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
            {t("transfer.accept")}
          </Button>
          <Button danger loading={busy === "reject"} disabled={!!busy} onClick={() => answer("reject")}>
            {t("transfer.reject")}
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
    <Card title={t("transfer.requests_title")} data-testid="transfer-requests">
      <Typography.Paragraph type="secondary">{t("transfer.requests_hint")}</Typography.Paragraph>
      <Flex vertical gap={12}>
        {requests.map((request) => (
          <TransferRequestItem key={request.id} request={request} onDone={(keep) => onDone(request.id, keep)} />
        ))}
      </Flex>
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
      if (!result.ok) throw new Error(result.data.error || t("access.failed"));
      message.success(connected ? t("access.disconnected") : t("access.connected", { url: result.data.url || "" }));
    } catch (error) {
      message.error(t("access.operation_failed", { error: (error as Error).message }));
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
        message.error(t("access.copy_failed"));
      }
    } catch (error) {
      message.error(t("access.copy_error", { error: (error as Error).message }));
    }
  };

  return (
    <Card
      title={t("access.title")}
      data-testid="access-card"
      extra={
        <Button
          icon={<FundProjectionScreenOutlined />}
          href={SECTION_PATHS.projector}
          target="_blank"
          data-testid="projector-btn"
        >
          {t("access.projector")}
        </Button>
      }
    >
      <Typography.Text strong>{t("access.urls")}</Typography.Text>
      <Flex vertical gap={6} style={{ margin: "8px 0 0" }} data-testid="url-list">
        {tunnel?.connected && tunnel.url && (
          <Alert
            type="success"
            title={
              <>
                <strong>{t("access.public_url")}</strong>{" "}
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
            title={t("access.no_interfaces")}
            description={t("access.no_interfaces_hint")}
          />
        )}
      </Flex>

      {showTunnel && (
        <div style={{ marginTop: 16 }} data-testid="tunnel-section">
          <Typography.Title level={5}>{t("access.tunnel")}</Typography.Title>
          <div>
            <strong>{t("access.server")}</strong> {tunnel.server}
          </div>
          {tunnel.socket_name && (
            <div>
              <strong>{t("access.socket")}</strong> {tunnel.socket_name}
            </div>
          )}
          {tunnel.keys_status === "ok" && publicKey && (
            <div style={{ marginTop: 8 }}>
              <strong>{t("access.public_key")}</strong>
              <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                <Input.TextArea readOnly value={publicKey} autoSize={{ minRows: 1, maxRows: 4 }} className="code-editor" />
                <Button icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={copyKey}>
                  {copied ? t("access.copied") : t("access.copy")}
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
            {tunnel.connected ? t("access.disconnect") : t("access.connect")}
          </Button>
          {!tunnel.connected && tunnel.error && (
            <Alert type="error" style={{ marginTop: 10 }} title={t("access.error", { error: tunnel.error })} />
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
      title: t("quizzes.download_title", { name: quiz.name }),
      content: t("quizzes.download_content", { url: quiz.download_path }),
      onOk: async () => {
        setBusy(index);
        try {
          const result = await apiSend<{ success: boolean; message: string }>("POST", "/api/admin/download-quiz", quiz);
          if (result.ok && result.data.success) {
            message.success(`✅ ${result.data.message}`);
            onDownloaded();
          } else {
            message.error(t("quizzes.download_failed", { error: result.data.error || result.status }));
          }
        } catch (error) {
          message.error(t("quizzes.network_error", { error: (error as Error).message }));
        } finally {
          setBusy(null);
        }
      },
    });

  return (
    <Card title={t("quizzes.downloadable_title")} data-testid="downloadable-quizzes">
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
                {t("common.download")}
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
                  <Typography.Text type="secondary">{t("quizzes.folder", { folder: quiz.folder })}</Typography.Text>
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
          href={`https://github.com/oduvan/webquiz/releases/download/v${version}/webquiz-documentation-${getLanguage()}.pdf`}
          target="_blank"
          rel="noreferrer"
        >
          {t("footer.docs")}
        </a>
      </Typography.Text>
      {installed ? (
        <Tag color="red">{t("footer.restart_required", { version: installed })}</Tag>
      ) : (
        latest && (
          <Tag color="blue">
            {t("footer.update")}{" "}
            <a href={`https://github.com/oduvan/webquiz/releases/tag/v${latest}`} target="_blank" rel="noreferrer">
              v{latest}
            </a>
          </Tag>
        )
      )}
    </Flex>
  );
}
