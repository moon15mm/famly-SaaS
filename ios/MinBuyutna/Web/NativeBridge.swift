import Foundation

/// Saves page downloads (Blob and <a download>) and receipt printing through the app.
/// The iOS counterpart of android/app/src/main/assets/native-bridge.js; it talks to the
/// `minBuyutna` script message handler, which only accepts the platform origin's main frame.
enum NativeBridge {
    static let handler = "minBuyutna"
    static let maxFile = 10 * 1024 * 1024

    static let script = #"""
(() => {
  if (window !== window.top || window.__minBuyutnaBridgeInstalled) return;
  const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.minBuyutna;
  if (!native) return;
  window.__minBuyutnaBridgeInstalled = true;
  window.__minBuyutnaNativeReady = true;
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
  const send = (message) => native.postMessage(JSON.stringify(message));
  async function save(anchor) {
    if (busy) return;
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
      send({ type: "error" });
    } finally { busy = false; }
  }
  function shouldSave(anchor) {
    return anchor instanceof HTMLAnchorElement && (anchor.hasAttribute("download") || anchor.href.startsWith("blob:"));
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
  window.print = () => send({ type: "print" });
})();
"""#

    static func safeName(_ name: String) -> String {
        var cleaned = String(name.unicodeScalars.map { scalar -> Character in
            if scalar == "/" || scalar == "\\" || scalar == ":" || CharacterSet.controlCharacters.contains(scalar) { return "_" }
            return Character(scalar)
        }).trimmingCharacters(in: .whitespacesAndNewlines)
        while cleaned.hasPrefix(".") { cleaned.removeFirst() }
        if cleaned.isEmpty { cleaned = "min-buyutna-download" }
        return String(cleaned.prefix(120))
    }

    static let allowedMimes: Set<String> = [
        "application/json", "text/csv", "text/plain", "application/pdf", "image/webp", "image/jpeg", "image/png",
    ]

    static func safeMime(_ mime: String?) -> String? {
        guard let mime else { return nil }
        let normalized = mime.split(separator: ";", maxSplits: 1).first.map(String.init)?
            .trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        return allowedMimes.contains(normalized) ? normalized : nil
    }

    /// Reassembles a chunked transfer from the page, enforcing the declared size and the 10 MiB limit.
    struct Transfer {
        let id: String
        let name: String
        let mime: String
        let size: Int
        var data = Data()
    }

    enum Event {
        case print
        case failed
        case started
        case finished(Data, name: String, mime: String)
        case ignored
    }

    /// Parses one message; throws when the message is malformed or breaks the size rules.
    static func receive(_ raw: String, transfer: inout Transfer?) throws -> Event {
        struct Bad: Error {}
        guard raw.utf8.count <= 100_000, let data = raw.data(using: .utf8),
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { throw Bad() }
        switch type {
        case "print": return .print
        case "error": return .failed
        case "start":
            guard let size = json["size"] as? Int, size >= 0, size <= maxFile,
                  let id = json["id"] as? String, let name = json["name"] as? String,
                  let mime = safeMime(json["mime"] as? String) else { throw Bad() }
            transfer = Transfer(id: id, name: safeName(name), mime: mime, size: size)
            return .started
        default:
            guard var current = transfer, (json["id"] as? String) == current.id else { return .ignored }
            if type == "chunk" {
                guard let text = json["data"] as? String, let chunk = Data(base64Encoded: text),
                      current.data.count + chunk.count <= current.size else { throw Bad() }
                current.data.append(chunk)
                transfer = current
                return .ignored
            }
            if type == "finish" {
                guard current.data.count == current.size else { throw Bad() }
                transfer = nil
                return .finished(current.data, name: current.name, mime: current.mime)
            }
            return .ignored
        }
    }
}
