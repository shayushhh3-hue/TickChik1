# תיק צ׳יק – חדר המסחר שלי

האתר של "תיק צ׳יק": הדף שנבנה ב-Claude, כאתר עצמאי. הדף עצמו (`page/live.html`) לא השתנה; האתר נותן לו כניסה עם Google, מסד נתונים, את צ׳יקו דרך שרת, ואת המשימות המתוזמנות.

- **`site/`** – מה ש-Cloudflare Pages מגיש: `index.html` (נבנה מהדף ב-`tools/build.py` בזמן הפריסה), `runtime.js` (המתאם ל-Firebase ולפונקציות), `config.js` (ההגדרות שלך; מתחילים מ-`config.example.js`), `import.html` (ייבוא חד-פעמי מהגרסה ב-Claude).
- **`functions/api/`** – הפונקציות: `ask.js` (צ׳יקו: מוסיף את מפתח Claude ובודק שהמשתמש מוזמן), `prices.js` (רענון מחירים לפי דרישה).
- **`jobs/`** – המשימות המתוזמנות (GitHub Actions): `prices.js` כל שעה, `nightly.js` סגירת היום, `morning.js` הודעת הבוקר, `monthly.js` סוף חודש, `report.js` דוחות.
- **`shared/`** – קוד משותף: קידוד המסמכים (`docenc.js`), Firestore דרך REST (`fsrest.js`), מחירים (`quotes.js`), שעות מסחר (`market.js`).
- **`firebase/firestore.rules`** – מי רואה מה.
- **`SETUP.md`** – מדריך ההקמה, צעד אחר צעד.

פיתוח: `npm install` ← `python3 tools/build.py page/live.html` ← `npm test` (בדיקות יחידה; בדיקות הדף והמשימות רצות עם Playwright ונתוני דוגמה).

לא ייעוץ השקעות: הדף מציג עובדות, מספרים ודירוג התאמה, בלי המלצות קנייה או מכירה.
