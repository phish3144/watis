chrome.runtime.sendMessage({ probe: true }, (r) => {
  document.documentElement.setAttribute('data-coi', JSON.stringify(r || { err: String(chrome.runtime.lastError) }));
});
