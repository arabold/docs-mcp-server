import { q as timing, r as buildQueryString, u as HttpResponse, v as getTransformedHeaders, w as writeRequestBody } from "./index.js";
import { Agent as Agent$1, request as request$1 } from "http";
import { Agent, request } from "https";
const NODEJS_TIMEOUT_ERROR_CODES = ["ECONNRESET", "EPIPE", "ETIMEDOUT"];
const DEFER_EVENT_LISTENER_TIME$2 = 1e3;
const setConnectionTimeout = (request2, reject, timeoutInMs = 0) => {
  if (!timeoutInMs) {
    return -1;
  }
  const registerTimeout = (offset) => {
    const timeoutId = timing.setTimeout(() => {
      request2.destroy();
      reject(Object.assign(new Error(`@smithy/node-http-handler - the request socket did not establish a connection with the server within the configured timeout of ${timeoutInMs} ms.`), {
        name: "TimeoutError"
      }));
    }, timeoutInMs - offset);
    const doWithSocket = (socket) => {
      if (socket?.connecting) {
        socket.on("connect", () => {
          timing.clearTimeout(timeoutId);
        });
      } else {
        timing.clearTimeout(timeoutId);
      }
    };
    if (request2.socket) {
      doWithSocket(request2.socket);
    } else {
      request2.on("socket", doWithSocket);
    }
  };
  if (timeoutInMs < 2e3) {
    registerTimeout(0);
    return 0;
  }
  return timing.setTimeout(registerTimeout.bind(null, DEFER_EVENT_LISTENER_TIME$2), DEFER_EVENT_LISTENER_TIME$2);
};
const setRequestTimeout = (req, reject, timeoutInMs = 0, throwOnRequestTimeout, logger) => {
  if (timeoutInMs) {
    return timing.setTimeout(() => {
      let msg = `@smithy/node-http-handler - [${throwOnRequestTimeout ? "ERROR" : "WARN"}] a request has exceeded the configured ${timeoutInMs} ms requestTimeout.`;
      if (throwOnRequestTimeout) {
        const error = Object.assign(new Error(msg), {
          name: "TimeoutError",
          code: "ETIMEDOUT"
        });
        req.destroy(error);
        reject(error);
      } else {
        msg += ` Init client requestHandler with throwOnRequestTimeout=true to turn this into an error.`;
        logger?.warn?.(msg);
      }
    }, timeoutInMs);
  }
  return -1;
};
const DEFER_EVENT_LISTENER_TIME$1 = 3e3;
const setSocketKeepAlive = (request2, { keepAlive, keepAliveMsecs }, deferTimeMs = DEFER_EVENT_LISTENER_TIME$1) => {
  if (keepAlive !== true) {
    return -1;
  }
  const registerListener = () => {
    if (request2.socket) {
      request2.socket.setKeepAlive(keepAlive, keepAliveMsecs || 0);
    } else {
      request2.on("socket", (socket) => {
        socket.setKeepAlive(keepAlive, keepAliveMsecs || 0);
      });
    }
  };
  if (deferTimeMs === 0) {
    registerListener();
    return 0;
  }
  return timing.setTimeout(registerListener, deferTimeMs);
};
const DEFER_EVENT_LISTENER_TIME = 3e3;
const setSocketTimeout = (request2, reject, timeoutInMs = 0) => {
  const registerTimeout = (offset) => {
    const timeout = timeoutInMs - offset;
    const onTimeout = () => {
      request2.destroy();
      reject(Object.assign(new Error(`@smithy/node-http-handler - the request socket timed out after ${timeoutInMs} ms of inactivity (configured by client requestHandler).`), { name: "TimeoutError" }));
    };
    if (request2.socket) {
      request2.socket.setTimeout(timeout, onTimeout);
      request2.on("close", () => request2.socket?.removeListener("timeout", onTimeout));
    } else {
      request2.setTimeout(timeout, onTimeout);
    }
  };
  if (0 < timeoutInMs && timeoutInMs < 6e3) {
    registerTimeout(0);
    return 0;
  }
  return timing.setTimeout(registerTimeout.bind(null, timeoutInMs === 0 ? 0 : DEFER_EVENT_LISTENER_TIME), DEFER_EVENT_LISTENER_TIME);
};
class NodeHttpHandler {
  config;
  configProvider;
  socketWarningTimestamp = 0;
  externalAgent = false;
  metadata = { handlerProtocol: "http/1.1" };
  static create(instanceOrOptions) {
    if (typeof instanceOrOptions?.handle === "function") {
      return instanceOrOptions;
    }
    return new NodeHttpHandler(instanceOrOptions);
  }
  static checkSocketUsage(agent, socketWarningTimestamp, logger = console) {
    const { sockets, requests, maxSockets } = agent;
    if (typeof maxSockets !== "number" || maxSockets === Infinity) {
      return socketWarningTimestamp;
    }
    const interval = 15e3;
    if (Date.now() - interval < socketWarningTimestamp) {
      return socketWarningTimestamp;
    }
    if (sockets && requests) {
      for (const origin in sockets) {
        const socketsInUse = sockets[origin]?.length ?? 0;
        const requestsEnqueued = requests[origin]?.length ?? 0;
        if (socketsInUse >= maxSockets && requestsEnqueued >= 2 * maxSockets) {
          logger?.warn?.(`@smithy/node-http-handler:WARN - socket usage at capacity=${socketsInUse} and ${requestsEnqueued} additional requests are enqueued.
See https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/node-configuring-maxsockets.html
or increase socketAcquisitionWarningTimeout=(millis) in the NodeHttpHandler config.`);
          return Date.now();
        }
      }
    }
    return socketWarningTimestamp;
  }
  constructor(options) {
    this.configProvider = new Promise((resolve, reject) => {
      if (typeof options === "function") {
        options().then((_options) => {
          resolve(this.resolveDefaultConfig(_options));
        }).catch(reject);
      } else {
        resolve(this.resolveDefaultConfig(options));
      }
    });
  }
  resolveDefaultConfig(options) {
    const { requestTimeout, connectionTimeout, socketTimeout, socketAcquisitionWarningTimeout, httpAgent, httpsAgent, throwOnRequestTimeout } = options || {};
    const keepAlive = true;
    const maxSockets = 50;
    return {
      connectionTimeout,
      requestTimeout,
      socketTimeout,
      socketAcquisitionWarningTimeout,
      throwOnRequestTimeout,
      httpAgent: (() => {
        if (httpAgent instanceof Agent$1 || typeof httpAgent?.destroy === "function") {
          this.externalAgent = true;
          return httpAgent;
        }
        return new Agent$1({ keepAlive, maxSockets, ...httpAgent });
      })(),
      httpsAgent: (() => {
        if (httpsAgent instanceof Agent || typeof httpsAgent?.destroy === "function") {
          this.externalAgent = true;
          return httpsAgent;
        }
        return new Agent({ keepAlive, maxSockets, ...httpsAgent });
      })(),
      logger: console
    };
  }
  destroy() {
    this.config?.httpAgent?.destroy();
    this.config?.httpsAgent?.destroy();
  }
  async handle(request$2, { abortSignal, requestTimeout } = {}) {
    if (!this.config) {
      this.config = await this.configProvider;
    }
    return new Promise((_resolve, _reject) => {
      const config = this.config;
      let writeRequestBodyPromise = void 0;
      const timeouts = [];
      const resolve = async (arg) => {
        await writeRequestBodyPromise;
        timeouts.forEach(timing.clearTimeout);
        _resolve(arg);
      };
      const reject = async (arg) => {
        await writeRequestBodyPromise;
        timeouts.forEach(timing.clearTimeout);
        _reject(arg);
      };
      if (abortSignal?.aborted) {
        const abortError = new Error("Request aborted");
        abortError.name = "AbortError";
        reject(abortError);
        return;
      }
      const isSSL = request$2.protocol === "https:";
      const headers = request$2.headers ?? {};
      const expectContinue = (headers.Expect ?? headers.expect) === "100-continue";
      let agent = isSSL ? config.httpsAgent : config.httpAgent;
      if (expectContinue && !this.externalAgent) {
        agent = new (isSSL ? Agent : Agent$1)({
          keepAlive: false,
          maxSockets: Infinity
        });
      }
      timeouts.push(timing.setTimeout(() => {
        this.socketWarningTimestamp = NodeHttpHandler.checkSocketUsage(agent, this.socketWarningTimestamp, config.logger);
      }, config.socketAcquisitionWarningTimeout ?? (config.requestTimeout ?? 2e3) + (config.connectionTimeout ?? 1e3)));
      const queryString = buildQueryString(request$2.query || {});
      let auth = void 0;
      if (request$2.username != null || request$2.password != null) {
        const username = request$2.username ?? "";
        const password = request$2.password ?? "";
        auth = `${username}:${password}`;
      }
      let path = request$2.path;
      if (queryString) {
        path += `?${queryString}`;
      }
      if (request$2.fragment) {
        path += `#${request$2.fragment}`;
      }
      let hostname = request$2.hostname ?? "";
      if (hostname[0] === "[" && hostname.endsWith("]")) {
        hostname = request$2.hostname.slice(1, -1);
      } else {
        hostname = request$2.hostname;
      }
      const nodeHttpsOptions = {
        headers: request$2.headers,
        host: hostname,
        method: request$2.method,
        path,
        port: request$2.port,
        agent,
        auth
      };
      const requestFunc = isSSL ? request : request$1;
      const req = requestFunc(nodeHttpsOptions, (res) => {
        const httpResponse = new HttpResponse({
          statusCode: res.statusCode || -1,
          reason: res.statusMessage,
          headers: getTransformedHeaders(res.headers),
          body: res
        });
        resolve({ response: httpResponse });
      });
      req.on("error", (err) => {
        if (NODEJS_TIMEOUT_ERROR_CODES.includes(err.code)) {
          reject(Object.assign(err, { name: "TimeoutError" }));
        } else {
          reject(err);
        }
      });
      if (abortSignal) {
        const onAbort = () => {
          req.destroy();
          const abortError = new Error("Request aborted");
          abortError.name = "AbortError";
          reject(abortError);
        };
        if (typeof abortSignal.addEventListener === "function") {
          const signal = abortSignal;
          signal.addEventListener("abort", onAbort, { once: true });
          req.once("close", () => signal.removeEventListener("abort", onAbort));
        } else {
          abortSignal.onabort = onAbort;
        }
      }
      const effectiveRequestTimeout = requestTimeout ?? config.requestTimeout;
      timeouts.push(setConnectionTimeout(req, reject, config.connectionTimeout));
      timeouts.push(setRequestTimeout(req, reject, effectiveRequestTimeout, config.throwOnRequestTimeout, config.logger ?? console));
      timeouts.push(setSocketTimeout(req, reject, config.socketTimeout));
      const httpAgent = nodeHttpsOptions.agent;
      if (typeof httpAgent === "object" && "keepAlive" in httpAgent) {
        timeouts.push(setSocketKeepAlive(req, {
          keepAlive: httpAgent.keepAlive,
          keepAliveMsecs: httpAgent.keepAliveMsecs
        }));
      }
      writeRequestBodyPromise = writeRequestBody(req, request$2, effectiveRequestTimeout, this.externalAgent).catch((e) => {
        timeouts.forEach(timing.clearTimeout);
        return _reject(e);
      });
    });
  }
  updateHttpClientConfig(key, value) {
    this.config = void 0;
    this.configProvider = this.configProvider.then((config) => {
      return {
        ...config,
        [key]: value
      };
    });
  }
  httpHandlerConfigs() {
    return this.config ?? {};
  }
}
export {
  NodeHttpHandler as N
};
