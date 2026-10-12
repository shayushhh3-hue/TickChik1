// תיק צ׳יק – הגדרות האתר. העתק את הקובץ הזה ל-config.js ומלא את הפרטים מ-Firebase.
// כל מה שכאן ציבורי בכוונה (זה מה שהדפדפן צריך); המפתח של Claude לא נמצא כאן אלא רק בשרת.
window.TC_CONFIG={
  firebase:{
    apiKey:"",            // Firebase console › Project settings › Your apps › Web app › apiKey
    authDomain:"",        // <project-id>.firebaseapp.com
    projectId:"",         // <project-id>
    appId:""              // 1:...:web:...
  },
  ownerEmail:"",          // כתובת ה-Gmail של בעל הדף (רק הוא רואה את התיק הראשי ומנהל את המוזמנים)
  api:"/api",             // הפונקציות של האתר (באותו דומיין)
  models:{                // המודלים של Claude לכל רמת מהירות
    quick:"claude-haiku-5-5",
    default:"claude-sonnet-5-5",
    complex:"claude-sonnet-5-5"
  }
};
