;(() => {
  const mark = (k, v) => {
    try {
      document.documentElement.setAttribute('data-watis-' + k, String(v))
    } catch (e) {}
  }
  mark('main-early-ran', '1')
  // (a) Does the injected code itself run?  (b) Do its follow-on actions obey the page CSP?
  try {
    mark('main-eval', eval('40+2'))
  } catch (e) {
    mark('main-eval', 'THREW:' + e.name)
  }
  try {
    mark('main-fn', new Function('return 7*6')())
  } catch (e) {
    mark('main-fn', 'THREW:' + e.name)
  }
  try {
    const s = document.createElement('script')
    s.textContent = 'document.documentElement.setAttribute("data-watis-inline-tag","1")'
    document.documentElement.appendChild(s)
    s.remove()
    if (!document.documentElement.hasAttribute('data-watis-inline-tag'))
      mark('inline-tag', 'BLOCKED')
  } catch (e) {
    mark('inline-tag', 'THREW:' + e.name)
  }
  mark('main-sees-chrome-runtime', typeof chrome !== 'undefined' && !!(chrome && chrome.runtime))
  console.log('WATIS-MAIN-EARLY-OK')
})()
