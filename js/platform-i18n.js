import { publicExtraStrings } from './public-extra-strings.js';

const PREFS_KEY = 'moneytrack-public-prefs';
const DEFAULT_PREFS = Object.freeze({ language: 'ar', theme: 'light' });

const strings = {
  ar: {
    brandTagline: 'مساحة مالية أوضح', navHome: 'الرئيسية', navFeatures: 'المميزات', navHow: 'كيف تعمل', navAbout: 'عن المنصة', navContact: 'تواصل معنا', navLogin: 'تسجيل الدخول', navRegister: 'إنشاء حساب', navAdmin: 'الإدارة', languageEnglish: 'English', languageArabic: 'العربية', toggleTheme: 'تبديل المظهر', lightTheme: 'المظهر الفاتح', darkTheme: 'المظهر الداكن', skip: 'تخطي إلى المحتوى', menu: 'فتح القائمة', close: 'إغلاق', loading: 'جارٍ التحميل…', saving: 'جارٍ الحفظ…', errorGeneric: 'حدث خطأ غير متوقع. حاول مرة أخرى.', networkError: 'تعذر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.', required: 'هذا الحقل مطلوب.', invalidEmail: 'أدخل بريداً إلكترونياً صحيحاً.', passwordShort: 'يجب أن تتكون كلمة المرور من 12 حرفاً على الأقل.', passwordMismatch: 'كلمتا المرور غير متطابقتين.', consentRequired: 'الموافقة على الشروط والخصوصية مطلوبة.', contactSuccess: 'وصلت رسالتك إلى فريق المنصة.', emailUnavailable: 'إرسال البريد غير مُعد حالياً. تواصل مع إدارة المنصة بطريقة أخرى.', emailDeliveryFailed: 'تعذر تسليم البريد حالياً. لم نعرض رسالة نجاح.', sessionExpired: 'انتهت الجلسة. سجّل الدخول للمتابعة.', unauthorized: 'لا تملك صلاحية تنفيذ هذا الإجراء.', accountSuspended: 'هذا الحساب موقوف حالياً.', saved: 'تم الحفظ بنجاح.', deleted: 'تم الحذف.', published: 'تم النشر.', unpublished: 'تم إلغاء النشر.', confirmDelete: 'هل تريد حذف هذا العنصر؟ لا يمكن التراجع عن ذلك.', confirmSuspend: 'هل تريد تعليق هذا الحساب؟', confirmRestore: 'هل تريد إعادة تفعيل هذا الحساب؟', confirmAction: 'تأكيد الإجراء', cancel: 'إلغاء', confirm: 'تأكيد', previous: 'السابق', next: 'التالي', noResults: 'لا توجد نتائج.', empty: 'لا توجد بيانات بعد.', requiredField: 'مطلوب', account: 'الحساب', logout: 'تسجيل الخروج', profile: 'الملف الشخصي', changePassword: 'تغيير كلمة المرور', settings: 'الإعدادات', appearance: 'المظهر', theme: 'المظهر', language: 'اللغة', backHome: 'العودة للرئيسية', privacy: 'الخصوصية', terms: 'الشروط', contact: 'التواصل', copyright: 'MoneyTrack — مساحة مالية أوضح.', platformNotice: 'المحتوى المنشور من إدارة المنصة يظهر هنا بعد مراجعته.', noAnnouncements: 'لا توجد إعلانات منشورة حالياً.', noFaqs: 'لا توجد أسئلة منشورة حالياً.', serviceUnavailable: 'المحتوى المنشور غير متاح مؤقتاً.', admin: 'إدارة المنصة', overview: 'نظرة عامة', users: 'المستخدمون', content: 'المحتوى', messages: 'الرسائل', logs: 'السجلات', adminSettings: 'إعدادات المنصة', active: 'نشط', suspended: 'موقوف', all: 'الكل', search: 'بحث', save: 'حفظ', edit: 'تعديل', delete: 'حذف', create: 'إنشاء', publish: 'نشر', unpublish: 'إلغاء النشر', status: 'الحالة', role: 'الدور', permissions: 'الصلاحيات', actions: 'الإجراءات', totalUsers: 'إجمالي المستخدمين', activeUsers: 'المستخدمون النشطون', suspendedUsers: 'المستخدمون الموقوفون', newThisMonth: 'الجدد هذا الشهر', database: 'قاعدة البيانات', emailService: 'خدمة البريد', cron: 'الجدولة', configured: 'مُعد', notConfigured: 'غير مُعد', faq: 'سؤال شائع', announcement: 'إعلان', newContent: 'محتوى جديد', messageStatus: 'الحالة', read: 'مقروء', unread: 'جديد', page: 'صفحة', of: 'من', noPermission: 'لا تملك هذه الصلاحية.', user: 'مستخدم', adminRole: 'مدير', superAdmin: 'مدير أعلى', support: 'الدعم', platform: 'المنصة', profileSaved: 'تم تحديث الملف.', passwordChanged: 'تم تغيير كلمة المرور.', loggedOut: 'تم تسجيل الخروج.'
  },
  en: {
    brandTagline: 'A clearer financial space', navHome: 'Home', navFeatures: 'Features', navHow: 'How it works', navAbout: 'About', navContact: 'Contact', navLogin: 'Log in', navRegister: 'Create account', navAdmin: 'Admin', languageEnglish: 'English', languageArabic: 'العربية', toggleTheme: 'Toggle theme', lightTheme: 'Light theme', darkTheme: 'Dark theme', skip: 'Skip to content', menu: 'Open menu', close: 'Close', loading: 'Loading…', saving: 'Saving…', errorGeneric: 'Something went wrong. Please try again.', networkError: 'We could not reach the server. Check your connection and try again.', required: 'This field is required.', invalidEmail: 'Enter a valid email address.', passwordShort: 'Your password must be at least 12 characters.', passwordMismatch: 'Passwords do not match.', consentRequired: 'Accepting the terms and privacy notice is required.', contactSuccess: 'Your message was sent to the platform team.', emailUnavailable: 'Email delivery is not configured. Contact the platform team another way.', emailDeliveryFailed: 'Email delivery failed. No success message was shown.', sessionExpired: 'Your session expired. Log in to continue.', unauthorized: 'You are not allowed to perform this action.', accountSuspended: 'This account is currently suspended.', saved: 'Saved successfully.', deleted: 'Deleted.', published: 'Published.', unpublished: 'Publication removed.', confirmDelete: 'Delete this item? This cannot be undone.', confirmSuspend: 'Suspend this account?', confirmRestore: 'Restore this account?', confirmAction: 'Confirm action', cancel: 'Cancel', confirm: 'Confirm', previous: 'Previous', next: 'Next', noResults: 'No results found.', empty: 'Nothing here yet.', requiredField: 'Required', account: 'Account', logout: 'Log out', profile: 'Profile', changePassword: 'Change password', settings: 'Settings', appearance: 'Appearance', theme: 'Theme', language: 'Language', backHome: 'Back home', privacy: 'Privacy', terms: 'Terms', contact: 'Contact', copyright: 'MoneyTrack — A clearer financial space.', platformNotice: 'Published content from the platform team appears here after review.', noAnnouncements: 'There are no published announcements right now.', noFaqs: 'There are no published questions right now.', serviceUnavailable: 'Published content is temporarily unavailable.', admin: 'Platform administration', overview: 'Overview', users: 'Users', content: 'Content', messages: 'Messages', logs: 'Logs', adminSettings: 'Platform settings', active: 'Active', suspended: 'Suspended', all: 'All', search: 'Search', save: 'Save', edit: 'Edit', delete: 'Delete', create: 'Create', publish: 'Publish', unpublish: 'Unpublish', status: 'Status', role: 'Role', permissions: 'Permissions', actions: 'Actions', totalUsers: 'Total users', activeUsers: 'Active users', suspendedUsers: 'Suspended users', newThisMonth: 'New this month', database: 'Database', emailService: 'Email service', cron: 'Scheduler', configured: 'Configured', notConfigured: 'Not configured', faq: 'FAQ', announcement: 'Announcement', newContent: 'New content', messageStatus: 'Status', read: 'Read', unread: 'New', page: 'Page', of: 'of', noPermission: 'You do not have this permission.', user: 'User', adminRole: 'Admin', superAdmin: 'Super admin', support: 'Support', platform: 'Platform', profileSaved: 'Profile updated.', passwordChanged: 'Password changed.', loggedOut: 'You are logged out.'
  }
};

Object.assign(strings.ar, { loginTitle:'تسجيل الدخول', loginIntro:'تابع مساحتك المالية من أي جهاز.', email:'البريد الإلكتروني', password:'كلمة المرور', remember:'تذكرني', forgot:'نسيت كلمة المرور؟', noAccount:'ليس لديك حساب؟', register:'إنشاء حساب', registerTitle:'أنشئ حسابك', registerIntro:'ابدأ مساحة مالية أوضح ببياناتك الفعلية.', fullName:'الاسم الكامل', confirmPassword:'تأكيد كلمة المرور', accept:'أوافق على', termsAndPrivacy:'الشروط والخصوصية', haveAccount:'لديك حساب بالفعل؟', forgotTitle:'استعادة كلمة المرور', forgotIntro:'أدخل بريدك وسنوضح لك الخطوة التالية إذا كانت الخدمة مهيأة.', sendReset:'إرسال التعليمات', backLogin:'العودة لتسجيل الدخول', resetTitle:'تعيين كلمة مرور جديدة', resetIntro:'اختر كلمة مرور جديدة لحسابك.', resetPassword:'كلمة المرور الجديدة', token:'رمز الاستعادة', verifyTitle:'تحقق من بريدك', verifyIntro:'استخدم الرابط الذي وصلك عبر البريد لإكمال التحقق.', verify:'تحقق من البريد', resendTitle:'إعادة إرسال التحقق', resendIntro:'أدخل بريد الحساب لطلب رسالة تحقق جديدة.', resend:'إعادة الإرسال', noToken:'لا يوجد رمز في الرابط.' });
Object.assign(strings.en, { loginTitle:'Log in', loginIntro:'Continue to your financial space from any device.', email:'Email address', password:'Password', remember:'Remember me', forgot:'Forgot your password?', noAccount:'Don’t have an account?', register:'Create account', registerTitle:'Create your account', registerIntro:'Start a clearer financial space with your real records.', fullName:'Full name', confirmPassword:'Confirm password', accept:'I accept the', termsAndPrivacy:'terms and privacy notice', haveAccount:'Already have an account?', forgotTitle:'Recover your password', forgotIntro:'Enter your email and we will explain the next step if email is configured.', sendReset:'Send instructions', backLogin:'Back to log in', resetTitle:'Set a new password', resetIntro:'Choose a new password for your account.', resetPassword:'New password', token:'Recovery token', verifyTitle:'Verify your email', verifyIntro:'Use the link sent to your email to finish verification.', verify:'Verify email', resendTitle:'Resend verification', resendIntro:'Enter the account email to request a new verification message.', resend:'Resend message', noToken:'No token was found in the link.' });


for (const [key, value] of Object.entries(publicExtraStrings)) {
  strings.ar[key] = value.ar;
  strings.en[key] = value.en;
}

function currentPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...DEFAULT_PREFS, ...parsed, language: parsed.language === 'en' ? 'en' : 'ar', theme: parsed.theme === 'dark' ? 'dark' : 'light' };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function getPublicPrefs() { return currentPrefs(); }

export function setPublicPrefs(partial = {}) {
  const next = { ...currentPrefs(), ...partial };
  next.language = next.language === 'en' ? 'en' : 'ar';
  next.theme = next.theme === 'dark' ? 'dark' : 'light';
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* appearance is best effort */ }
  applyPublicPrefs();
  return next;
}

export function pt(key, params = {}) {
  const lang = currentPrefs().language;
  let value = strings[lang]?.[key] ?? strings.en[key] ?? key;
  return String(value).replace(/\{([\w.-]+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}

export function applyPublicPrefs() {
  if (typeof document === 'undefined') return currentPrefs();
  const prefs = currentPrefs();
  const root = document.documentElement;
  root.lang = prefs.language;
  root.dir = prefs.language === 'ar' ? 'rtl' : 'ltr';
  root.dataset.language = prefs.language;
  root.dataset.theme = prefs.theme;
  document.body?.setAttribute('dir', root.dir);
  document.body?.setAttribute('data-theme', prefs.theme);
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = pt(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((node) => node.setAttribute('aria-label', pt(node.dataset.i18nAria)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => node.setAttribute('placeholder', pt(node.dataset.i18nPlaceholder)));
  const langToggle = document.querySelector('[data-action="language"]');
  if (langToggle) { langToggle.textContent = prefs.language === 'ar' ? 'English' : 'العربية'; langToggle.setAttribute('aria-label', prefs.language === 'ar' ? pt('languageEnglish') : pt('languageArabic')); }
  const themeToggle = document.querySelector('[data-action="theme"]');
  if (themeToggle) themeToggle.setAttribute('aria-label', prefs.theme === 'dark' ? pt('lightTheme') : pt('darkTheme'));
  return prefs;
}

export function pEscape(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function pIcon(name, label = '') {
  const safe = String(name || 'circle').replace(/[^a-zA-Z0-9:_-]/g, '') || 'circle';
  const hidden = label ? '' : ' aria-hidden="true"';
  return `<i data-lucide="${safe}"${hidden}${label ? ` aria-label="${pEscape(label)}"` : ''}></i>`;
}

export function pIcons(root = typeof document !== 'undefined' ? document : null) {
  const lucide = globalThis.lucide || globalThis.Lucide;
  if (lucide?.createIcons && root) { try { lucide.createIcons({ root }); } catch { try { lucide.createIcons(); } catch { /* optional local vendor */ } } }
}

export { strings };
