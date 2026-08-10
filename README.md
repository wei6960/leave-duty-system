# 金牌躍騰教育集團班務行政考核系統

靜態網頁版班務行政考核系統，可部署到 GitHub Pages。

## 登入

- 分校：平鎮、平興、東興
- 預設密碼：90757744

## 同步設定

系統已支援 Firebase Firestore 即時同步。請在 `firebase-config.js` 填入 Firebase Web App 設定。

Firebase Console 路徑：

1. Project settings
2. Your apps
3. Web app
4. SDK setup and configuration

Firestore 資料位置：

```text
leave-duty-system/{分校名稱}
```

未填 Firebase 設定時，系統會自動使用瀏覽器本機儲存。
