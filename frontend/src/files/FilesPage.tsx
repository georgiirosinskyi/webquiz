import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Flex, Input, Space, Table, Tabs, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined } from "@ant-design/icons";
import { apiGet, downloadFile } from "../shared/api";
import { t, type MessageKey } from "../shared/i18n";
import { formatDate, formatFileSize } from "../shared/format";
import { FileViewerModal, type ViewRequest } from "./FileViewerModal";
import { QuizEditorModal } from "./QuizEditorModal";
import { TransferPanel } from "./TransferPanel";
import {
  canTransfer,
  TRANSFER_STATUS_TEXT,
  transferKey,
  type FileInfo,
  type FileLists,
  type FileType,
  type TransferState,
} from "./types";

const TABS: { key: FileType; label: MessageKey; empty: MessageKey }[] = [
  { key: "csv", label: "files.tab_csv", empty: "files.empty_csv" },
  { key: "logs", label: "files.tab_logs", empty: "files.empty_logs" },
  { key: "quizzes", label: "files.tab_quizzes", empty: "files.empty_quizzes" },
];

const TRANSFER_POLL_MS = 5000;

// File lists (CSV, logs, quizzes) with viewing, editing, download and sending to another server.
export function FileManager() {
  const { message } = App.useApp();
  const [files, setFiles] = useState<FileLists>({ csv: [], logs: [], quizzes: [] });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<string>("csv");
  const [viewing, setViewing] = useState<ViewRequest | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<TransferState>({ available: false, name: null, outgoing: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const offerStatuses = useRef<Record<string, string>>({});

  const loadFiles = useCallback(async () => {
    try {
      const result = await apiGet<FileLists>("/api/files/list");
      if (!result.ok) {
        message.error(result.data.error || t("files.load_failed"));
        return;
      }
      setFiles(result.data);
      // Forget selected files that do not exist anymore
      setSelected((current) => {
        const existing = new Set(
          (Object.keys(result.data) as FileType[]).flatMap((type) =>
            (result.data[type] || []).map((file) => transferKey(type, file.name)),
          ),
        );
        return new Set([...current].filter((key) => existing.has(key)));
      });
    } catch (error) {
      message.error(t("files.load_error", { error: (error as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [message]);

  const loadTransfer = useCallback(async () => {
    try {
      const result = await apiGet<TransferState>("/api/admin/transfer");
      if (!result.ok) return;
      // Tell the admin when the other server answers
      for (const offer of result.data.outgoing) {
        if (offerStatuses.current[offer.id] === "waiting" && offer.status !== "waiting") {
          const status = TRANSFER_STATUS_TEXT[offer.status];
          const text = `${offer.to}: ${status ? t(status) : offer.status}`;
          if (offer.status === "accepted") message.success(text);
          else message.error(text);
        }
        offerStatuses.current[offer.id] = offer.status;
      }
      setTransfer(result.data);
    } catch {
      // The next poll tries again
    }
  }, [message]);

  useEffect(() => {
    loadFiles();
    loadTransfer();
    const timer = window.setInterval(loadTransfer, TRANSFER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadFiles, loadTransfer]);

  const download = async (type: FileType, name: string) => {
    const error = await downloadFile(`/api/files/${type}/download/${encodeURIComponent(name)}`, name);
    if (error) message.error(t("files.download_failed", { error }));
    else message.success(t("files.downloaded", { name }));
  };

  const columns = (type: FileType): ColumnsType<FileInfo> => [
    {
      key: "name",
      title: t("files.col_name"),
      dataIndex: "name",
      render: (name: string) => (
        <Typography.Text strong style={{ wordBreak: "break-word" }}>
          {name}
        </Typography.Text>
      ),
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      key: "size",
      title: t("files.col_size"),
      dataIndex: "size",
      width: 110,
      responsive: ["sm"],
      render: formatFileSize,
      sorter: (a, b) => a.size - b.size,
    },
    {
      key: "modified",
      title: t("files.col_modified"),
      dataIndex: "modified",
      width: 190,
      responsive: ["md"],
      render: formatDate,
      sorter: (a, b) => a.modified.localeCompare(b.modified),
      defaultSortOrder: "descend",
    },
    {
      key: "actions",
      title: "",
      width: 1,
      render: (_, file) => (
        <Space wrap size={4} style={{ justifyContent: "flex-end" }}>
          {type === "quizzes" && (
            <Button size="small" onClick={() => setEditing(file.name)}>
              {t("files.edit")}
            </Button>
          )}
          {type === "csv" && (
            <>
              <Button size="small" onClick={() => setViewing({ type, name: file.name, mode: "text" })}>
                {t("files.text")}
              </Button>
              <Button size="small" onClick={() => setViewing({ type, name: file.name, mode: "table" })}>
                {t("files.table")}
              </Button>
            </>
          )}
          {type === "logs" && (
            <Button size="small" onClick={() => setViewing({ type, name: file.name, mode: "text" })}>
              {t("files.view")}
            </Button>
          )}
          <Button size="small" onClick={() => download(type, file.name)}>
            {t("files.download")}
          </Button>
        </Space>
      ),
    },
  ];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result = {} as FileLists;
    for (const { key } of TABS) {
      result[key] = (files[key] || []).filter((file) => !term || file.name.toLowerCase().includes(term));
    }
    return result;
  }, [files, search]);

  const fileTable = (type: FileType, empty: MessageKey) => (
    <Table<FileInfo>
      data-testid={`${type}-files`}
      rowKey="name"
      size="middle"
      loading={loading}
      dataSource={filtered[type]}
      columns={columns(type)}
      pagination={filtered[type].length > 50 ? { pageSize: 50 } : false}
      locale={{ emptyText: <Empty description={t(empty)} /> }}
      rowSelection={
        transfer.available
          ? {
              selectedRowKeys: [...selected]
                .filter((key) => key.startsWith(`${type}/`))
                .map((key) => key.slice(type.length + 1)),
              getCheckboxProps: (file) => ({
                disabled: !canTransfer(type, file.name),
                title: t("send.checkbox_title"),
              }),
              onChange: (keys) =>
                setSelected((current) => {
                  const next = new Set([...current].filter((key) => !key.startsWith(`${type}/`)));
                  keys.forEach((name) => next.add(transferKey(type, String(name))));
                  return next;
                }),
            }
          : undefined
      }
    />
  );

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }} data-testid="files-panel">
      <Flex wrap gap={8} justify="space-between">
        <Input.Search
          id="search-input"
          allowClear
          placeholder={t("files.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ maxWidth: 400, flex: 1, minWidth: 200 }}
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={async () => {
            await loadFiles();
            message.success(t("files.refreshed"));
          }}
        >
          {t("common.refresh")}
        </Button>
      </Flex>

      {transfer.available && (
        <TransferPanel
          state={transfer}
          selected={selected}
          onSent={() => {
            setSelected(new Set());
            loadTransfer();
          }}
        />
      )}

      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key);
          setSearch("");
        }}
        items={TABS.map(({ key, label, empty }) => ({ key, label: t(label), children: fileTable(key, empty) }))}
      />

      <FileViewerModal request={viewing} onClose={() => setViewing(null)} />
      <QuizEditorModal filename={editing} onClose={() => setEditing(null)} onSaved={loadFiles} />
    </Space>
  );
}
