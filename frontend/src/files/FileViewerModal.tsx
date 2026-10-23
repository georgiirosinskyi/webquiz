import { useEffect, useState } from "react";
import { Alert, Empty, Modal, Spin, Table } from "antd";
import { apiText } from "../shared/api";
import { t } from "../shared/i18n";
import { parseCsv } from "../shared/format";
import type { FileType } from "./types";

export interface ViewRequest {
  type: FileType;
  name: string;
  mode: "text" | "table";
}

function CsvTable({ text }: { text: string }) {
  const rows = parseCsv(text);
  if (rows.length === 0) return <Empty description={t("common.no_data")} />;
  const [header, ...body] = rows;
  return (
    <Table
      data-testid="csv-table"
      size="small"
      bordered
      pagination={false}
      scroll={{ x: "max-content", y: "calc(80vh - 160px)" }}
      rowKey="__row"
      dataSource={body.map((row, index) => ({ __row: index, ...Object.fromEntries(row.map((cell, i) => [i, cell])) }))}
      columns={header.map((title, i) => ({ key: i, dataIndex: String(i), title, ellipsis: { showTitle: true } }))}
    />
  );
}

export function FileViewerModal({ request, onClose }: { request: ViewRequest | null; onClose: () => void }) {
  const [content, setContent] = useState<{ text?: string; error?: string } | null>(null);

  useEffect(() => {
    if (!request) return;
    setContent(null);
    apiText(`/api/files/${request.type}/view/${encodeURIComponent(request.name)}`)
      .then((result) => setContent(result.ok ? { text: result.text } : { error: t("files.view_error", { error: result.error || "" }) }))
      .catch((error) => setContent({ error: t("files.view_load_error", { error: error.message }) }));
  }, [request]);

  return (
    <Modal
      open={!!request}
      title={request?.name}
      onCancel={onClose}
      footer={null}
      width={1000}
      styles={{ body: { maxHeight: "80vh", overflow: "auto" } }}
      destroyOnHidden
    >
      {!content ? (
        <Spin style={{ display: "block", padding: 40 }} />
      ) : content.error ? (
        <Alert type="error" title={content.error} />
      ) : request?.mode === "table" ? (
        <CsvTable text={content.text || ""} />
      ) : (
        <pre className="file-content" data-testid="file-content">
          {content.text}
        </pre>
      )}
    </Modal>
  );
}
