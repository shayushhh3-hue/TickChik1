# תיק צ׳יק – חדר המסחר שלי

הדף שנבנה ב-Claude, כאתר עצמאי על שרת אחד (Railway). הדף עצמו (`page/live.html`) לא השתנה; השרת נותן לו מסד נתונים, כניסה במייל וסיסמה, את צ׳יקו, עדכון מחירים ומשימות מתוזמנות.

- **`server/`** – השרת (Express + SQLite): `index.js` (כניסה, מסמכים, עדכונים חיים, צ׳יקו, מחירים), `store.js` (מסד הנתונים והרשאות: מי רואה מה), `jobs.js` + `tasks.js` (המשימות לפי שעון ישראל), `headless.js` (מריץ את הדף בלי מסך לדוחות ולהתראות), `mail.js`.
- **`site/`** – מה שהדפדפן מקבל: `index.html` (נבנה מהדף ב-`tools/build.js`), `runtime.js` (מחבר את הדף לשרת), `users.html` (שותפים), `import.html` (ייבוא וגיבוי).
- **`shared/`** – מחירים (`quotes.js`: Yahoo Finance, Stooq, בנק ישראל), שעות מסחר (`market.js`).
- **`SETUP.md`** – ההקמה ב-Railway, צעד אחר צעד.

פיתוח: `npm install` ← `npm run build` ← `npm test` ← `DATA_DIR=./data OWNER_EMAIL=… OWNER_PASSWORD=… npm start`.

לא ייעוץ השקעות: הדף מציג עובדות, מספרים ודירוג התאמה, בלי המלצות קנייה או מכירה.
