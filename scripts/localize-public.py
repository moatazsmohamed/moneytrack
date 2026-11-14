"""Attach bilingual keys to the remaining static public-page text; no frontend framework needed."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent.parent
PAIRS = [
    ('تسجيل الدخول — MoneyTrack', 'Log in — MoneyTrack'),
    ('بيانات حسابك لا تظهر في الصفحات العامة.', 'Your account data never appears on public pages.'),
    ('إنشاء حساب — MoneyTrack', 'Create account — MoneyTrack'),
    ('لا تختار دوراً إدارياً؛ الحسابات العامة تبدأ كمستخدمين فقط.', 'Public accounts start as users only. Administrative roles cannot be chosen at signup.'),
    ('12 حرفاً على الأقل.', 'At least 12 characters.'),
    ('استعادة كلمة المرور — MoneyTrack', 'Recover password — MoneyTrack'),
    ('تعيين كلمة المرور — MoneyTrack', 'Set password — MoneyTrack'),
    ('تحقق من البريد — MoneyTrack', 'Verify email — MoneyTrack'),
    ('إعادة إرسال رسالة التحقق', 'Resend verification email'),
    ('إعادة إرسال التحقق — MoneyTrack', 'Resend verification — MoneyTrack'),
    ('الخصوصية — MoneyTrack', 'Privacy — MoneyTrack'),
    ('سياسة الخصوصية', 'Privacy policy'),
    ('تشرح هذه الصفحة، بلغة واضحة، ما يلزم لتشغيل الحساب وكيف نتعامل مع البيانات التي تدخلها.', 'This page explains what is needed to operate your account and how the data you enter is handled.'),
    ('بيانات الحساب', 'Account data'),
    ('نحتاج إلى الاسم الكامل والبريد الإلكتروني وكلمة المرور لإنشاء الحساب وتسجيل الدخول وإدارة الجلسة والتحقق من البريد. تُخزّن كلمة المرور بصيغة تجزئة خادمية، ولا تُحفظ كلمات المرور أو رموز الجلسة في LocalStorage.', 'Your full name, email and password are needed to create an account, log in, manage sessions and verify email. Passwords are hashed on the server. Passwords and session tokens are not stored in LocalStorage.'),
    ('بياناتك المالية', 'Your financial data'),
    ('المعاملات والفئات والميزانيات والأهداف والقواعد الدورية والإشعارات التي تدخلها مرتبطة بحسابك في قاعدة بيانات الخادم. يحصر الخادم كل استعلام بمالك الحساب. لوحة الإدارة لا تتضمن تصفح المعاملات المالية الفردية ضمن وظائفها المعتادة.', 'Your transactions, categories, budgets, goals, recurring rules and notifications belong to your account in the server database. Queries are scoped to the account owner. Routine administration does not include browsing individual financial transactions.'),
    ('التخزين المحلي القديم', 'Legacy local storage'),
    ('قد تكون نسخة قديمة من MoneyTrack قد خزنت بيانات على جهازك. لا تُقرأ هذه البيانات أو تُستورد تلقائياً بعد تسجيل الدخول. إذا اخترت الترحيل، يعرض التطبيق مراجعة ونسخة احتياطية ويطلب موافقتك، ولا يحذف النسخة المحلية بصمت.', 'An older version may have stored data on your device. It is not automatically imported into your account. If you choose migration, you receive a review and backup and must approve it. The local copy is not silently deleted.'),
    ('الإدارة والحماية', 'Administration and security'),
    ('تتحقق الخوادم من الجلسة والحالة والدور والصلاحيات وتحمي طلبات التغيير من CSRF. تُسجّل الأحداث الإدارية والأمنية ببيانات تشغيلية محدودة، ولا نضع كلمات مرور أو توكنات أو تفاصيل معاملات في السجلات.', 'The server checks session, status, role and permissions and protects changes against CSRF. Administrative and security events use limited operational data. Passwords, tokens and financial transaction details are not added to logs.'),
    ('رسائل التواصل', 'Contact messages'),
    ('يحفظ نموذج التواصل الاسم والبريد والرسالة وحالتها حتى تتمكن إدارة المنصة من متابعة الطلب. لا يظهر بريد أدمن أو عنوان دعم غير معلن تلقائياً في الصفحة.', 'The contact form stores your name, email, message and its status so the platform team can follow up. An unannounced administrator or support address is not automatically published.'),
    ('الحذف', 'Deletion'),
    ('يمكنك طلب حذف حسابك من إعداداته بعد تأكيد كلمة المرور. يطبق الخادم قيود الحذف الخاصة بالحسابات الإدارية، ولا نعد بحذف سجلات يلزم الاحتفاظ بها لأسباب تشغيلية أو أمنية إن وجدت.', 'You can delete your account from settings after confirming your password. Administrative-account restrictions apply. Operational or security records may be retained when necessary.'),
    ('الشروط', 'Terms'),
    ('التواصل', 'Contact'),
    ('الشروط — MoneyTrack', 'Terms — MoneyTrack'),
    ('شروط الاستخدام', 'Terms of use'),
    ('باستخدام MoneyTrack، تقر بقراءة هذه الشروط وفهم أن المنصة أداة تنظيم وتتبّع وليست بنكاً أو مستشاراً مالياً.', 'By using MoneyTrack you acknowledge these terms and understand that it is an organization and tracking tool, not a bank or financial adviser.'),
    ('الحساب', 'Account'),
    ('تقدم بيانات صحيحة وتحافظ على سرية كلمة المرور. الحسابات العامة تنشأ بدور مستخدم فقط. الحساب الإداري منفصل ويُنشأ من إعداد خادمي، ولا يمكن اختياره من التسجيل العام.', 'Provide accurate information and keep your password private. Public accounts receive the user role only. Administrative accounts are created separately through controlled server setup, not public signup.'),
    ('طبيعة الخدمة', 'Nature of the service'),
    ('تساعدك المنصة على تسجيل الدخل والمصروفات والميزانيات والأهداف والتقارير. القواعد الدورية تتابع استحقاقات مسجلة ولا تنفذ دفعاً بنكياً أو تحويلاً فعلياً. لا تمثل التقارير أو الرسوم نصيحة مالية أو ضماناً لنتيجة.', 'The platform helps record income, expenses, budgets, goals and reports. Recurring rules track recorded due dates; they do not execute bank payments or transfers. Reports and charts are not financial advice or guarantees.'),
    ('تستخدم البيانات التي تدخلها لتقديم ميزات الحساب. لا تحاول الوصول إلى حساب أو بيانات مستخدم آخر، ولا تستخدم الواجهات بطرق تتجاوز الصلاحيات الخادمية. تُخضع الكتابات والحذف للتأكد والصلاحيات.', 'Your entered data is used to provide account features. Do not access another account or bypass server permissions. Changes and deletion are subject to validation, authorization and confirmation.'),
    ('البريد والتحقق', 'Email and verification'),
    ('بعض التدفقات تحتاج خدمة بريد مهيأة، مثل التحقق وإعادة تعيين كلمة المرور وتغيير البريد. إذا لم تكن الخدمة متاحة، نوضح ذلك ولا ندعي أن رسالة أُرسلت.', 'Verification, password recovery and email changes require a configured email service. If it is unavailable, the interface says so and does not claim a message was sent.'),
    ('التغييرات والإيقاف', 'Changes and suspension'),
    ('قد تتغير الميزات أو تتوقف مؤقتاً لأسباب تشغيلية. يمكن تعليق الحسابات عند مخالفة هذه الشروط أو لأسباب حماية، وتبقى حالة الجلسة خاضعة للتحقق الخادمي.', 'Features may change or be temporarily unavailable for operational reasons. Accounts may be suspended for violations or security. Session status remains subject to server validation.'),
    ('الحذف والدعم', 'Deletion and support'),
    ('نموذج التواصل', 'Contact form'),
    ('الخصوصية', 'Privacy'),
    ('تواصل معنا — MoneyTrack', 'Contact — MoneyTrack'),
    ('تواصل مع إدارة المنصة', 'Contact the platform team'),
    ('استخدم النموذج لإرسال سؤال أو ملاحظة. لا تضع كلمة مرور أو رمز تحقق أو تفاصيل مالية حساسة في الرسالة.', 'Send a question or feedback using the form. Do not include passwords, verification codes or sensitive financial details.'),
    ('الاسم الكامل', 'Full name'),
    ('البريد الإلكتروني', 'Email address'),
    ('الرسالة', 'Message'),
    ('إرسال الرسالة', 'Send message'),
    ('‹ العودة للرئيسية', '‹ Back home'),
    ('إدارة المنصة — MoneyTrack', 'Platform administration — MoneyTrack'),
    ('جارٍ التحقق…', 'Checking your session…'),
]
entries = {f'publicExtra{i:02}': {'ar': ar, 'en': en} for i, (ar, en) in enumerate(PAIRS)}
by_ar = {entry['ar']: key for key, entry in entries.items()}
pattern = re.compile(r'<(title|p|h1|h2|h3|label|button|a|span|small|li|strong)(\s[^>]*)?>([^<>]+)</\1>')
for path in (ROOT / 'public').glob('*.html'):
    def bind(match):
        tag, attrs, text = match.group(1), match.group(2) or '', match.group(3)
        key = by_ar.get(text.strip())
        if not key or 'data-i18n=' in attrs:
            return match.group(0)
        return f'<{tag}{attrs} data-i18n="{key}">{text}</{tag}>'
    before = path.read_text()
    after = pattern.sub(bind, before)
    if after != before:
        path.write_text(after.rstrip() + '\n')
(ROOT / 'js/public-extra-strings.js').write_text('export const publicExtraStrings = ' + json.dumps(entries, ensure_ascii=False, indent=2) + ';\n')
print(f'Bound {len(entries)} remaining bilingual public strings.')
