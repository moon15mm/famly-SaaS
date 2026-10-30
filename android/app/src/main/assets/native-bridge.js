(() => {
  if (window !== window.top || window.__minBuyutnaBridgeInstalled) return;
  window.__minBuyutnaBridgeInstalled = true;
  let port = null;
  let busy = false;
  const blobs = new Map();
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    const url = create(blob);
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    blobs.delete(url);
    revoke(url);
  };
  window.addEventListener("message", (event) => {
    // Native postWebMessage targets this exact origin. Reject messages from other windows/frames.
    if (event.source && event.source !== window) return;
    if (event.data !== "min-buyutna-native" || event.ports.length !== 1) return;
    if (port) port.close();
    port = event.ports[0];
    window.__minBuyutnaNativeReady = true;
  });
  const send = (message) => port.postMessage(JSON.stringify(message));
  async function save(anchor) {
    if (busy || !port) return;
    busy = true;
    try {
      const url = new URL(anchor.href, location.href);
      if (url.protocol !== "blob:" && url.origin !== location.origin) return;
      // Retain the Blob before the page immediately revokes its object URL.
      const known = blobs.get(anchor.href);
      const blob = known || await (async () => {
        const response = await fetch(url.href, { credentials: "same-origin" });
        if (!response.ok) throw new Error("download failed");
        return response.blob();
      })();
      if (blob.size > 10 * 1024 * 1024) throw new Error("file too large");
      const id = crypto.randomUUID();
      send({ type: "start", id, name: anchor.download || "min-buyutna-download", mime: blob.type, size: blob.size });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        let binary = "";
        for (const byte of bytes.subarray(offset, offset + 32768)) binary += String.fromCharCode(byte);
        send({ type: "chunk", id, data: btoa(binary) });
      }
      send({ type: "finish", id });
    } catch {
      if (port) send({ type: "error" });
    } finally { busy = false; }
  }
  function shouldSave(anchor) {
    return port && anchor instanceof HTMLAnchorElement &&
      (anchor.hasAttribute("download") || anchor.href.startsWith("blob:"));
  }
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (shouldSave(this)) { void save(this); return; }
    return click.call(this);
  };
  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (shouldSave(anchor)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void save(anchor);
    }
  }, true);
  window.print = () => { if (port) send({ type: "print" }); };
})();
