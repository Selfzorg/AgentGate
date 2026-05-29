export const fetchPolyfillScript = String.raw`
(function () {
  if (typeof window === "undefined" || typeof window.fetch === "function") return;

  function HeadersShim(rawHeaders) {
    this.rawHeaders = rawHeaders || "";
  }

  HeadersShim.prototype.get = function (name) {
    var lowerName = String(name).toLowerCase();
    var lines = this.rawHeaders.split(/\r?\n/);
    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index];
      var separator = line.indexOf(":");
      if (separator <= 0) continue;
      if (line.slice(0, separator).trim().toLowerCase() === lowerName) {
        return line.slice(separator + 1).trim();
      }
    }
    return null;
  };

  function applyHeaders(xhr, headers) {
    if (!headers) return;
    if (typeof headers.forEach === "function") {
      headers.forEach(function (value, key) {
        xhr.setRequestHeader(key, value);
      });
      return;
    }
    if (Array.isArray(headers)) {
      headers.forEach(function (entry) {
        xhr.setRequestHeader(entry[0], entry[1]);
      });
      return;
    }
    Object.keys(headers).forEach(function (key) {
      xhr.setRequestHeader(key, headers[key]);
    });
  }

  window.fetch = function (input, init) {
    var requestInit = init || {};
    var url = typeof input === "string" ? input : input && input.url;
    return new Promise(function (resolve, reject) {
      if (!url) {
        reject(new TypeError("fetch polyfill requires a URL"));
        return;
      }

      var xhr = new XMLHttpRequest();
      xhr.open(requestInit.method || "GET", url, true);
      if (requestInit.credentials === "include") xhr.withCredentials = true;
      applyHeaders(xhr, requestInit.headers);
      xhr.onload = function () {
        var responseText = xhr.responseText || "";
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          statusText: xhr.statusText,
          url: xhr.responseURL || url,
          headers: new HeadersShim(xhr.getAllResponseHeaders()),
          text: function () {
            return Promise.resolve(responseText);
          },
          json: function () {
            return Promise.resolve(responseText ? JSON.parse(responseText) : null);
          }
        });
      };
      xhr.onerror = function () {
        reject(new TypeError("Network request failed"));
      };
      xhr.ontimeout = xhr.onerror;
      if (requestInit.signal) {
        requestInit.signal.addEventListener("abort", function () {
          xhr.abort();
          reject(new DOMException("Aborted", "AbortError"));
        });
      }
      xhr.send(requestInit.body || null);
    });
  };
})();
`;
