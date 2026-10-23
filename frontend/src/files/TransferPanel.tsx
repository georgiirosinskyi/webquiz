import { useState } from "react";
import { App, Button, Card, Flex, Input, Typography } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { apiSend } from "../shared/api";
import { t, tn } from "../shared/i18n";
import { parseTransferKey, TRANSFER_STATUS_TEXT, type TransferState } from "./types";

const TARGET_STORAGE_KEY = "webquiz-transfer-target";

function storedTarget(): string {
  try {
    return localStorage.getItem(TARGET_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

// Send files to another server on the same tunnel server. Shown only while
// GET /api/admin/transfer reports the tunnel as available.
export function TransferPanel({
  state,
  selected,
  onSent,
}: {
  state: TransferState;
  selected: Set<string>;
  onSent: () => void;
}) {
  const { message } = App.useApp();
  const [target, setTarget] = useState(storedTarget);
  const [sending, setSending] = useState(false);

  const send = async () => {
    const to = target.trim();
    if (selected.size === 0) {
      message.error(t("send.select_first"));
      return;
    }
    if (!to) {
      message.error(t("send.enter_target"));
      return;
    }
    setSending(true);
    try {
      const result = await apiSend<{ offer: { files: { type: string }[] } }>("POST", "/api/admin/transfer/send", {
        to,
        files: [...selected].map(parseTransferKey),
      });
      if (result.ok) {
        const media = result.data.offer.files.filter((f) => f.type === "images" || f.type === "attachments").length;
        const note = media > 0 ? t("send.media_note", { count: media }) : "";
        message.success(t("send.sent", { name: to, note }));
        try {
          localStorage.setItem(TARGET_STORAGE_KEY, to);
        } catch {
          // Not remembered; fine
        }
        onSent();
      } else {
        message.error(result.data.error || t("send.failed"));
      }
    } catch (error) {
      message.error(t("common.connection_error", { error: (error as Error).message }));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card size="small" title={t("send.title")} data-testid="transfer-panel">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {t("send.hint")} <strong>{state.name}</strong>.
      </Typography.Paragraph>
      <Flex wrap gap={8} align="center">
        <Typography.Text>{t("send.selected", { files: tn("plural.files", selected.size) })}</Typography.Text>
        <Input
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          onPressEnter={send}
          placeholder={t("send.target_placeholder")}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ flex: 1, minWidth: 180, maxWidth: 300 }}
        />
        <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={send}>
          {t("send.button")}
        </Button>
      </Flex>
      {state.outgoing.slice(0, 5).map((offer) => (
        <div key={offer.id} style={{ marginTop: 6 }}>
          → <strong>{offer.to}</strong>: {tn("plural.files", offer.files.length)},{" "}
          {TRANSFER_STATUS_TEXT[offer.status] ? t(TRANSFER_STATUS_TEXT[offer.status]) : offer.status}
        </div>
      ))}
    </Card>
  );
}
