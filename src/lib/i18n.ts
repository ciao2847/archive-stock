import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const defaultResources = {
  "zh-TW": {
    translation: {
      app: {
        title: "庫藏 Archive",
        subtitle: "收藏品庫存管理",
      },
      common: {
        loading: "載入中…",
        error: "發生錯誤",
        save: "儲存",
        cancel: "取消",
        confirm: "確認",
        delete: "刪除",
        edit: "編輯",
      },
    },
  },
};

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: defaultResources,
    lng: "zh-TW",
    fallbackLng: "zh-TW",
    interpolation: {
      escapeValue: false,
    },
  });
}

export default i18n;
