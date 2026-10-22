import { useEffect, useState, type DragEvent } from "react";
import { Button, Card, Checkbox, Flex, Form, Image, Input, InputNumber, Radio, Segmented, Select, Space, Tooltip, Typography } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  DownOutlined,
  HolderOutlined,
  PaperClipOutlined,
  PictureOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { roundPoints } from "../shared/points";
import { changeQuestionType, type QuestionForm, type QuestionType } from "./quizForm";

// A plain number input: antd InputNumber formats 1 as "1.00" and rounds 0.255 on blur,
// while a value with more than 2 decimals must reach the save validation unchanged.
function PointsInput({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(value === null ? "" : String(value));
  }, [value]);
  return (
    <Input
      className="points-input"
      type="number"
      step="0.01"
      placeholder="1"
      value={text}
      style={{ width: 120 }}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.trim() === "" ? null : Number(event.target.value));
      }}
    />
  );
}

export interface CheckerTemplate {
  name: string;
  code: string;
}

const isImagePath = (value: string) => value.trim().startsWith("/imgs/");

export function QuestionCard({
  question,
  index,
  total,
  collapsed,
  errors,
  dragOver,
  checkerTemplates,
  onToggle,
  onChange,
  onMove,
  onRemove,
  onPickImage,
  onPickFile,
  dragHandlers,
}: {
  question: QuestionForm;
  index: number;
  total: number;
  collapsed: boolean;
  errors: string[];
  dragOver: boolean;
  checkerTemplates: CheckerTemplate[];
  onToggle: () => void;
  onChange: (question: QuestionForm) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onPickImage: (target: "question" | number) => void;
  onPickFile: () => void;
  dragHandlers: {
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
}) {
  const set = (patch: Partial<QuestionForm>) => onChange({ ...question, ...patch });
  const points = roundPoints(question.points ?? 1);
  const number = index + 1;

  const setOption = (optionIndex: number, value: string) =>
    set({ options: question.options.map((option, i) => (i === optionIndex ? value : option)) });

  const removeOption = (optionIndex: number) =>
    set({
      options: question.options.filter((_, i) => i !== optionIndex),
      // Shift correct indices after the removed option
      correct: question.correct.filter((i) => i !== optionIndex).map((i) => (i > optionIndex ? i - 1 : i)),
    });

  const toggleCorrect = (optionIndex: number) => {
    if (question.type === "single") set({ correct: [optionIndex] });
    else
      set({
        correct: question.correct.includes(optionIndex)
          ? question.correct.filter((i) => i !== optionIndex)
          : [...question.correct, optionIndex],
      });
  };

  const header = (
    <Flex align="center" gap={8} onClick={onToggle} style={{ cursor: "pointer", minWidth: 0 }}>
      <span
        className="drag-handle"
        title="Перетягніть для зміни порядку"
        draggable
        onClick={(event) => event.stopPropagation()}
        onDragStart={dragHandlers.onDragStart}
        onDragEnd={dragHandlers.onDragEnd}
      >
        <HolderOutlined />
      </span>
      {collapsed ? <RightOutlined /> : <DownOutlined />}
      <span className="question-number">{number}.</span>
      <span className="question-indicators">
        {question.stick_to_the_previous && <span title="Прив'язано до попереднього">🔗</span>}
        {question.image && <span title="Має зображення">🖼️</span>}
        {question.file && <span title="Має файл">📎</span>}
        {points !== 1 && (
          <span className="points-indicator" title={`${points} балів`}>
            🏆{points}
          </span>
        )}
      </span>
      <Typography.Text ellipsis className="question-preview" type={question.question ? undefined : "secondary"}>
        {question.question || (question.image ? question.image.split("/").pop() : "")}
      </Typography.Text>
    </Flex>
  );

  return (
    <Card
      size="small"
      className={`question-item${collapsed ? " collapsed" : ""}${dragOver ? " drag-over" : ""}`}
      data-testid="question-item"
      onDragOver={dragHandlers.onDragOver}
      onDrop={dragHandlers.onDrop}
      style={errors.length > 0 ? { borderColor: "#ff4d4f" } : undefined}
      title={header}
      extra={
        <Space size={2}>
          {index > 0 && <Button size="small" type="text" icon={<ArrowUpOutlined />} title="Перемістити вгору" onClick={() => onMove(-1)} />}
          {index < total - 1 && (
            <Button size="small" type="text" icon={<ArrowDownOutlined />} title="Перемістити вниз" onClick={() => onMove(1)} />
          )}
          <Button size="small" type="text" danger icon={<DeleteOutlined />} title="Видалити" onClick={onRemove} />
        </Space>
      }
      styles={{ body: collapsed ? { display: "none" } : undefined }}
    >
      <Form layout="vertical" component="div">
        <Form.Item label="Текст питання (необов'язково, якщо є зображення)">
          <Input
            className="question-text"
            value={question.question}
            placeholder="Введіть текст питання"
            onChange={(event) => set({ question: event.target.value })}
          />
        </Form.Item>

        <Form.Item label="Зображення питання (необов'язково, якщо є текст)">
          <Space.Compact style={{ width: "100%" }}>
            <Input
              className="question-image"
              value={question.image}
              placeholder="напр., /imgs/diagram.png"
              onChange={(event) => set({ image: event.target.value })}
            />
            <Button icon={<PictureOutlined />} title="Вибрати зображення" onClick={() => onPickImage("question")} />
          </Space.Compact>
          {isImagePath(question.image) && (
            <Image src={question.image} height={120} style={{ marginTop: 8, objectFit: "contain" }} />
          )}
        </Form.Item>

        <Form.Item label="Файл для завантаження (необов'язково)">
          <Space.Compact style={{ width: "100%" }}>
            <Input
              className="question-file"
              value={question.file}
              placeholder="напр., data.xlsx"
              onChange={(event) => set({ file: event.target.value })}
            />
            <Button icon={<PaperClipOutlined />} title="Вибрати файл" onClick={onPickFile} />
          </Space.Compact>
        </Form.Item>

        <Form.Item label="Тип питання">
          <Segmented<QuestionType>
            value={question.type}
            onChange={(type) => onChange(changeQuestionType(question, type))}
            options={[
              { value: "single", label: "📝 Одна правильна" },
              { value: "multiple", label: "☑️ Кілька правильних" },
              { value: "text", label: "✍️ Текстова відповідь" },
            ]}
          />
        </Form.Item>

        {question.type !== "text" ? (
          <>
            <Form.Item label="Варіанти відповідей (позначте правильні)">
              <Flex vertical gap={8}>
                {question.options.map((option, optionIndex) => (
                  <Flex key={optionIndex} gap={8} align="center" className="option-item">
                    {question.type === "single" ? (
                      <Radio checked={question.correct.includes(optionIndex)} onChange={() => toggleCorrect(optionIndex)} />
                    ) : (
                      <Checkbox checked={question.correct.includes(optionIndex)} onChange={() => toggleCorrect(optionIndex)} />
                    )}
                    <Input
                      className="option-text"
                      value={option}
                      placeholder={`Варіант ${optionIndex + 1}`}
                      onChange={(event) => setOption(optionIndex, event.target.value)}
                    />
                    {isImagePath(option) && <Image src={option} height={36} style={{ objectFit: "contain" }} />}
                    <Button
                      icon={<PictureOutlined />}
                      title="Вибрати зображення"
                      onClick={() => onPickImage(optionIndex)}
                    />
                    <Tooltip title={question.options.length <= 2 ? "Питання має мати принаймні 2 варіанти" : undefined}>
                      <Button
                        icon={<DeleteOutlined />}
                        disabled={question.options.length <= 2}
                        onClick={() => removeOption(optionIndex)}
                      />
                    </Tooltip>
                  </Flex>
                ))}
                <div>
                  <Button icon={<PlusOutlined />} onClick={() => set({ options: [...question.options, ""] })}>
                    Додати варіант
                  </Button>
                </div>
              </Flex>
            </Form.Item>
            {question.type === "multiple" && (
              <Form.Item label="Мінімум правильних відповідей">
                <InputNumber
                  min={1}
                  precision={0}
                  placeholder="Усі правильні"
                  value={question.min_correct}
                  onChange={(value) => set({ min_correct: value })}
                  style={{ width: 160 }}
                />
              </Form.Item>
            )}
          </>
        ) : (
          <>
            <Form.Item label="Початкове значення (показується користувачу)">
              <Input.TextArea
                className="code-editor"
                autoSize={{ minRows: 2 }}
                value={question.default_value}
                placeholder="Введіть початкове значення для відображення..."
                onChange={(event) => set({ default_value: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="Правильна відповідь (показується при помилці)">
              <Input.TextArea
                className="code-editor"
                autoSize={{ minRows: 2 }}
                value={question.correct_value}
                placeholder="Введіть правильну відповідь..."
                onChange={(event) => set({ correct_value: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="Перевірка (Python код)" extra="Порожньо: точний збіг з правильною відповіддю">
              <Flex vertical gap={8}>
                <Select
                  placeholder="-- Оберіть шаблон --"
                  value={null}
                  options={checkerTemplates.map((template) => ({ value: template.code, label: template.name }))}
                  onChange={(code: string) => set({ checker: code })}
                  notFoundContent="Шаблони не налаштовані"
                />
                <Input.TextArea
                  className="code-editor checker-input"
                  autoSize={{ minRows: 4 }}
                  value={question.checker}
                  spellCheck={false}
                  onChange={(event) => set({ checker: event.target.value })}
                />
              </Flex>
            </Form.Item>
          </>
        )}

        <Flex wrap gap={24} align="center">
          <Form.Item label="Бали за питання" style={{ marginBottom: 0 }}>
            <PointsInput value={question.points} onChange={(points) => set({ points })} />
          </Form.Item>
          <Checkbox
            checked={question.stick_to_the_previous}
            disabled={index === 0}
            onChange={(event) => set({ stick_to_the_previous: event.target.checked })}
          >
            Прив'язати до попереднього питання (при рандомізації)
          </Checkbox>
        </Flex>

        {errors.length > 0 && (
          <Typography.Text type="danger" style={{ display: "block", marginTop: 8 }} data-testid="question-errors">
            {errors.join("; ")}
          </Typography.Text>
        )}
      </Form>
    </Card>
  );
}
