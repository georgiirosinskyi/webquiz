import { useCallback, useEffect, useState, type ReactNode } from "react";
import { App, Badge, Card, Flex, Layout, Menu, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  DashboardOutlined,
  InboxOutlined,
  GlobalOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { AdminAuth } from "../shared/AdminAuth";
import { apiGet } from "../shared/api";
import { t, type MessageKey } from "../shared/i18n";
import { getPageData, getServerData } from "../shared/serverData";
import { ConfigEditor } from "../files/ConfigEditor";
import { ArchivePage } from "../files/ArchivePage";
import { OverviewPage } from "./OverviewPage";
import { QuizEditor, type EditorTarget } from "./QuizEditor";
import { QuizzesCard } from "./QuizzesCard";
import { AccessCard, AdminFooter, DownloadableQuizzes, TransferRequests } from "./SideCards";
import { upsertUser } from "./overview";
import { navigate, useSection, type Section } from "./router";
import {
  mergeTunnel,
  type AdminMessage,
  type AdminPageData,
  type AdminUser,
  type CurrentQuiz,
  type QuizList,
  type TransferRequest,
  type TunnelStatus,
} from "./types";
import { useAdminSocket } from "./useAdminSocket";

const page = getPageData<AdminPageData>({
  isTrustedIp: false,
  networkUrls: [],
  downloadableQuizzes: [],
  tunnelPublicKey: "",
  configPath: null,
  configContent: null,
  configData: null,
});

const TRANSFER_RESULT_TEXT: Record<string, MessageKey> = {
  accepted: "admin.transfer_accepted",
  rejected: "admin.transfer_rejected",
  failed: "admin.transfer_failed",
};

const SECTION_TITLES: Record<Section, MessageKey> = {
  overview: "menu.overview",
  quizzes: "menu.quizzes",
  archive: "menu.archive",
  settings: "menu.settings",
  access: "menu.access",
};

function SectionHeader({ title, extra }: { title: string; extra?: ReactNode }) {
  return (
    <Flex justify="space-between" align="center" wrap gap={12} className="section-header">
      <Typography.Title level={4} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      {extra}
    </Flex>
  );
}

function AdminShell() {
  const { message } = App.useApp();
  const section = useSection();
  const [list, setList] = useState<QuizList>({ quizzes: [], current_quiz: null });
  const [quiz, setQuiz] = useState<CurrentQuiz | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [transfers, setTransfers] = useState<Record<string, TransferRequest>>({});
  const [config, setConfig] = useState({ content: page.configContent || "", data: page.configData });

  useEffect(() => {
    document.title = `${t(SECTION_TITLES[section])} · WebQuiz`;
  }, [section]);

  const loadQuizzes = useCallback(async () => {
    try {
      const result = await apiGet<QuizList>("/api/admin/list-quizzes");
      if (result.ok) setList(result.data);
      else message.error(result.data.error || t("admin.load_quizzes_failed"));
    } catch (error) {
      message.error(t("common.error", { error: (error as Error).message }));
    }
  }, [message]);

  useEffect(() => {
    loadQuizzes();
  }, [loadQuizzes]);

  const openEditor = async (filename: string) => {
    const result = await apiGet<{ parsed: Record<string, unknown> }>(`/api/admin/quiz/${encodeURIComponent(filename)}`);
    if (result.ok) setEditor({ mode: "edit", filename, parsed: result.data.parsed || null });
    else message.error(result.data.error || t("admin.load_quiz_failed"));
  };

  const reloadTransfers = async () => {
    try {
      const result = await apiGet<{ incoming: TransferRequest[] }>("/api/admin/transfer");
      if (result.ok) setTransfers(Object.fromEntries(result.data.incoming.map((request) => [request.id, request])));
    } catch {
      // Keep the current list
    }
  };

  useAdminSocket((data: AdminMessage) => {
    switch (data.type) {
      case "initial_state":
        if (data.quiz) setQuiz(data.quiz);
        setUsers((data.users || []).map((user) => ({ ...user, received_at: Date.now() })));
        setTunnel((current) => mergeTunnel(current, data.tunnel));
        setTransfers(Object.fromEntries((data.transfer_requests || []).map((request) => [request.id, request])));
        break;
      case "quiz_switched":
        // The server cleared all users
        if (data.quiz) setQuiz(data.quiz);
        setUsers([]);
        loadQuizzes();
        break;
      case "user_updated":
        setUsers((current) => upsertUser(current, data.user, Date.now()));
        break;
      case "transfer_request":
        setTransfers((current) => ({ ...current, [data.request.id]: data.request }));
        message.success(t("admin.new_transfer", { name: data.request.from }));
        break;
      case "transfer_request_removed":
        setTransfers((current) => {
          const next = { ...current };
          delete next[data.id];
          return next;
        });
        break;
      case "transfer_result": {
        const key = TRANSFER_RESULT_TEXT[data.offer.status];
        const text = key
          ? t(key, { name: data.offer.to })
          : t("admin.transfer_other", { name: data.offer.to, status: data.offer.status });
        if (data.offer.status === "accepted") message.success(text);
        else message.error(text);
        break;
      }
      case "tunnel_status":
        setTunnel((current) => mergeTunnel(current, data.tunnel));
        break;
      case "new_registration":
        message.info(t("admin.new_registration", { name: data.username }));
        break;
      case "answers_forced":
        setQuiz((current) => (current ? { ...current, force_all_completed: data.forced } : current));
        setList((current) => ({ ...current, force_all_completed: data.forced }));
        if (data.forced) message.success(t("admin.answers_opened"));
        break;
    }
  });

  const pendingCount = users.filter((user) => user.status === "pending").length;
  const transferCount = Object.keys(transfers).length;
  const label = (text: string, count = 0, dot = false) => (
    <Badge
      count={count}
      dot={dot}
      size="small"
      offset={[6, -2]}
      color={dot ? "#52c41a" : "#faad14"}
      style={{ boxShadow: "none" }}
      rootClassName="menu-badge"
    >
      {text}
    </Badge>
  );

  const menuItems: MenuProps["items"] = [
    { key: "overview", icon: <DashboardOutlined />, label: label(t("menu.overview"), pendingCount) },
    { key: "quizzes", icon: <UnorderedListOutlined />, label: label(t("menu.quizzes"), transferCount) },
    { key: "archive", icon: <InboxOutlined />, label: label(t("menu.archive")) },
    ...(page.configPath ? [{ key: "settings", icon: <SettingOutlined />, label: label(t("menu.settings")) }] : []),
    { key: "access", icon: <GlobalOutlined />, label: label(t("menu.access"), 0, !!tunnel?.connected) },
  ];

  const transferRequests = (
    <TransferRequests
      requests={Object.values(transfers)}
      onDone={(requestId, keep) => {
        if (keep) reloadTransfers();
        else
          setTransfers((current) => {
            const next = { ...current };
            delete next[requestId];
            return next;
          });
      }}
    />
  );

  let content: ReactNode;
  switch (section) {
    case "overview":
      content = <OverviewPage quiz={quiz} users={users} quizzes={list.quizzes} onEdit={openEditor} />;
      break;
    case "quizzes":
      content = (
        <Flex vertical gap={16}>
          <SectionHeader title={t("menu.quizzes")} />
          {transferRequests}
          <QuizzesCard list={list} reload={loadQuizzes} onEdit={setEditor} />
          {page.downloadableQuizzes.length > 0 && (
            <DownloadableQuizzes quizzes={page.downloadableQuizzes} onDownloaded={loadQuizzes} />
          )}
        </Flex>
      );
      break;
    case "archive":
      content = (
        <Flex vertical gap={16}>
          <SectionHeader title={t("menu.archive")} />
          {transferRequests}
          <ArchivePage />
        </Flex>
      );
      break;
    case "settings":
      content = (
        <Flex vertical gap={16}>
          <SectionHeader title={t("menu.settings")} />
          <Card>
            {page.configPath ? (
              <ConfigEditor
                configPath={page.configPath}
                initialContent={config.content}
                initialData={config.data}
                onSaved={(content, data) => setConfig({ content, data })}
              />
            ) : (
              <Typography.Text type="secondary">{t("admin.no_config")}</Typography.Text>
            )}
          </Card>
        </Flex>
      );
      break;
    case "access":
      content = (
        <Flex vertical gap={16}>
          <SectionHeader title={t("menu.access")} />
          <AccessCard urls={page.networkUrls} tunnel={tunnel} publicKey={page.tunnelPublicKey} />
        </Flex>
      );
      break;
  }

  return (
    <Layout style={{ minHeight: "100vh" }} data-testid="admin-panel">
      <Layout.Header className="admin-header">
        <span className="admin-brand" onClick={() => navigate("overview")}>
          🔧 WebQuiz
        </span>
        <Menu
          className="admin-menu"
          theme="dark"
          mode="horizontal"
          selectedKeys={[section]}
          items={menuItems}
          onClick={({ key }) => navigate(key as Section)}
          data-testid="admin-menu"
        />
      </Layout.Header>
      <Layout.Content className="admin-content">{content}</Layout.Content>
      <Layout.Footer style={{ padding: "8px 16px 20px" }}>
        <AdminFooter version={getServerData().version} />
      </Layout.Footer>
      <QuizEditor target={editor} onClose={() => setEditor(null)} onSaved={loadQuizzes} />
    </Layout>
  );
}

export function AdminApp() {
  return (
    <AdminAuth title={t("auth.title")} isTrustedIp={page.isTrustedIp}>
      <AdminShell />
    </AdminAuth>
  );
}
