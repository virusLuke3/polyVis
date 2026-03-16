function applyClashProxyEnv() {
  const enabled = (process.env.CLASH_PROXY_ENABLED || "true") === "true";
  if (!enabled) {
    return;
  }

  const proxyUrl = process.env.CLASH_PROXY_URL || "http://127.0.0.1:7897";
  const socksProxyUrl = process.env.CLASH_SOCKS_PROXY_URL || proxyUrl;
  const noProxy = process.env.NO_PROXY || "127.0.0.1,localhost";

  process.env.HTTP_PROXY = process.env.HTTP_PROXY || proxyUrl;
  process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || proxyUrl;
  process.env.http_proxy = process.env.http_proxy || process.env.HTTP_PROXY;
  process.env.https_proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
  process.env.ALL_PROXY = process.env.ALL_PROXY || socksProxyUrl;
  process.env.all_proxy = process.env.all_proxy || process.env.ALL_PROXY;
  process.env.NO_PROXY = noProxy;
  process.env.no_proxy = noProxy;
  process.env.NODE_USE_ENV_PROXY = "1";

  try {
    const { ProxyAgent, setGlobalDispatcher } = require("undici");
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch {}
}

function normalizePrivateKey(privateKey) {
  if (!privateKey) {
    return null;
  }

  return privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
}

module.exports = {
  applyClashProxyEnv,
  normalizePrivateKey,
};
