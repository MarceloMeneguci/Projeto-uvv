/**
 * xhr.js
 * Helper para requisições assíncronas usando XMLHttpRequest,
 * com suporte a: headers, JSON, timeout, progress, cancelamento,
 * retries controlados e pool de concorrência.
 */

function parseHeaders(headerStr) {
  const headers = {};
  if (!headerStr) return headers;
  headerStr.trim().split(/[\n]+/).forEach(line => {
    const parts = line.split(': ');
    const key = parts.shift();
    const value = parts.join(': ');
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

function xhrRequest(opts = {}) {
  const {
    method = 'GET',
    url,
    headers = {},
    body = null,
    timeout = 30000,
    withCredentials = false,
    responseType = 'json',
    onProgress = null,
    onChunk = null
  } = opts;

  const xhr = new XMLHttpRequest();

  const promise = new Promise((resolve, reject) => {
    try {
      xhr.open(method, url, true);
      xhr.withCredentials = !!withCredentials;
      xhr.timeout = timeout;

      if (responseType && responseType !== 'json') xhr.responseType = responseType;

      Object.keys(headers).forEach(k => {
        xhr.setRequestHeader(k, headers[k]);
      });

      let lastIndex = 0;
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 3 && typeof onChunk === 'function') {
          const chunk = xhr.responseText.substring(lastIndex);
          lastIndex = xhr.responseText.length;
          try { onChunk(chunk); } catch (e) {}
        }
        if (xhr.readyState === 4) {
          const status = xhr.status;
          const rawHeaders = xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : '';
          const parsedHeaders = parseHeaders(rawHeaders);

          if (status >= 200 && status < 300) {
            let parsedBody;
            try {
              if (xhr.responseType === 'json') parsedBody = xhr.response;
              else if (responseType === 'json') parsedBody = JSON.parse(xhr.responseText || 'null');
              else parsedBody = xhr.response || xhr.responseText;
            } catch (parseErr) {
              parsedBody = xhr.responseText;
            }
            resolve({ status, headers: parsedHeaders, body: parsedBody, xhr });
          } else {
            reject({ status, statusText: xhr.statusText, body: xhr.responseText, headers: parsedHeaders });
          }
        }
      };

      xhr.onprogress = onProgress || null;
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Timeout'));
      xhr.onabort = () => reject(new Error('Aborted'));

      let payload = body;
      const ct = (headers['Content-Type'] || headers['content-type'] || '').toLowerCase();
      if (body != null && typeof body === 'object' && ct.includes('application/json')) {
        payload = JSON.stringify(body);
      }

      xhr.send(payload);
    } catch (err) {
      reject(err);
    }
  });

  return { promise, xhr };
}

class XHRPool {
  constructor(concurrency = 4) {
    this.concurrency = concurrency;
    this.active = 0;
    this.queue = [];
  }

  enqueue(createTaskFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ createTaskFn, resolve, reject });
      this._next();
    });
  }

  _next() {
    if (this.active >= this.concurrency) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active++;
    const { createTaskFn, resolve, reject } = job;
    try {
      const { promise, xhr } = createTaskFn();
      promise
        .then(result => {
          this.active--;
          resolve({ result, xhr });
          this._next();
        })
        .catch(err => {
          this.active--;
          reject(err);
          this._next();
        });
    } catch (err) {
      this.active--;
      reject(err);
      this._next();
    }
  }
}

function exampleUsage() {
  const endpoints = [
    '/api/products/123',
    '/api/price/123',
    '/api/stock/123',
    '/api/recommendations?product=123'
  ];

  const pool = new XHRPool(3);

  const tasks = endpoints.map(url => {
    return pool.enqueue(() => xhrRequest({
      method: 'GET',
      url,
      headers: { 'Accept': 'application/json' }
    }));
  });

  Promise.allSettled(tasks)
    .then(results => {
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          console.log('✅ Sucesso', endpoints[i], r.value.result.body);
        } else {
          console.error('❌ Erro', endpoints[i], r.reason);
        }
      });
    });
}

// exampleUsage();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { xhrRequest, XHRPool };
}
