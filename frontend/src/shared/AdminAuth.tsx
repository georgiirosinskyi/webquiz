import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Card, Flex, Form, Input, Spin, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { apiGet, apiSend } from "./api";

type AuthState = "checking" | "login" | "ready";

export interface AuthTexts {
  masterKey: string;
  placeholder: string;
  login: string;
  required: string;
  restored: string;
  trusted: string;
  success: string;
  failed: string;
  connectionError: string;
}

const ENGLISH: AuthTexts = {
  masterKey: "Master Key",
  placeholder: "Enter master key",
  login: "Login",
  required: "Please enter master key",
  restored: "Session restored",
  trusted: "Auto-authenticated from trusted IP",
  success: "Authentication successful!",
  failed: "Authentication failed",
  connectionError: "Connection error",
};

export const UKRAINIAN: AuthTexts = {
  masterKey: "Ключ",
  placeholder: "Введіть ключ",
  login: "Увійти",
  required: "Будь ласка, введіть ключ",
  restored: "Сесію відновлено",
  trusted: "Авто-автентифікація з довіреного IP",
  success: "Успішна автентифікація!",
  failed: "Автентифікація невдала",
  connectionError: "Помилка з'єднання",
};

// Shows children once the admin is authenticated: an existing admin_session
// cookie, a trusted IP (the server accepts its requests without a session) or
// the master key entered here (POST /api/admin/auth sets the cookie).
export function AdminAuth({
  title,
  isTrustedIp,
  texts = ENGLISH,
  children,
}: {
  title: ReactNode;
  isTrustedIp: boolean;
  texts?: AuthTexts;
  children: ReactNode;
}) {
  const { message } = App.useApp();
  const [state, setState] = useState<AuthState>("checking");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet("/api/admin/check-session")
      .then((result) => {
        if (result.ok) {
          message.success(texts.restored);
          setState("ready");
        } else if (isTrustedIp) {
          message.success(texts.trusted);
          setState("ready");
        } else {
          setState("login");
        }
      })
      .catch(() => setState(isTrustedIp ? "ready" : "login"));
  }, [isTrustedIp, message, texts]);

  const login = async ({ masterKey }: { masterKey: string }) => {
    setSubmitting(true);
    try {
      const result = await apiSend("POST", "/api/admin/auth", { master_key: masterKey.trim() });
      if (result.ok) {
        message.success(texts.success);
        setState("ready");
      } else {
        message.error(result.data.error || texts.failed);
      }
    } catch (error) {
      message.error(`${texts.connectionError}: ${(error as Error).message}`);
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
            label={texts.masterKey}
            rules={[{ required: true, whitespace: true, message: texts.required }]}
          >
            <Input.Password id="master-key" prefix={<LockOutlined />} placeholder={texts.placeholder} autoFocus />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {texts.login}
          </Button>
        </Form>
      </Card>
    </Flex>
  );
}
