import { useState } from "react";
import { Alert, App, Button, Card, Checkbox, Flex, Form, Input, Segmented, Select, Space, Typography } from "antd";
import { DeleteOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { apiSend } from "../shared/api";
import { configToForm, formToConfig, type ConfigData, type ConfigFormValues } from "./types";

type View = "form" | "yaml";
type Feedback = { type: "success" | "error"; text: string; details?: string[] } | null;

// Config tab: structured form (JSON partial update) or the raw YAML.
export function ConfigEditor({
  configPath,
  initialContent,
  initialData,
}: {
  configPath: string;
  initialContent: string;
  initialData: ConfigData | null;
}) {
  const { modal } = App.useApp();
  const [form] = Form.useForm<ConfigFormValues>();
  const [view, setView] = useState<View>("form");
  const [yaml, setYaml] = useState(initialContent);
  const [formDirty, setFormDirty] = useState(false);
  const [yamlDirty, setYamlDirty] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);

  const switchView = (next: View) => {
    if (next === view) return;
    if (view === "form" ? formDirty : yamlDirty) {
      modal.confirm({
        title: "You have unsaved changes. Switch anyway?",
        onOk: () => setView(next),
      });
    } else {
      setView(next);
    }
  };

  const save = async () => {
    setFeedback(null);
    setSaving(true);
    try {
      const body = view === "form" ? { data: formToConfig(form.getFieldsValue(true)) } : { content: yaml };
      const result = await apiSend<{ message: string; config_content?: string; config_data?: ConfigData }>(
        "PUT",
        "/api/admin/config",
        body,
      );
      if (result.ok) {
        setFeedback({ type: "success", text: result.data.message });
        // Both views show the saved config
        if (result.data.config_content !== undefined) setYaml(result.data.config_content);
        if (result.data.config_data) form.setFieldsValue(configToForm(result.data.config_data));
        setFormDirty(false);
        setYamlDirty(false);
      } else {
        setFeedback({
          type: "error",
          text: result.data.error || "Failed to save configuration",
          details: result.data.errors,
        });
      }
    } catch (error) {
      setFeedback({ type: "error", text: `Error: ${(error as Error).message}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Text>
        <strong>Configuration File:</strong> <Typography.Text type="secondary">{configPath}</Typography.Text>
      </Typography.Text>

      <Segmented<View>
        value={view}
        onChange={switchView}
        options={[
          { value: "form", label: "Form" },
          { value: "yaml", label: "YAML" },
        ]}
      />

      <div style={{ display: view === "form" ? undefined : "none" }}>
        <Form
          form={form}
          layout="vertical"
          initialValues={configToForm(initialData)}
          onValuesChange={() => setFormDirty(true)}
        >
          <Card size="small" title="General" style={{ marginBottom: 16 }}>
            <Form.Item
              name="language"
              label="Quiz interface language"
              extra="Controls all user-facing text (registration form, buttons, errors, results). Hot-reloadable."
            >
              <Select
                id="cfg-language"
                style={{ width: "100%", maxWidth: 320 }}
                options={[
                  { value: "uk", label: "Ukrainian (Українська)" },
                  { value: "en", label: "English" },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="extra_answers_with_users_csv"
              valuePropName="checked"
              extra={
                <>
                  A third CSV file <code>&lt;quiz&gt;_NNNN.answers_with_users.csv</code> with each answer plus{" "}
                  <code>user_id</code>, <code>username</code> and registration fields. Takes effect on next quiz switch
                  / quiz restart.
                </>
              }
              style={{ marginBottom: 0 }}
            >
              <Checkbox id="cfg-extra-answers-with-users-csv">Generate extra answers-with-users CSV</Checkbox>
            </Form.Item>
          </Card>

          <Card size="small" title="Registration">
            <Form.Item name="approve" valuePropName="checked">
              <Checkbox id="cfg-reg-approve">Require admin approval</Checkbox>
            </Form.Item>
            <Form.Item name="username_label" label="Username label">
              <Input id="cfg-reg-username-label" placeholder="Ім'я користувача" style={{ maxWidth: 400 }} />
            </Form.Item>
            <Form.Item
              label="Additional registration fields"
              extra="Uncheck the box to disable a field without deleting its name. Disabled fields are kept in the config and can be re-enabled anytime."
              style={{ marginBottom: 0 }}
            >
              <Form.List name="fields">
                {(fields, { add, remove }) => (
                  <Flex vertical gap={8} data-testid="cfg-reg-fields-list">
                    {fields.map((field) => (
                      <Flex key={field.key} gap={8} align="center">
                        <Form.Item name={[field.name, "enabled"]} valuePropName="checked" noStyle>
                          <Checkbox title="Enable/disable this field" />
                        </Form.Item>
                        <Form.Item
                          noStyle
                          shouldUpdate={(prev, next) =>
                            prev.fields?.[field.name]?.enabled !== next.fields?.[field.name]?.enabled
                          }
                        >
                          {() => (
                            <Form.Item name={[field.name, "name"]} noStyle>
                              <Input
                                placeholder="Field name"
                                style={{
                                  maxWidth: 400,
                                  textDecoration:
                                    form.getFieldValue(["fields", field.name, "enabled"]) === false
                                      ? "line-through"
                                      : undefined,
                                }}
                              />
                            </Form.Item>
                          )}
                        </Form.Item>
                        <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} title="Remove" />
                      </Flex>
                    ))}
                    <div>
                      <Button icon={<PlusOutlined />} onClick={() => add({ name: "", enabled: true })}>
                        Add Field
                      </Button>
                    </div>
                  </Flex>
                )}
              </Form.List>
            </Form.Item>
          </Card>
        </Form>
      </div>

      {view === "yaml" && (
        <Input.TextArea
          id="config-editor"
          className="code-editor"
          value={yaml}
          onChange={(event) => {
            setYaml(event.target.value);
            setYamlDirty(true);
          }}
          autoSize={{ minRows: 20, maxRows: 40 }}
          spellCheck={false}
        />
      )}

      <Flex justify="center">
        <Button type="primary" size="large" icon={<SaveOutlined />} loading={saving} onClick={save}>
          Save Configuration
        </Button>
      </Flex>

      {feedback && (
        <Alert
          type={feedback.type}
          showIcon
          title={feedback.text}
          description={
            feedback.details?.length ? (
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {feedback.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : undefined
          }
        />
      )}
    </Space>
  );
}
