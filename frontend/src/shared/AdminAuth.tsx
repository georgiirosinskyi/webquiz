import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Card, Flex, Form, Input, Spin, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { apiGet, apiSend } from "./api";
import { t } from "./i18n";

type AuthState = "checking" | "login" | "ready";

// Shows children once the admin is authenticated: an existing admin_session
// cookie, a trusted IP (the server accepts its requests without a session) or
// the master key entered here (POST /api/admin/auth sets the cookie).
export function AdminAuth({
  title,
  isTrustedIp,
  children,
}: {
  title: ReactNode;
  isTrustedIp: boolean;
  children: ReactNode;
}) {
  const { message } = App.useApp();
  const [state, setState] = useState<AuthState>("checking");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet("/api/admin/check-session")
      .then((result) => {
        if (result.ok) {
          message.success(t("auth.restored"));
          setState("ready");
        } else if (isTrustedIp) {
          message.success(t("auth.trusted"));
          setState("ready");
        } else {
          setState("login");
        }
      })
      .catch(() => setState(isTrustedIp ? "ready" : "login"));
  }, [isTrustedIp, message]);

  const login = async ({ masterKey }: { masterKey: string }) => {
    setSubmitting(true);
    try {
      const result = await apiSend("POST", "/api/admin/auth", { master_key: masterKey.trim() });
      if (result.ok) {
        message.success(t("auth.success"));
        setState("ready");
      } else {
        message.error(result.data.error || t("auth.failed"));
      }
    } catch (error) {
      message.error(t("common.connection_error", { error: (error as Error).message }));
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "checking") {
    return (
      <Flex justify="center" style={{ padding: 80 }}>
        <Spin size="large" />
      </Flex>
    );
  }
  if (state === "ready") return <>{children}</>;

  return (
    <Flex justify="center" style={{ padding: "48px 16px" }}>
      <Card style={{ width: "100%", maxWidth: 400 }} data-testid="auth-section">
        <Typography.Title level={3} style={{ textAlign: "center", marginTop: 0 }}>
          {title}
        </Typography.Title>
        <Form layout="vertical" onFinish={login}>
          <Form.Item
            name="masterKey"
            label={t("auth.master_key")}
            rules={[{ required: true, whitespace: true, message: t("auth.required") }]}
          >
            <Input.Password id="master-key" prefix={<LockOutlined />} placeholder={t("auth.placeholder")} autoFocus />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {t("auth.login")}
          </Button>
        </Form>
      </Card>
    </Flex>
  );
}
