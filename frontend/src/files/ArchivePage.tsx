import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Card, Empty, Flex, Space, Switch, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, EyeOutlined, FileTextOutlined, ReloadOutlined, TableOutlined } from "@ant-design/icons";
import { apiGet, downloadFile } from "../shared/api";
import { t } from "../shared/i18n";
import { formatFileSize } from "../shared/format";
import { formatTime } from "../live-stats/stats";
import { FileViewerModal, type ViewRequest } from "./FileViewerModal";
import { TransferPanel } from "./TransferPanel";
import { useTransfer } from "./useTransfer";
import { archiveFileUrl, fileLabelKey, runStart, viewMode, visibleRuns, type ArchiveRun } from "./archive";
import { transferKey } from "./types";

const SHOW_EMPTY_KEY = "webquiz-archive-show-empty";

function storedShowEmpty(): boolean {
  try {
    return localStorage.getItem(SHOW_EMPTY_KEY) === "1";
  } catch {
    return false;
  }
}

function formatStart(run: ArchiveRun): string {
  const start = runStart(run);
  if (!start) return run.name;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(start.getDate())}.${pad(start.getMonth() + 1)}.${start.getFullYear()} ${pad(start.getHours())}:${pad(start.getMinutes())}`;
}

function RunFiles({
  run,
  leftColumns,
  onView,
}: {
  run: ArchiveRun;
  leftColumns: string[];
  onView: (request: ViewRequest) => void;
}) {
  const { message } = App.useApp();
  const download = async (name: string, format: "file" | "xlsx") => {
    const saveAs = format === "xlsx" ? `${run.name}-${name.replace(/\.csv$/i, "")}.xlsx` : `${run.name}-${name}`;
    const error = await downloadFile(archiveFileUrl(run.name, name, format), saveAs);
    if (error) message.error(t("files.download_failed", { error }));
  };
  if (run.files.length === 0) return <Typography.Text type="secondary">{t("archive.no_files")}</Typography.Text>;
  // A card per file, three in a row (one on phones)
  return (
    <div className="archive-files" data-testid="archive-files">
      {run.files.map((file) => {
        const label = fileLabelKey(file.name);
        const title = label ? t(label) : file.name;
        const isTable = viewMode(file.name) === "table";
        return (
          <Card key={file.name} size="small" className="archive-file" data-testid="archive-file" data-file={file.name}>
            <Flex gap={10} align="flex-start">
              {isTable ? <TableOutlined className="archive-file-icon" /> : <FileTextOutlined className="archive-file-icon" />}
              <Flex vertical style={{ minWidth: 0 }}>
                <Typography.Text strong>{title}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {file.name} · {formatFileSize(file.size)}
                </Typography.Text>
              </Flex>
            </Flex>
            <Space size={4} wrap style={{ marginTop: 10 }}>
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() =>
                  onView({
                    url: archiveFileUrl(run.name, file.name),
                    title: `${title} · ${run.name}`,
                    mode: viewMode(file.name),
                    leftColumns,
                  })
                }
              >
                {t("files.view")}
              </Button>
              {isTable ? (
                <>
                  <Button size="small" icon={<DownloadOutlined />} onClick={() => download(file.name, "file")}>
                    CSV
                  </Button>
                  <Button size="small" icon={<DownloadOutlined />} onClick={() => download(file.name, "xlsx")}>
                    XLSX
                  </Button>
                </>
              ) : (
                <Button size="small" icon={<DownloadOutlined />} onClick={() => download(file.name, "file")}>
                  {t("files.download")}
                </Button>
              )}
            </Space>
          </Card>
        );
      })}
    </div>
  );
}

// Every quiz run with its numbers; a record expands to its CSV files and log.
export function ArchivePage() {
  const { message } = App.useApp();
  const [runs, setRuns] = useState<ArchiveRun[]>([]);
  const [leftColumns, setLeftColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEmpty, setShowEmpty] = useState(storedShowEmpty);
  const [viewing, setViewing] = useState<ViewRequest | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [transfer, reloadTransfer] = useTransfer();

  const load = useCallback(async () => {
    try {
      const result = await apiGet<{ runs: ArchiveRun[]; left_columns?: string[] }>("/api/admin/archive");
      if (result.ok) {
        setRuns(result.data.runs);
        setLeftColumns(result.data.left_columns || []);
      }
      else message.error(result.data.error || t("archive.load_failed"));
    } catch (error) {
      message.error(t("files.load_error", { error: (error as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => visibleRuns(runs, showEmpty), [runs, showEmpty]);

  const toggleEmpty = (value: boolean) => {
    setShowEmpty(value);
    try {
      localStorage.setItem(SHOW_EMPTY_KEY, value ? "1" : "0");
    } catch {
      // Not remembered; fine
    }
  };

  const columns: ColumnsType<ArchiveRun> = [
    {
      key: "date",
      title: t("archive.col_date"),
      render: (_, run) => <span style={{ whiteSpace: "nowrap" }}>{formatStart(run)}</span>,
    },
    {
      key: "quiz",
      title: t("archive.col_quiz"),
      className: "archive-quiz-cell",
      render: (_, run) => (
        <Flex vertical>
          <Space size={4} wrap>
            <Typography.Text strong>{run.title || run.quiz || run.name}</Typography.Text>
            {run.current && <Tag color="green">{t("archive.current")}</Tag>}
          </Space>
          {run.quiz && run.title && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {run.quiz}
            </Typography.Text>
          )}
        </Flex>
      ),
    },
    { key: "questions", title: t("archive.col_questions"), align: "center", responsive: ["sm"], render: (_, run) => run.total_questions ?? "—" },
    { key: "users", title: t("archive.col_users"), align: "center", render: (_, run) => run.users ?? "—" },
    {
      key: "correct",
      title: <span style={{ whiteSpace: "pre-line" }}>{t("archive.col_correct")}</span>,
      align: "center",
      render: (_, run) => (run.correct_percent === null || run.correct_percent === undefined ? "—" : `${run.correct_percent}%`),
    },
    {
      key: "time",
      title: t("archive.col_avg_time"),
      align: "center",
      responsive: ["sm"],
      render: (_, run) => formatTime(run.avg_time_per_question) || "—",
    },
  ];

  return (
    <Flex vertical gap={16}>
      {transfer.available && (
        <TransferPanel
          state={transfer}
          selected={new Set(selected.map((name) => transferKey("archive", `${name}.zip`)))}
          onSent={() => {
            setSelected([]);
            reloadTransfer();
          }}
        />
      )}
      <Card>
        <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary">{t("archive.hint")}</Typography.Text>
          <Space wrap>
            <Space size={6}>
              <Switch size="small" checked={showEmpty} onChange={toggleEmpty} data-testid="archive-show-empty" />
              <Typography.Text>{t("archive.show_empty")}</Typography.Text>
            </Space>
            <Button icon={<ReloadOutlined />} onClick={load} title={t("archive.refresh")} />
          </Space>
        </Flex>
        <Table<ArchiveRun>
          data-testid="archive-table"
          rowKey="name"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={visible}
          pagination={visible.length > 50 ? { pageSize: 50 } : false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <Empty description={t("archive.empty")} /> }}
          rowSelection={
            transfer.available
              ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }
              : undefined
          }
          expandable={{
            expandedRowRender: (run) => <RunFiles run={run} leftColumns={leftColumns} onView={setViewing} />,
            expandRowByClick: true,
          }}
        />
      </Card>
      <FileViewerModal request={viewing} onClose={() => setViewing(null)} />
    </Flex>
  );
}
