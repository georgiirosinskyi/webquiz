import { useState } from "react";
import { App, Button, Card, Flex, Input, Typography } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { apiSend } from "../shared/api";
import { plural } from "../shared/format";
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
      message.error("Select files with the checkboxes first");
      return;
    }
    if (!to) {
      message.error("Enter the name of the other server");
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
        const note = media > 0 ? ` (plus ${plural(media, "image/attachment file")} used by the quizzes)` : "";
        message.success(`Request sent to ${to}${note}. Waiting for an answer there.`);
        try {
          localStorage.setItem(TARGET_STORAGE_KEY, to);
        } catch {
          // Not remembered; fine
        }
        onSent();
      } else {
        message.error(result.data.error || "Failed to send the request");
      }
    } catch (error) {
      message.error(`Connection error: ${(error as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card size="small" title="📤 Send files to another server" data-testid="transfer-panel">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        Select files with the checkboxes. Images and attachments used by a quiz are sent with it. This server is{" "}
        <strong>{state.name}</strong>.
      </Typography.Paragraph>
      <Flex wrap gap={8} align="center">
        <Typography.Text>{plural(selected.size, "file")} selected</Typography.Text>
        <Input
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          onPressEnter={send}
          placeholder="Name of the other server"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ flex: 1, minWidth: 180, maxWidth: 300 }}
        />
        <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={send}>
          Send
        </Button>
      </Flex>
      {state.outgoing.slice(0, 5).map((offer) => (
        <div key={offer.id} style={{ marginTop: 6 }}>
          → <strong>{offer.to}</strong>: {plural(offer.files.length, "file")},{" "}
          {TRANSFER_STATUS_TEXT[offer.status] || offer.status}
        </div>
      ))}
    </Card>
  );
}
