# הקמת תיק צ׳יק כאתר – מדריך צעד אחר צעד

האתר מורכב משלושה חלקים חינמיים ומפתח אחד בתשלום לפי שימוש:

| חלק | מה הוא עושה | עלות |
|---|---|---|
| **Firebase** (גוגל) | כניסה עם חשבון Google, ומסד הנתונים של התיק | 0 ₪ (תוכנית Spark, בלי כרטיס אשראי) |
| **GitHub** | שומר את הקוד, ומריץ את המשימות: מחירים כל שעה, סגירת היום, הודעת הבוקר, דוחות | 0 ₪ (מאגר פרטי) |
| **Cloudflare Pages** | מארח את האתר ואת שתי הפונקציות: צ׳יקו ורענון מחירים | 0 ₪ |
| **Anthropic API** | צ׳יקו וקריאת דוחות הברוקר (המודלים של Claude) | לפי שימוש, בערך 10–40 ₪ בחודש |

סדר העבודה: Firebase ← GitHub ← Cloudflare ← מפתח Anthropic ← הגדרות ← ייבוא הנתונים. כשעה בסך הכול. מה שמסומן **[העתק]** הוא ערך שתצטרך להדביק בשלב מאוחר יותר; מומלץ לפתוח קובץ טקסט ולאסוף בו את הערכים תוך כדי.

> כלל ברזל: סיסמאות ומפתחות נכנסים רק למקומות שמסומנים כאן כ"Secret". אף פעם לא לקובץ בקוד, לא ל-config.js ולא לצ׳אט.

---

## א. Firebase (כניסה ומסד נתונים)

1. היכנס ל-https://console.firebase.google.com עם חשבון Google שלך ולחץ **Create a project** (או "Add project").
   שם הפרויקט: `tik-chik` (או כל שם). Google Analytics – אפשר לכבות. **Create project**.
2. **Authentication** (בתפריט "Build") ← **Get started** ← לשונית **Sign-in method**:
   - **Google** ← Enable ← בחר "support email" ← Save.
   - **Email/Password** ← Enable (רק "Email/Password", לא "Email link") ← Save.
3. **Authentication ← Users ← Add user**: זה "משתמש הבוט" שהמשימות המתוזמנות נכנסות בשמו.
   - Email: `bot@tik-chik.app` (לא צריך להיות תיבת מייל אמיתית) **[העתק: BOT_EMAIL]**
   - Password: סיסמה ארוכה ואקראית (20 תווים ומעלה) **[העתק: BOT_PASSWORD]**
4. **Firestore Database** ← **Create database** ← מיקום: `me-west1 (Tel Aviv)` (או `eur3`) ← **Production mode** ← Create.
5. **Firestore ← Rules**: מחק את מה שיש, הדבק את התוכן של הקובץ `firebase/firestore.rules`, ו**שנה את שתי השורות הראשונות** בתוך הכללים:
   - `ownerEmail()` – כתובת ה-Gmail שלך, באותיות קטנות.
   - `botEmail()` – הכתובת מצעד 3.
   לחץ **Publish**.
6. **Project settings** (גלגל השיניים ליד "Project Overview") ← לשונית **General** ← גלול ל-"Your apps" ← לחץ על סמל ה-Web `</>`:
   - App nickname: `site` ← (בלי Firebase Hosting) ← **Register app**.
   - במסך הקוד מופיע `firebaseConfig`. העתק: `apiKey` **[FIREBASE_API_KEY]**, `authDomain`, `projectId` **[FIREBASE_PROJECT_ID]**, `appId`.
   (המפתח הזה ציבורי בכוונה – הוא מזהה את הפרויקט, לא פותח אותו. מה שמגן על הנתונים הם הכללים מצעד 5.)
7. נחזור לכאן בשלב ג׳ (להוסיף את כתובת האתר ל-**Authorized domains**).

## ב. GitHub (הקוד והמשימות המתוזמנות)

1. אם אין לך חשבון: https://github.com ← Sign up (חינם).
2. **New repository**: שם `tik-chik`, **Private**, בלי README ← Create repository.
3. להעלות את הקוד – אחת משתי הדרכים:
   - **דרך Claude**: ב-claude.ai ← הגדרות ← Connectors ← חבר את GitHub (עם הרשאה למאגר `tik-chik`). אחר כך כתוב לי "המאגר מוכן" ואני דוחף את הקוד.
   - **ידנית**: פתח את קובץ ה-zip שקיבלת. בדף המאגר ← **Add file ← Upload files** ← גרור את כל התיקיות והקבצים (כולל התיקייה `.github`) ← Commit changes.
4. **Settings ← Secrets and variables ← Actions ← New repository secret**, אחד-אחד (השם בדיוק כך):

   | Name | Value |
   |---|---|
   | `FIREBASE_PROJECT_ID` | מצעד א6 |
   | `FIREBASE_API_KEY` | מצעד א6 |
   | `BOT_EMAIL` | מצעד א3 |
   | `BOT_PASSWORD` | מצעד א3 |
   | `OWNER_EMAIL` | ה-Gmail שלך |
   | `MAIL_USER` | ה-Gmail שממנו יישלחו הודעת הבוקר והדוחות (בדרך כלל אותו חשבון) |
   | `MAIL_PASS` | "סיסמת אפליקציה" של Gmail – ראה צעד 5 |
   | `MAIL_TO` | למי לשלוח, מופרד בפסיקים (`you@gmail.com, partner@gmail.com`) |
   | `SITE_URL` | כתובת האתר, אחרי שלב ג׳ (`https://tik-chik.pages.dev`) |

5. סיסמת אפליקציה ל-Gmail: https://myaccount.google.com/security ← ודא ש-**2-Step Verification** פעיל ← חפש **App passwords** ← שם: `tik-chik` ← Create ← העתק את 16 התווים (בלי רווחים) ל-`MAIL_PASS`.
6. לשונית **Actions** במאגר ← אם מוצע, לחץ "I understand my workflows, go ahead and enable them".
   המשימות רצות לבד לפי לוח הזמנים. אפשר להריץ ידנית: Actions ← בחר משימה ← **Run workflow**.

## ג. Cloudflare Pages (האתר עצמו)

1. https://dash.cloudflare.com ← Sign up (חינם, בלי כרטיס).
2. **Workers & Pages ← Create ← Pages ← Connect to Git** ← אשר את החיבור ל-GitHub ובחר את `tik-chik` ← **Begin setup**:
   - Project name: `tik-chik` (זה יהיה חלק מהכתובת: `tik-chik.pages.dev`)
   - Framework preset: **None**
   - Build command: `python3 tools/build.py page/live.html`
   - Build output directory: `site`
   - **Save and Deploy**.
3. אחרי הפריסה הראשונה: **Settings ← Variables and Secrets** (Production) ← Add:

   | Type | Name | Value |
   |---|---|---|
   | Text | `FIREBASE_PROJECT_ID` | מצעד א6 |
   | Text | `FIREBASE_API_KEY` | מצעד א6 |
   | Text | `OWNER_EMAIL` | ה-Gmail שלך |
   | **Secret** | `BOT_EMAIL` | מצעד א3 |
   | **Secret** | `BOT_PASSWORD` | מצעד א3 |
   | **Secret** | `ANTHROPIC_API_KEY` | משלב ד׳ |

   ואז **Deployments ← ⋯ ← Retry deployment**, כדי שהפונקציות יקבלו את הערכים.
4. הכתובת שקיבלת (`https://tik-chik.pages.dev`):
   - ב-Firebase: **Authentication ← Settings ← Authorized domains ← Add domain** ← `tik-chik.pages.dev`.
   - ב-GitHub: ה-secret `SITE_URL`.

## ד. מפתח Anthropic (צ׳יקו)

1. https://console.anthropic.com ← Sign up ← **Billing** ← טען סכום קטן (למשל 10 דולר; החיוב לפי שימוש).
   מומלץ: **Limits** ← קבע תקרה חודשית (למשל 15 דולר) כדי שלא תהיה הפתעה.
2. **API Keys ← Create Key** ← שם `tik-chik` ← העתק את המפתח (מוצג פעם אחת) ← ל-Cloudflare כ-Secret בשם `ANTHROPIC_API_KEY` (שלב ג3).
3. לפי תנאי ה-API של Anthropic, מה שנשלח דרך ה-API לא משמש לאימון המודלים.

## ה. הגדרות האתר (config.js)

במאגר ב-GitHub: `site/config.example.js` ← לחץ עליו ← **Copy raw** ← צור קובץ חדש `site/config.js` (Add file ← Create new file) והדבק. מלא:

- `firebase.apiKey`, `authDomain`, `projectId`, `appId` – מצעד א6.
- `ownerEmail` – ה-Gmail שלך.
- `models` – אפשר להשאיר.

**Commit**. Cloudflare פורס מחדש לבד תוך דקה.

## ו. הפעלה ראשונה וייבוא הנתונים

1. פתח את `https://tik-chik.pages.dev` ← **כניסה עם Google** ← הדף נפתח ריק (עוד אין נתונים).
2. ייבוא מהגרסה ב-Claude: פתח `https://tik-chik.pages.dev/import.html` ← היכנס ← בחר את קובץ הייצוא (`tikchik-export-<תאריך>.json`, שאני מכין לך מהגרסה ב-Claude) ← **ייבוא**. אחרי דקה: "הייבוא הסתיים".
3. פתח שוב את הדף הראשי: התיק, ההיסטוריה, הדוחות השמורים וההגדרות אמורים להופיע כמו ב-Claude.
4. **Firebase ← Authentication ← Users**: תראה את עצמך; העתק את ה-**User UID** ל-GitHub כ-secret `OWNER_UID` (לא חובה, אבל מדויק יותר למשימות).
5. בדיקה של המשימות: GitHub ← Actions ← "מחירים כל שעה" ← **Run workflow**. אחרי כדקה הריצה ירוקה, ובדף המחירים מתעדכנים. אם היא אדומה – פתח אותה וקרא את השורה האדומה; בדרך כלל זה secret חסר או שגוי.
6. צ׳יקו: לחץ "נתח לי את התיק". אם מופיעה שגיאה – בדוק את `ANTHROPIC_API_KEY` ואת היתרה ב-Billing.

## ז. להזמין שותפים

כל מי שמוזמן נכנס עם Google שלו ורואה **רק את התיק של עצמו**; הוא לא רואה את שלך ואתה לא את שלו.

Firebase ← **Firestore Database** ← **Start collection** (או "+ Add collection"): Collection ID `invites` ← Document ID: כתובת ה-Gmail של השותף **באותיות קטנות** ← שדה: `at` (string) עם התאריך ← Save.
להסרה: מחיקת המסמך. (בגרסה הבאה של הדף זה ייעשה ממסך ההגדרות.)

## ח. מה רץ מתי (שעון ישראל)

| משימה | מתי | מה |
|---|---|---|
| מחירים | ב׳–ו׳, כל שעה 10:40–23:40 | Yahoo Finance (ארה״ב ות״א) + שער בנק ישראל ← `quotes/latest` |
| סגירת היום | ב׳–ו׳ 23:50 | נקודת היום בגרף, סדרות סגירה לניירות במעקב, תמונת שוק ארה״ב לחיפוש |
| הודעת הבוקר | כל יום 07:50 | מנוע ההתראות של הדף; במייל רק מה שחדש |
| סוף חודש | ה-1 בחודש 08:50 | שורת החודש בהיסטוריה + דוח חודשי במייל (PDF) |
| דוח שבועי | שישי 13:50 | PDF במייל ובארכיון |
| רבעוני / חצי שנתי / שנתי | 1 בינואר, אפריל, יולי, אוקטובר 09:25 | כנ״ל |

GitHub מפעיל משימות מתוזמנות באיחור של עד כ-15 דקות בשעות עמוסות. כל המשימות יחד: כ-500 דקות ריצה בחודש, מתוך 2,000 חינם למאגר פרטי. "לעדכן מחירים עכשיו" בדף עובד תמיד (דרך הפונקציה של Cloudflare).

## ט. אם משהו לא עובד

- **"החשבון לא מוזמן"** – הכתובת לא ב-`invites`, או שה-`ownerEmail` ב-config.js לא זהה ל-Gmail (אותיות קטנות).
- **חלון הכניסה לא נפתח** – הדפדפן חוסם חלונות קופצים; אפשר לאשר לאתר. בטלפון עדיף Chrome/Safari רגיל ולא דפדפן בתוך אפליקציה.
- **"Missing or insufficient permissions"** – הכללים ב-Firestore לא פורסמו, או שהאימיילים בהם לא נכונים.
- **המחירים לא מתעדכנים** – GitHub ← Actions ← הריצה האחרונה. שגיאת `sign-in failed` = הבוט (BOT_EMAIL/BOT_PASSWORD) או ש-Email/Password לא הופעל ב-Authentication.
- **הקרנות הישראליות (TA125, TA90)** – מתומחרות לפי המדד שלהן (מסומן "לפי מדד ת״א 125") עד שיוגדר מקור ישיר. לקבוע מקור: במסמך `settings/main` ב-Firestore, שדה `symMap` עם סימול Yahoo של הקרן עצמה (למשל `{"TA125":"<מספר נייר>.TA"}`); אם תשלח לי את מספרי הניירות של הקרנות, אני אבדוק מה Yahoo מכיר.
- **צ׳יקו "לא זמין"** – `ANTHROPIC_API_KEY` חסר ב-Cloudflare, או שאין יתרה ב-Anthropic.
- **הודעת הבוקר לא מגיעה** – `MAIL_PASS` חייב להיות סיסמת אפליקציה (לא הסיסמה הרגילה), ו-2-Step Verification פעיל.
