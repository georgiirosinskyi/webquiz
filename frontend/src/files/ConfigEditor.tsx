import { useState } from "react";
import { Alert, App, Button, Card, Checkbox, ColorPicker, Flex, Form, Input, Segmented, Select, Space, Typography } from "antd";
import type { Color } from "antd/es/color-picker";
import { DeleteOutlined, PictureOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { ImagePicker } from "../admin/Pickers";
import { apiSend } from "../shared/api";
import { DEFAULT_BACKGROUND_COLOR } from "../shared/background";
import { configToForm, formToConfig, type ConfigData, type ConfigFormValues } from "./types";

type View = "form" | "yaml";
type Feedback = { type: "success" | "error"; text: string; details?: string[] } | null;

// Colors offered next to the picker: the dark default and a few calm ones
const BACKGROUND_PRESETS = [
  DEFAULT_BACKGROUND_COLOR,
  "#141414",
  "#0f2a44",
  "#1b3a2f",
  "#3b1f3a",
  "#f5f5f5",
  "#e6f4ff",
];

// How the quiz page background looks; the admin page serves /imgs/ too, so the path works as is
function BackgroundPreview({ mode, color, image }: { mode: string; color: string; image: string }) {
  const url = mode === "image" ? image.trim() : "";
  return (
    <div
      className="background-preview"
      data-testid="cfg-background-preview"
      style={{
        backgroundColor: color || DEFAULT_BACKGROUND_COLOR,
        backgroundImage: url ? `url(${JSON.stringify(url)})` : undefined,
      }}
    >
      <div className="background-preview-card" />
    </div>
  );
}

// Config tab: structured form (JSON partial update) or the raw YAML.
export function ConfigEditor({
  configPath,
  initialContent,
  initialData,
  onSaved,
}: {
  configPath: string;
  initialContent: string;
  initialData: ConfigData | null;
  onSaved?: (content: string, data: ConfigData | null) => void;
}) {
  const { modal } = App.useApp();
  const [form] = Form.useForm<ConfigFormValues>();
  const [view, setView] = useState<View>("form");
  const [yaml, setYaml] = useState(initialContent);
  const [formDirty, setFormDirty] = useState(false);
  const [yamlDirty, setYamlDirty] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const backgroundMode = Form.useWatch("background_mode", form) || "color";
  const backgroundColor = Form.useWatch("background_color", form) || DEFAULT_BACKGROUND_COLOR;
  const backgroundImage = Form.useWatch("background_image", form) || "";

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
        if (result.data.config_content !== undefined) onSaved?.(result.data.config_content, result.data.config_data || null);
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

          <Card size="small" title="Quiz page background" style={{ marginBottom: 16 }} data-testid="cfg-background">
            <Flex gap={24} wrap align="flex-start">
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <Form.Item name="background_mode" label="Background">
                  <Segmented
                    id="cfg-background-mode"
                    options={[
                      { value: "color", label: "Color" },
                      { value: "image", label: "Image" },
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  name="background_color"
                  label={backgroundMode === "image" ? "Color under the image" : "Color"}
                  getValueFromEvent={(color: Color) => color.toHexString()}
                >
                  <ColorPicker
                    showText
                    disabledAlpha
                    presets={[{ label: "Suggested", colors: BACKGROUND_PRESETS }]}
                    data-testid="cfg-background-color"
                  />
                </Form.Item>
                {backgroundMode === "image" && (
                  <Form.Item
                    label="Image"
                    extra="An image from quizzes/imgs/ (put the file there first), or a full https:// URL. It covers the whole page."
                    style={{ marginBottom: 0 }}
                  >
                    <Space.Compact style={{ width: "100%", maxWidth: 480 }}>
                      <Form.Item name="background_image" noStyle>
                        <Input id="cfg-background-image" placeholder="/imgs/background.jpg" allowClear />
                      </Form.Item>
                      <Button icon={<PictureOutlined />} onClick={() => setPickingImage(true)}>
                        Choose
                      </Button>
                    </Space.Compact>
                  </Form.Item>
                )}
              </div>
              <BackgroundPreview mode={backgroundMode} color={backgroundColor} image={backgroundImage} />
            </Flex>
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

      <ImagePicker
        open={pickingImage}
        onClose={() => setPickingImage(false)}
        onSelect={(path) => {
          form.setFieldValue("background_image", path);
          setFormDirty(true);
          setPickingImage(false);
        }}
      />

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
