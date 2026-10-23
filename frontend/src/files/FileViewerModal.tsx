import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
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

// Room the modal needs around the table: the content padding (24px on each side) and the table's scrollbar
const MODAL_PADDING = 48 + 20;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 160;

// Modal width that shows the whole table, but at most 90% of the window
export function viewerWidth(tableWidth: number | null, windowWidth: number): number {
  const max = Math.round(windowWidth * 0.9);
  if (tableWidth === null) return Math.min(1000, max);
  return Math.max(Math.min(MIN_WIDTH, max), Math.min(tableWidth + MODAL_PADDING, max));
}

function CsvTable({ text, leftColumns = [], height }: { text: string; leftColumns?: string[]; height: number | null }) {
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
      // A resized modal gives its body height to the table; 40px is the header row
      scroll={{ x: widths.reduce((sum, width) => sum + width, 0), y: height ? Math.max(height - 40, 60) : "calc(80vh - 160px)" }}
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
  // Offset after dragging by the title, and the size after resizing by the corner (null: not resized yet)
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!request) return;
    setContent(null);
    setOffset({ x: 0, y: 0 });
    setSize(null);
    apiText(request.url)
      .then((result) => setContent(result.ok ? { text: result.text } : { error: t("files.view_error", { error: result.error || "" }) }))
      .catch((error) => setContent({ error: t("files.view_load_error", { error: error.message }) }));
  }, [request]);

  const rows = request?.mode === "table" && content?.text ? parseCsv(content.text) : [];
  const tableWidth = rows.length > 0 ? csvColumnWidths(rows).reduce((sum, width) => sum + width, 0) : null;
  const width = size?.width ?? viewerWidth(tableWidth, window.innerWidth);

  // Moves the modal or changes its size while the mouse button is held
  const track = (event: ReactMouseEvent, onMove: (dx: number, dy: number) => void) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (e: MouseEvent) => onMove(e.clientX - startX, e.clientY - startY);
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  const startDrag = (event: ReactMouseEvent) => {
    const start = offset;
    track(event, (dx, dy) => setOffset({ x: start.x + dx, y: start.y + dy }));
  };

  const startResize = (event: ReactMouseEvent) => {
    const body = (event.currentTarget.parentElement?.querySelector(".ant-modal-body") as HTMLElement | null) ?? null;
    const startWidth = width;
    const startHeight = size?.height ?? body?.clientHeight ?? 400;
    // The modal is centered, so its width grows on both sides; the offset keeps the left edge in place
    const startOffset = offset;
    track(event, (dx, dy) => {
      const newWidth = Math.max(MIN_WIDTH, startWidth + dx);
      setSize({ width: newWidth, height: Math.max(MIN_HEIGHT, startHeight + dy) });
      setOffset({ x: startOffset.x + (newWidth - startWidth) / 2, y: startOffset.y });
    });
  };

  return (
    <Modal
      open={!!request}
      title={
        <div className="modal-drag-handle" onMouseDown={startDrag}>
          {request?.title}
        </div>
      }
      onCancel={onClose}
      footer={null}
      width={width}
      styles={{ body: size ? { height: size.height, overflow: "auto" } : { maxHeight: "80vh", overflow: "auto" } }}
      modalRender={(node) => (
        <div className="resizable-modal" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
          {node}
          <div className="modal-resize-handle" onMouseDown={startResize} title={t("files.resize")} />
        </div>
      )}
      destroyOnHidden
    >
      {!content ? (
        <Spin style={{ display: "block", padding: 40 }} />
      ) : content.error ? (
        <Alert type="error" title={content.error} />
      ) : request?.mode === "table" ? (
        <CsvTable text={content.text || ""} leftColumns={request.leftColumns} height={size?.height ?? null} />
      ) : (
        <pre className="file-content" data-testid="file-content">
          {content.text}
        </pre>
      )}
    </Modal>
  );
}
