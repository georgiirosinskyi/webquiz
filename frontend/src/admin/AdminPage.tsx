import { useCallback, useEffect, useState } from "react";
import { App, Col, Layout, Row, Space, Typography } from "antd";
import { AdminAuth, UKRAINIAN } from "../shared/AdminAuth";
import { AdminLinks } from "../shared/AdminLinks";
import { apiGet } from "../shared/api";
import { getPageData, getServerData } from "../shared/serverData";
import { QuizEditor, type EditorTarget } from "./QuizEditor";
import { QuizzesCard } from "./QuizzesCard";
import { AccessCard, AdminFooter, DownloadableQuizzes, PendingApprovals, ShowAnswersCard, TransferRequests } from "./SideCards";
import { mergeTunnel, type AdminMessage, type AdminPageData, type PendingUser, type QuizList, type TransferRequest, type TunnelStatus } from "./types";
import { useAdminSocket } from "./useAdminSocket";

const page = getPageData<AdminPageData>({
  isTrustedIp: false,
  networkUrls: [],
  downloadableQuizzes: [],
  tunnelPublicKey: "",
});

const TRANSFER_RESULT_TEXT: Record<string, string> = {
  accepted: "прийняв файли",
  rejected: "відхилив файли",
  failed: "не зміг отримати файли",
};

function AdminPanel() {
  const { message } = App.useApp();
  const [list, setList] = useState<QuizList>({ quizzes: [], current_quiz: null });
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [pending, setPending] = useState<Record<string, PendingUser>>({});
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [transfers, setTransfers] = useState<Record<string, TransferRequest>>({});
  const [answersForced, setAnswersForced] = useState(false);

  const loadQuizzes = useCallback(async () => {
    try {
      const result = await apiGet<QuizList>("/api/admin/list-quizzes");
      if (result.ok) {
        setList(result.data);
        setAnswersForced(!!result.data.force_all_completed);
      } else {
        message.error(result.data.error || "Не вдалося завантажити quiz");
      }
    } catch (error) {
      message.error(`Помилка завантаження quiz: ${(error as Error).message}`);
    }
  }, [message]);

  useEffect(() => {
    loadQuizzes();
  }, [loadQuizzes]);

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
        setRequiresApproval(!!data.requires_approval);
        setPending(data.requires_approval ? data.pending_users || {} : {});
        setTunnel((current) => mergeTunnel(current, data.tunnel));
        setTransfers(Object.fromEntries((data.transfer_requests || []).map((request) => [request.id, request])));
        break;
      case "quiz_switched":
        // The server cleared all users
        setRequiresApproval(!!data.requires_approval);
        setPending(data.pending_users || {});
        loadQuizzes();
        break;
      case "transfer_request":
        setTransfers((current) => ({ ...current, [data.request.id]: data.request }));
        message.success(`Новий запит на файли від ${data.request.from}`);
        break;
      case "transfer_request_removed":
        setTransfers((current) => {
          const next = { ...current };
          delete next[data.id];
          return next;
        });
        break;
      case "transfer_result": {
        const text = `Сервер ${data.offer.to} ${TRANSFER_RESULT_TEXT[data.offer.status] || data.offer.status}`;
        if (data.offer.status === "accepted") message.success(text);
        else message.error(text);
        break;
      }
      case "tunnel_status":
        setTunnel((current) => mergeTunnel(current, data.tunnel));
        break;
      case "new_registration":
        setRequiresApproval(true);
        setPending((current) => ({
          ...current,
          [data.user_id]: { username: data.username, registration_fields: data.registration_fields || {} },
        }));
        message.success(`Новий користувач: ${data.username}`);
        break;
      case "registration_updated":
        setPending((current) => ({
          ...current,
          [data.user_id]: { username: data.username, registration_fields: data.registration_fields || {} },
        }));
        message.success(`Користувач ${data.username} оновив дані`);
        break;
      case "user_approved":
        setPending((current) => {
          const next = { ...current };
          delete next[data.user_id];
          return next;
        });
        break;
      case "answers_forced":
        setAnswersForced(data.forced);
        if (data.message) message.success(data.message);
        break;
    }
  });

  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <QuizzesCard list={list} reload={loadQuizzes} onEdit={setEditor} />
        </Col>
        <Col xs={24} lg={10}>
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            {requiresApproval && (
              <PendingApprovals
                users={pending}
                onApproved={(userId) =>
                  setPending((current) => {
                    const next = { ...current };
                    delete next[userId];
                    return next;
                  })
                }
              />
            )}
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
            {list.show_answers_on_completion && (
              <ShowAnswersCard forced={answersForced} onForced={() => setAnswersForced(true)} />
            )}
            <AccessCard urls={page.networkUrls} tunnel={tunnel} publicKey={page.tunnelPublicKey} />
            <DownloadableQuizzes quizzes={page.downloadableQuizzes} onDownloaded={loadQuizzes} />
          </Space>
        </Col>
      </Row>
      <QuizEditor target={editor} onClose={() => setEditor(null)} onSaved={loadQuizzes} />
    </>
  );
}

export function AdminPage() {
  const { version } = getServerData();
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <div className="page-container">
        <AdminAuth title="🔧 Панель Адміністратора WebQuiz" isTrustedIp={page.isTrustedIp} texts={UKRAINIAN}>
          <Typography.Title level={3} style={{ marginTop: 0, textAlign: "center" }} data-testid="admin-panel">
            🔧 Панель Адміністратора WebQuiz
          </Typography.Title>
          <AdminPanel />
          <AdminLinks current="/admin/" />
          <AdminFooter version={version} />
        </AdminAuth>
      </div>
    </Layout>
  );
}
