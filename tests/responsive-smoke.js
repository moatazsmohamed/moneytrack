export async function runResponsiveSmoke() {
  const store = await import('/js/storage.js');
  const original = store.getState().prefs, results = [], errors = [];
  const wait = () => new Promise(r => setTimeout(r, 140));
  const check = (name, pass) => { results.push({ name, pass: !!pass }); if (!pass) throw new Error(name); };
  let frame;
  try {
    for (const [language, theme] of [['ar','dark'], ['en','light']]) {
      store.update(s => { s.prefs.language = language; s.prefs.theme = theme; });
      frame = document.createElement('iframe'); frame.style.cssText = 'position:fixed;top:0;left:0;width:375px;height:812px;border:0;z-index:9999;background:white';
      frame.src = '/?viewportTest=' + language + '-' + theme; document.body.append(frame);
      await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; }); await wait();
      const doc = frame.contentDocument, win = frame.contentWindow;
      check(language + ' mobile viewport is 375px', win.innerWidth === 375);
      check(language + ' direction and theme applied', doc.documentElement.dir === (language === 'ar' ? 'rtl' : 'ltr') && doc.documentElement.dataset.theme === theme);
      for (const route of ['dashboard','transactions','budgets','reports','categories','settings']) {
        win.location.hash = route; await wait();
        check(language + ' ' + route + ' has no horizontal document overflow', doc.documentElement.scrollWidth <= win.innerWidth);
        check(language + ' ' + route + ' has a real page heading', !!doc.querySelector('#main-content h1'));
      }
      const menu = doc.getElementById('mobile-menu'); menu.click(); await wait();
      check(language + ' mobile menu opens', doc.getElementById('sidebar').classList.contains('open') && menu.getAttribute('aria-expanded') === 'true');
      doc.querySelector('#main-nav a[href="#transactions"]').click(); await wait();
      check(language + ' mobile navigation changes page and closes menu', win.location.hash === '#transactions' && !doc.getElementById('sidebar').classList.contains('open'));
      frame.remove(); frame = null;
    }
  } catch (error) { errors.push(error.message); }
  finally { frame?.remove(); store.update(s => { s.prefs = original; }); }
  return { passed: results.filter(x => x.pass).length, failed: results.filter(x => !x.pass).length, errors, results };
}
