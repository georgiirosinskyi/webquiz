// Texts of the admin pages (admin app, files, settings, live stats) in the
// language of the `language` config option, which the server sends with every page.
import { en } from "./i18n/en";
import { uk, type MessageKey } from "./i18n/uk";
import { getServerData, type ServerData } from "./serverData";

export type { MessageKey };
type Language = ServerData["language"];

const MESSAGES: Record<Language, Record<MessageKey, string>> = { uk, en };
// Plural forms in the "plural.*" texts are separated by "|", in this order
const PLURAL_CATEGORIES: Record<Language, Intl.LDMLPluralRule[]> = {
  uk: ["one", "few", "many", "other"],
  en: ["one", "other"],
};

let language: Language = getServerData().language;

export const getLanguage = () => language;

// Tests only: the page language comes from the server
export function setLanguage(next: Language) {
  language = next;
}

type Params = Record<string, string | number>;

const fill = (text: string, params?: Params) =>
  params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text;

export function t(key: MessageKey, params?: Params): string {
  return fill(MESSAGES[language][key], params);
}

// "{n} питання|{n} питання|{n} питань|{n} питання" -> the form for `count`
export function tn(key: MessageKey, count: number, params?: Params): string {
  const forms = MESSAGES[language][key].split("|");
  const category = new Intl.PluralRules(language).select(count);
  const index = Math.max(0, PLURAL_CATEGORIES[language].indexOf(category));
  return fill(forms[index] ?? forms[forms.length - 1], { n: count, ...params });
}
