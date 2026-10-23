import { useEffect, useState } from "react";
import { Alert, Empty, Modal, Spin, Table } from "antd";
import { apiText } from "../shared/api";
import { t } from "../shared/i18n";
import { csvColumnWidths, parseCsv } from "../shared/format";

export interface ViewRequest {
  url: string;
  title: string;
  mode: "text" | "table";
  // Headers of free-text columns (name, registration fields, question and answers): left-aligned, the rest centered
  leftColumns?: string[];
}

function CsvTable({ text, leftColumns = [] }: { text: string; leftColumns?: string[] }) {
  const rows = parseCsv(text);
  if (rows.length === 0) return <Empty description={t("common.no_data")} />;
  const [header, ...body] = rows;
  // Fixed widths: with a fixed header antd draws the header and the body as two tables,
  // which only stay aligned when every column has a width
  const widths = csvColumnWidths(rows);
  return (
    <Table
      data-testid="csv-table"
      size="small"
      bordered
      pagination={false}
      tableLayout="fixed"
      scroll={{ x: widths.reduce((sum, width) => sum + width, 0), y: "calc(80vh - 160px)" }}
      rowKey="__row"
      dataSource={body.map((row, index) => ({ __row: index, ...Object.fromEntries(row.map((cell, i) => [i, cell])) }))}
      columns={widths.map((width, i) => ({
        key: i,
        dataIndex: String(i),
        title: header[i] ?? "",
        width,
        align: leftColumns.includes(header[i] ?? "") ? ("left" as const) : ("center" as const),
        // Headers are always centered
        onHeaderCell: () => ({ style: { textAlign: "center" as const } }),
        ellipsis: { showTitle: true },
      }))}
    />
  );
}

export function FileViewerModal({ request, onClose }: { request: ViewRequest | null; onClose: () => void }) {
  const [content, setContent] = useState<{ text?: string; error?: string } | null>(null);

  useEffect(() => {
    if (!request) return;
    setContent(null);
    apiText(request.url)
      .then((result) => setContent(result.ok ? { text: result.text } : { error: t("files.view_error", { error: result.error || "" }) }))
      .catch((error) => setContent({ error: t("files.view_load_error", { error: error.message }) }));
  }, [request]);

  return (
    <Modal
      open={!!request}
      title={request?.title}
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
        <CsvTable text={content.text || ""} leftColumns={request.leftColumns} />
      ) : (
        <pre className="file-content" data-testid="file-content">
          {content.text}
        </pre>
      )}
    </Modal>
  );
}
