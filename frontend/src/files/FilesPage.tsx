import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Card, Empty, Flex, Input, Layout, Space, Table, Tabs, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ReloadOutlined } from "@ant-design/icons";
import { AdminAuth } from "../shared/AdminAuth";
import { AdminLinks } from "../shared/AdminLinks";
import { apiGet, downloadFile } from "../shared/api";
import { formatDate, formatFileSize } from "../shared/format";
import { getPageData } from "../shared/serverData";
import { ConfigEditor } from "./ConfigEditor";
import { FileViewerModal, type ViewRequest } from "./FileViewerModal";
import { QuizEditorModal } from "./QuizEditorModal";
import { TransferPanel } from "./TransferPanel";
import {
  canTransfer,
  TRANSFER_STATUS_TEXT,
  transferKey,
  type FileInfo,
  type FileLists,
  type FilesPageData,
  type FileType,
  type TransferState,
} from "./types";

const page = getPageData<FilesPageData>({ isTrustedIp: false, configPath: null, configContent: null, configData: null });

const TABS: { key: FileType; label: string; empty: string }[] = [
  { key: "csv", label: "📊 CSV Files", empty: "No CSV files found" },
  { key: "logs", label: "📋 Log Files", empty: "No log files found" },
  { key: "quizzes", label: "📝 Quiz Files", empty: "No quiz files found" },
];

const TRANSFER_POLL_MS = 5000;

function FileManager() {
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
        message.error(result.data.error || "Failed to load files");
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
      message.error(`Error loading files: ${(error as Error).message}`);
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
          const text = `${offer.to}: ${TRANSFER_STATUS_TEXT[offer.status] || offer.status}`;
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
    if (error) message.error(`Download failed: ${error}`);
    else message.success(`Downloaded ${name}`);
  };

  const columns = (type: FileType): ColumnsType<FileInfo> => [
    {
      key: "name",
      title: "Name",
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
      title: "Size",
      dataIndex: "size",
      width: 110,
      responsive: ["sm"],
      render: formatFileSize,
      sorter: (a, b) => a.size - b.size,
    },
    {
      key: "modified",
      title: "Modified",
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
              ✏️ Edit
            </Button>
          )}
          {type === "csv" && (
            <>
              <Button size="small" onClick={() => setViewing({ type, name: file.name, mode: "text" })}>
                📄 Text
              </Button>
              <Button size="small" onClick={() => setViewing({ type, name: file.name, mode: "table" })}>
                📊 Table
              </Button>
            </>
          )}
          {type === "logs" && (
            <Button size="small" onClick={() => setViewing({ type, name: file.name, mode: "text" })}>
              👁️ View
            </Button>
          )}
          <Button size="small" onClick={() => download(type, file.name)}>
            💾 Download
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

  const fileTable = (type: FileType, empty: string) => (
    <Table<FileInfo>
      data-testid={`${type}-files`}
      rowKey="name"
      size="middle"
      loading={loading}
      dataSource={filtered[type]}
      columns={columns(type)}
      pagination={filtered[type].length > 50 ? { pageSize: 50 } : false}
      locale={{ emptyText: <Empty description={empty} /> }}
      rowSelection={
        transfer.available
          ? {
              selectedRowKeys: [...selected]
                .filter((key) => key.startsWith(`${type}/`))
                .map((key) => key.slice(type.length + 1)),
              getCheckboxProps: (file) => ({
                disabled: !canTransfer(type, file.name),
                title: "Select to send to another server",
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
          placeholder="Search files..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          style={{ maxWidth: 400, flex: 1, minWidth: 200 }}
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={async () => {
            await loadFiles();
            message.success("Files refreshed");
          }}
        >
          Refresh
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
        items={[
          ...TABS.map(({ key, label, empty }) => ({ key, label, children: fileTable(key, empty) })),
          ...(page.configPath
            ? [
                {
                  key: "config",
                  label: "⚙️ Config",
                  children: (
                    <ConfigEditor
                      configPath={page.configPath}
                      initialContent={page.configContent || ""}
                      initialData={page.configData}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />

      <FileViewerModal request={viewing} onClose={() => setViewing(null)} />
      <QuizEditorModal filename={editing} onClose={() => setEditing(null)} onSaved={loadFiles} />
    </Space>
  );
}

export function FilesPage() {
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <div className="page-container">
        <AdminAuth title="📁 WebQuiz File Manager" isTrustedIp={page.isTrustedIp}>
          <Card>
            <Typography.Title level={3} style={{ marginTop: 0, textAlign: "center" }}>
              📁 WebQuiz File Manager
            </Typography.Title>
            <FileManager />
            <AdminLinks current="/files/" />
          </Card>
        </AdminAuth>
      </div>
    </Layout>
  );
}
